/**
 * Automatic local transcription of imported media (prd.txt §3.2).
 *
 * Watches the project's media library; whenever a video/audio item appears
 * without a transcript, decodes its audio to 16 kHz mono PCM and sends it to
 * the Whisper worker. Results are written into the project's global JSON via
 * setProjectTranscript, so the AI agent can "see" what is being said.
 */

import type { Subtitle } from "@openreel/core";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { setProjectTranscript } from "./project-context";
import { decodeMediaAudio } from "./decode-audio";
import type { WhisperResponse } from "./whisper.worker";

const AUTO_TRANSCRIBE_KEY = "animai.autoTranscribe";

export function isAutoTranscribeEnabled(): boolean {
  if (localStorage.getItem(AUTO_TRANSCRIBE_KEY) === "false") return false;
  // Modo desempenho: análises pesadas só sob demanda (botão ↻ do chat).
  try {
    const prefs = JSON.parse(localStorage.getItem("animai.prefs") ?? "{}") as {
      performanceMode?: string;
    };
    return prefs.performanceMode !== "desempenho";
  } catch {
    return true;
  }
}

export function setAutoTranscribeEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_TRANSCRIBE_KEY, String(enabled));
}

interface TranscriptionJob {
  mediaId: string;
  mediaName: string;
}

type TranscriptionListener = (state: {
  activeMediaId: string | null;
  status: string;
  queued: number;
}) => void;

class TranscriptionManager {
  private worker: Worker | null = null;
  private queue: TranscriptionJob[] = [];
  private processing = false;
  private attempted = new Set<string>();
  private listeners = new Set<TranscriptionListener>();
  private unsubscribe: (() => void) | null = null;

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = useProjectStore.subscribe(
      (state) => state.project.mediaLibrary.items,
      (items) => this.onMediaChanged(items),
      { fireImmediately: true },
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.worker?.terminate();
    this.worker = null;
  }

  onStateChange(listener: TranscriptionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Manually (re)transcribe a media item, even if auto-transcribe is off. */
  enqueue(mediaId: string): void {
    const item = useProjectStore
      .getState()
      .project.mediaLibrary.items.find((m) => m.id === mediaId);
    if (!item) return;
    this.attempted.delete(mediaId);
    this.push({ mediaId: item.id, mediaName: item.name });
  }

  private onMediaChanged(items: MediaItem[]): void {
    if (!isAutoTranscribeEnabled()) return;
    const transcripts = useProjectStore.getState().project.transcripts ?? [];
    const done = new Set(transcripts.map((t) => t.mediaId));

    for (const item of items) {
      if (item.type === "image") continue;
      if (item.isPlaceholder || item.isPending) continue;
      if (!item.blob && !item.fileHandle) continue;
      if (done.has(item.id) || this.attempted.has(item.id)) continue;
      this.push({ mediaId: item.id, mediaName: item.name });
    }
  }

  private push(job: TranscriptionJob): void {
    if (this.queue.some((j) => j.mediaId === job.mediaId)) return;
    this.attempted.add(job.mediaId);
    this.queue.push(job);
    void this.processNext();
  }

  private emit(activeMediaId: string | null, status: string): void {
    for (const l of this.listeners) {
      l({ activeMediaId, status, queued: this.queue.length });
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    const job = this.queue.shift();
    if (!job) return;
    this.processing = true;
    this.emit(job.mediaId, "preparing");

    try {
      const audio = await decodeMediaAudio(job.mediaId);
      if (audio) {
        const segments = await this.runWhisper(job, audio);
        setProjectTranscript({
          mediaId: job.mediaId,
          generatedAt: Date.now(),
          segments,
        });
        toast.success(
          "Transcrição concluída",
          `${job.mediaName}: ${segments.length} segmentos`,
        );
      }
    } catch (err) {
      toast.warning(
        "Transcrição falhou",
        `${job.mediaName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.processing = false;
      this.emit(null, "idle");
      void this.processNext();
    }
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./whisper.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    return this.worker;
  }

  private runWhisper(
    job: TranscriptionJob,
    audio: Float32Array,
  ): Promise<Array<{ start: number; end: number; text: string }>> {
    const worker = this.getWorker();
    const requestId = `${job.mediaId}-${Date.now()}`;

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WhisperResponse>) => {
        const msg = event.data;
        if (msg.id !== requestId) return;
        if (msg.type === "progress") {
          this.emit(job.mediaId, msg.status);
          return;
        }
        worker.removeEventListener("message", onMessage);
        if (msg.type === "result") {
          resolve(msg.segments);
        } else {
          reject(new Error(msg.message));
        }
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage(
        { id: requestId, audio },
        // PCM buffer is large; transfer instead of copying.
        [audio.buffer],
      );
    });
  }
}

export const transcriptionManager = new TranscriptionManager();

/**
 * Progress callback shape expected by InspectorPanel / HighlightExtractorPanel
 * (same interface as WhisperTranscriptionProgress from @openreel/core).
 */
export interface LocalTranscriptionProgress {
  phase: "extracting" | "uploading" | "transcribing" | "processing" | "complete" | "error";
  progress: number;
  message: string;
}

let _worker: Worker | null = null;
function getSharedWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(
      new URL("./whisper.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return _worker;
}

/**
 * One-shot local transcription: media item → Subtitle[] (same contract as
 * TranscriptionService.transcribeClip from @openreel/core, but 100% local).
 *
 * Replaces the legacy cloud path (TranscriptionService → cloud.openreel.video)
 * that InspectorPanel and HighlightExtractorPanel used to call.
 */
export async function transcribeMediaToSubtitles(
  mediaId: string,
  onProgress?: (p: LocalTranscriptionProgress) => void,
): Promise<Subtitle[]> {
  const item = useProjectStore
    .getState()
    .project.mediaLibrary.items.find((m) => m.id === mediaId);
  if (!item) throw new Error(`Media item ${mediaId} not found`);

  onProgress?.({ phase: "extracting", progress: 5, message: "Decoding audio…" });
  const audio = await decodeMediaAudio(mediaId);
  if (!audio) throw new Error("Could not decode audio from media item");

  const worker = getSharedWorker();
  const requestId = `oneshot-${mediaId}-${Date.now()}`;

  onProgress?.({ phase: "transcribing", progress: 30, message: "Running Whisper…" });

  const segments = await new Promise<Array<{ start: number; end: number; text: string }>>(
    (resolve, reject) => {
      const onMessage = (event: MessageEvent<WhisperResponse>) => {
        const msg = event.data;
        if (msg.id !== requestId) return;
        if (msg.type === "progress") {
          onProgress?.({
            phase: "transcribing",
            progress: 30 + Math.round((msg.progress ?? 0) * 0.5),
            message: msg.status ?? "Transcribing…",
          });
          return;
        }
        worker.removeEventListener("message", onMessage);
        if (msg.type === "result") {
          resolve(msg.segments);
        } else {
          reject(new Error(msg.message ?? "Unknown Whisper error"));
        }
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ id: requestId, audio }, [audio.buffer]);
    },
  );

  onProgress?.({ phase: "processing", progress: 90, message: "Formatting subtitles…" });

  const subtitles: Subtitle[] = segments.map((seg, i) => ({
    id: `local-sub-${i}-${Date.now()}`,
    text: seg.text,
    startTime: seg.start,
    endTime: seg.end,
  }));

  onProgress?.({ phase: "complete", progress: 100, message: `${subtitles.length} segments` });

  return subtitles;
}
