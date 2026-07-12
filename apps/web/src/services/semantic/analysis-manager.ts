/**
 * Gerenciador central da análise semântica (prompt.txt / feedback do usuário).
 *
 * Responsabilidades:
 *  - Auto-analisar a mídia ao importar, conforme as configurações do usuário
 *    (para qualquer tipo: vídeo, áudio, imagem).
 *  - Deduplicar: se a mesma mídia já foi analisada, entrega o cache; se está em
 *    andamento, espera a análise atual (não roda de novo).
 *  - Derivar transcript + insights do resultado, para as features existentes da
 *    IA (get_transcript, add_captions, contexto) continuarem funcionando com um
 *    único passe de análise (sem STT/insights separados).
 */

import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import {
  ensureSemanticTimeline,
  getCachedTimeline,
} from "./run";
import { isAutoAnalyzeEnabled } from "./config";
import { setProjectTranscript, setProjectInsight } from "../ai/project-context";
import type { SemanticTimeline } from "./types";

export type AnalysisPhase = "running" | "done" | "error";

interface AnalysisState {
  mediaId: string;
  phase: AnalysisPhase;
  progress: number;
  stage: string;
}

type Listener = (state: AnalysisState) => void;

class SemanticAnalysisManager {
  private inFlight = new Map<string, Promise<SemanticTimeline | null>>();
  private attempted = new Set<string>();
  private listeners = new Set<Listener>();
  private unsubscribe: (() => void) | null = null;
  // Fila serial: só UMA análise roda por vez (evita travar com N mídias).
  private queue: Promise<unknown> = Promise.resolve();
  // Projeto atual: ao TROCAR/CARREGAR projeto, a mídia existente é marcada
  // como "vista" (não reanalisa tudo ao abrir/recuperar — só imports novos).
  private currentProjectId: string | null = null;

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

  onStateChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isRunning(mediaId: string): boolean {
    return this.inFlight.has(mediaId);
  }

  /** True se há qualquer análise em andamento. */
  get anyRunning(): boolean {
    return this.inFlight.size > 0;
  }

  private emit(state: AnalysisState): void {
    for (const l of this.listeners) l(state);
  }

  private onMediaChanged(items: MediaItem[]): void {
    const projectId = useProjectStore.getState().project.id;
    // Troca/carregamento/recuperação de projeto: NÃO analisa em massa. Apenas
    // registra a mídia existente como já vista (evita travar o editor ao abrir).
    if (projectId !== this.currentProjectId) {
      this.currentProjectId = projectId;
      this.attempted = new Set(items.map((i) => i.id));
      return;
    }
    if (!isAutoAnalyzeEnabled()) return;
    // Mesmo projeto: itens novos = imports de verdade → auto-analisa.
    for (const item of items) {
      if (item.isPlaceholder || item.isPending) continue;
      if (!item.blob && !item.fileHandle) continue;
      if (this.attempted.has(item.id)) continue;
      this.attempted.add(item.id);
      void this.ensure(item.id).catch(() => undefined);
    }
  }

  /**
   * Garante a timeline semântica da mídia:
   *  - cache → retorna na hora;
   *  - em andamento → espera a análise atual;
   *  - senão → dispara e cacheia.
   */
  async ensure(
    mediaId: string,
    options: { force?: boolean } = {},
  ): Promise<SemanticTimeline | null> {
    if (!options.force) {
      const cached = await getCachedTimeline(mediaId);
      if (cached) return cached;
      const inflight = this.inFlight.get(mediaId);
      if (inflight) return inflight; // espera o que já está rodando
    }

    // Encadeia na fila: espera as análises anteriores para rodar uma por vez.
    const promise = this.queue.then(() => this.run(mediaId));
    this.queue = promise.catch(() => undefined); // a fila continua mesmo se falhar
    this.inFlight.set(mediaId, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(mediaId);
    }
  }

  /** Reanalisa forçando (botão de reanálise). */
  reanalyze(mediaId: string): Promise<SemanticTimeline | null> {
    this.attempted.add(mediaId);
    return this.ensure(mediaId, { force: true });
  }

  private async run(mediaId: string): Promise<SemanticTimeline | null> {
    this.emit({ mediaId, phase: "running", progress: 0, stage: "iniciando" });
    try {
      const timeline = await ensureSemanticTimeline(mediaId, {
        force: true,
        onProgress: (p) =>
          this.emit({
            mediaId,
            phase: "running",
            progress: p.fraction,
            stage: p.stage,
          }),
      });
      if (timeline) {
        this.deriveTranscriptAndInsights(mediaId, timeline);
        this.emit({ mediaId, phase: "done", progress: 1, stage: "concluído" });
      } else {
        this.emit({ mediaId, phase: "error", progress: 0, stage: "falhou" });
      }
      return timeline;
    } catch {
      this.emit({ mediaId, phase: "error", progress: 0, stage: "falhou" });
      return null;
    }
  }

  /**
   * A partir do resultado semântico, popula os campos que a IA já usa:
   * transcript (dos eventos de fala) e insights (texto na tela + perfil de
   * áudio) — assim um único passe alimenta tudo.
   */
  private deriveTranscriptAndInsights(
    mediaId: string,
    timeline: SemanticTimeline,
  ): void {
    const speech = timeline.events.filter((e) => e.type === "speech");
    if (speech.length > 0) {
      setProjectTranscript({
        mediaId,
        generatedAt: Date.now(),
        segments: speech.map((e) => ({
          start: e.start,
          end: e.end,
          text: String(e.metadata.text ?? ""),
        })),
      });
    }

    const onScreenText = timeline.events
      .filter((e) => e.type === "onscreen_text")
      .map((e) => ({ time: e.start, text: String(e.metadata.text ?? "") }));

    const silence = timeline.events
      .filter((e) => e.type === "silence")
      .reduce((sum, e) => sum + (e.end - e.start), 0);
    const music = timeline.events.find((e) => e.type === "music");
    const silenceRatio =
      timeline.durationSec > 0
        ? Math.round((silence / timeline.durationSec) * 100) / 100
        : 0;

    if (onScreenText.length > 0 || silence > 0 || music) {
      setProjectInsight({
        mediaId,
        generatedAt: Date.now(),
        audio: {
          durationSec: timeline.durationSec,
          silenceRatio,
          segments: [],
          ...(music?.metadata.bpm
            ? { bpm: Number(music.metadata.bpm) }
            : {}),
        },
        ...(onScreenText.length > 0 ? { onScreenText } : {}),
      });
    }
  }
}

export const semanticAnalysisManager = new SemanticAnalysisManager();
