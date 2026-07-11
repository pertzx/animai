/**
 * Análise automática de mídia importada (além da fala): perfil de áudio local
 * (energia/silêncio/BPM) e OCR de texto embutido em vídeo. Tudo roda na
 * máquina do usuário — zero tokens de IA — e o resultado entra no JSON global
 * do projeto para o agente consultar via get_media_insights.
 */

import type { MediaInsight, MediaItem } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { decodeMediaAudio } from "./decode-audio";
import { analyzeAudio } from "./audio-analysis";
import { extractOnScreenText } from "./ocr";
import { setProjectInsight } from "./project-context";

const AUTO_INSIGHTS_KEY = "animai.autoInsights";

export function isAutoInsightsEnabled(): boolean {
  if (localStorage.getItem(AUTO_INSIGHTS_KEY) === "false") return false;
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

export function setAutoInsightsEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_INSIGHTS_KEY, String(enabled));
}

type InsightListener = (state: {
  activeMediaId: string | null;
  status: string;
}) => void;

class InsightsManager {
  private queue: string[] = [];
  private processing = false;
  private attempted = new Set<string>();
  private listeners = new Set<InsightListener>();
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
  }

  onStateChange(listener: InsightListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reanalisa manualmente uma mídia (mesmo com auto-análise desligada). */
  enqueue(mediaId: string): void {
    this.attempted.delete(mediaId);
    this.push(mediaId);
  }

  /** Reanalisa todas as mídias do projeto (botão de retry na UI). */
  reanalyzeAll(): number {
    const items = useProjectStore
      .getState()
      .project.mediaLibrary.items.filter((m) => m.type !== "image");
    for (const item of items) this.enqueue(item.id);
    return items.length;
  }

  /**
   * Garante a análise de uma mídia, disparando-a se necessário, e espera o
   * resultado (usado pela tool get_media_insights para ser autossuficiente).
   */
  async waitForInsight(
    mediaId: string,
    timeoutMs = 90000,
  ): Promise<MediaInsight | null> {
    const find = () =>
      (useProjectStore.getState().project.mediaInsights ?? []).find(
        (i) => i.mediaId === mediaId,
      ) ?? null;

    const existing = find();
    if (existing) return existing;

    this.enqueue(mediaId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const insight = find();
      if (insight) return insight;
      // Saiu da fila sem produzir insight = análise falhou.
      if (!this.processing && !this.queue.includes(mediaId)) return null;
    }
    return null;
  }

  private onMediaChanged(items: MediaItem[]): void {
    if (!isAutoInsightsEnabled()) return;
    const done = new Set(
      (useProjectStore.getState().project.mediaInsights ?? []).map(
        (i) => i.mediaId,
      ),
    );
    for (const item of items) {
      if (item.type === "image") continue;
      if (item.isPlaceholder || item.isPending) continue;
      if (!item.blob && !item.fileHandle) continue;
      if (done.has(item.id) || this.attempted.has(item.id)) continue;
      this.push(item.id);
    }
  }

  private push(mediaId: string): void {
    if (this.queue.includes(mediaId)) return;
    this.attempted.add(mediaId);
    this.queue.push(mediaId);
    void this.processNext();
  }

  private emit(activeMediaId: string | null, status: string): void {
    for (const listener of this.listeners) listener({ activeMediaId, status });
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    const mediaId = this.queue.shift();
    if (!mediaId) return;
    this.processing = true;

    const item = useProjectStore
      .getState()
      .project.mediaLibrary.items.find((m) => m.id === mediaId);

    try {
      if (!item) return;
      const insight: MediaInsight = {
        mediaId,
        generatedAt: Date.now(),
      };

      // Perfil de áudio (vídeo e áudio).
      this.emit(mediaId, "analisando áudio");
      try {
        const pcm = await decodeMediaAudio(mediaId);
        if (pcm) {
          (insight as { audio?: MediaInsight["audio"] }).audio =
            analyzeAudio(pcm);
        }
      } catch (err) {
        // Mídia sem trilha de áudio decodificável — segue só com OCR.
        console.warn(`[animai-insights] áudio de ${item.name}:`, err);
      }

      // OCR de texto na tela (só vídeo).
      if (item.type === "video") {
        let blob = item.blob;
        if (!blob && item.fileHandle) blob = await item.fileHandle.getFile();
        if (blob) {
          this.emit(mediaId, "lendo texto na tela (OCR)");
          try {
            const text = await extractOnScreenText(
              blob,
              item.metadata.duration,
              (done, total) =>
                this.emit(mediaId, `lendo texto na tela (${done}/${total})`),
            );
            if (text.length > 0) {
              (
                insight as { onScreenText?: MediaInsight["onScreenText"] }
              ).onScreenText = text;
            }
          } catch (err) {
            // OCR é oportunista; o perfil de áudio já ajuda o agente.
            console.warn(`[animai-insights] OCR de ${item.name}:`, err);
            toast.warning(
              "OCR do vídeo falhou",
              `${item.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      setProjectInsight(insight);
      const parts: string[] = [];
      if (insight.audio) {
        parts.push(
          insight.audio.bpm
            ? `áudio ~${insight.audio.bpm} BPM`
            : "perfil de áudio",
        );
      }
      if (insight.onScreenText) {
        parts.push(`${insight.onScreenText.length} textos na tela`);
      }
      if (parts.length > 0) {
        toast.info("Mídia analisada", `${item.name}: ${parts.join(", ")}`);
      }
    } catch (err) {
      toast.warning(
        "Análise de mídia falhou",
        `${item?.name ?? mediaId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.processing = false;
      this.emit(null, "idle");
      void this.processNext();
    }
  }
}

export const insightsManager = new InsightsManager();
