/**
 * Speech Analyzer (prompt.txt) — reusa o worker Whisper local já existente.
 * Gera eventos de fala (com texto e janela de tempo), pausas e silêncio a
 * partir dos segmentos e do envelope de energia do áudio.
 */

import type {
  AnalyzerContext,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";
import type { WhisperResponse } from "../../ai/whisper.worker";

const SAMPLE_RATE = 16000;
const SILENCE_RMS = 0.01;
const MIN_SILENCE_SEC = 0.6;

export class SpeechAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "speech" as const;
  readonly label = "Fala (STT)";
  readonly usesFrames = false;
  readonly usesAudio = true;

  private worker: Worker | null = null;

  async init(): Promise<void> {}

  async analyzeSequence(context: AnalyzerContext): Promise<SemanticEvent[]> {
    if (!context.audioPcm) return [];
    const events: SemanticEvent[] = [];

    // 1. Transcrição via Whisper (worker existente).
    const segments = await this.transcribe(context.audioPcm, context.signal);
    for (const seg of segments) {
      events.push({
        start: seg.start,
        end: seg.end,
        type: "speech",
        confidence: 0.9,
        metadata: { text: seg.text },
      });
    }

    // 2. Silêncio: trechos com energia abaixo do limiar por tempo suficiente.
    events.push(...this.detectSilence(context.audioPcm));
    return events;
  }

  private detectSilence(pcm: Float32Array): SemanticEvent[] {
    const win = Math.floor(0.1 * SAMPLE_RATE); // janelas de 100ms
    const events: SemanticEvent[] = [];
    let silentStart = -1;
    for (let i = 0; i + win <= pcm.length; i += win) {
      let sum = 0;
      for (let j = 0; j < win; j++) sum += pcm[i + j] * pcm[i + j];
      const rms = Math.sqrt(sum / win);
      const t = i / SAMPLE_RATE;
      if (rms < SILENCE_RMS) {
        if (silentStart < 0) silentStart = t;
      } else if (silentStart >= 0) {
        if (t - silentStart >= MIN_SILENCE_SEC) {
          events.push({
            start: silentStart,
            end: t,
            type: "silence",
            confidence: 0.8,
            metadata: { durationSec: Math.round((t - silentStart) * 100) / 100 },
          });
        }
        silentStart = -1;
      }
    }
    return events;
  }

  private transcribe(
    audio: Float32Array,
    signal: AbortSignal,
  ): Promise<Array<{ start: number; end: number; text: string }>> {
    this.worker ??= new Worker(
      new URL("../../ai/whisper.worker.ts", import.meta.url),
      { type: "module" },
    );
    const worker = this.worker;
    const id = `sem-${Date.now()}`;
    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent<WhisperResponse>) => {
        const msg = event.data;
        if (msg.id !== id) return;
        if (msg.type === "result") {
          worker.removeEventListener("message", onMessage);
          resolve(msg.segments);
        } else if (msg.type === "error") {
          worker.removeEventListener("message", onMessage);
          resolve([]);
        }
      };
      worker.addEventListener("message", onMessage);
      signal.addEventListener("abort", () => resolve([]), { once: true });
      // Cópia para transferir (o PCM original ainda é usado por outros plugins).
      const copy = audio.slice();
      worker.postMessage({ id, audio: copy }, [copy.buffer]);
    });
  }

  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    return raw;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
