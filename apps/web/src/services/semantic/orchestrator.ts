/**
 * Orquestrador do Semantic Media Analyzer (prompt.txt).
 *
 * Fluxo: resolve config → instancia os plugins ativos → roda plugins de
 * sequência (áudio/STT) → itera frames uma vez, passando cada frame a todos
 * os plugins de visão → finaliza (tracking, agrupamento) → Timeline Builder.
 *
 * O callback onFrame permite ao Admin Lab desenhar overlays em tempo real.
 */

import type {
  AnalyzerConfig,
  AnalyzerContext,
  AnalyzerFrame,
  DetectorStatus,
  SemanticAnalyzerPlugin,
  SemanticEvent,
  SemanticTimeline,
} from "./types";
import { resolveConfig } from "./config";
import { extractFrames, estimateFrameCount } from "./frame-source";
import { buildSemanticTimeline } from "./timeline-builder";
import { createPlugins } from "./plugins";
import { detectBestBackend } from "./plugins/mediapipe";

export interface AnalyzeOptions {
  blob: Blob;
  durationSec: number;
  config: AnalyzerConfig;
  audioPcm: Float32Array | null;
  signal: AbortSignal;
  /** Chamado a cada frame com as detecções desse instante (para overlay). */
  onFrame?: (frame: AnalyzerFrame, events: SemanticEvent[]) => void;
  /** Progresso 0..1 + rótulo do estágio. */
  onProgress?: (fraction: number, stage: string) => void;
  /** Eventos vão saindo em streaming (para o feed ao vivo). */
  onEvents?: (events: SemanticEvent[]) => void;
  /** Status de carregamento de cada detector (para diagnóstico no Lab). */
  onDetectorStatus?: (statuses: DetectorStatus[]) => void;
}

/** Cede a thread principal para o navegador repintar (evita congelamento). */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function analyzeMedia(
  options: AnalyzeOptions,
): Promise<SemanticTimeline> {
  const config = resolveConfig(options.config);
  const context: AnalyzerContext = {
    durationSec: options.durationSec,
    config,
    audioPcm: options.audioPcm,
    mediaBlob: options.blob,
    signal: options.signal,
  };

  // Auto-detecta o melhor backend (GPU/WebGL2 vs CPU/WASM) para este
  // dispositivo e o usa — em vez de depender só do toggle manual.
  const backend = detectBestBackend();
  config.performance.useWebGPU = backend === "GPU";

  const plugins: SemanticAnalyzerPlugin[] = createPlugins(config);
  // Estado por plugin: eventos brutos acumulados (para finalize).
  const rawByPlugin = new Map<string, SemanticEvent[]>();
  for (const p of plugins) rawByPlugin.set(p.id, []);

  options.onProgress?.(
    0,
    `Carregando modelos (${backend === "GPU" ? "GPU" : "CPU/WASM"})`,
  );
  // Init com status por detector — falhas ficam VISÍVEIS (antes eram engolidas,
  // por isso "só fala e texto" apareciam: os modelos de visão falhavam calados).
  const statuses: DetectorStatus[] = await Promise.all(
    plugins.map(async (p) => {
      try {
        await p.init(context);
        return { id: p.id, label: p.label, ok: true };
      } catch (err) {
        console.error(`[semantic] init de ${p.id} falhou:`, err);
        return {
          id: p.id,
          label: p.label,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  options.onDetectorStatus?.(statuses);

  // 1. Plugins de sequência (áudio / STT) — rodam em paralelo: o STT (worker
  // Whisper) sobrepõe com a análise de áudio/música em vez de um por vez.
  const sequencePlugins = plugins.filter((p) => p.analyzeSequence);
  if (sequencePlugins.length > 0) {
    options.onProgress?.(0.05, "Analisando áudio e fala");
    await Promise.all(
      sequencePlugins.map(async (p) => {
        try {
          const events = await p.analyzeSequence!(context);
          rawByPlugin.get(p.id)!.push(...events);
          options.onEvents?.(events);
        } catch {
          /* plugin opcional falhou; segue */
        }
      }),
    );
  }

  // 2. Plugins de visão — um passe de frames alimenta todos.
  const framePlugins = plugins.filter((p) => p.analyzeFrame);
  const needsFrames = framePlugins.length > 0;

  if (needsFrames) {
    const total = estimateFrameCount(
      options.durationSec,
      config.performance.analysisFps,
    );
    let done = 0;
    for await (const frame of extractFrames(options.blob, {
      fps: config.performance.analysisFps,
      resolution: config.performance.analysisResolution,
      durationSec: options.durationSec,
      signal: options.signal,
    })) {
      if (options.signal.aborted) {
        frame.bitmap.close();
        break;
      }
      // Executa TODOS os detectores do frame ao mesmo tempo (Promise.all):
      // os baseados em worker (OCR) rodam de fato em paralelo com os de visão,
      // acelerando a resposta em vez de um plugin por vez.
      const frameEvents: SemanticEvent[] = [];
      const results = await Promise.all(
        framePlugins.map((p) =>
          p.analyzeFrame!(frame, context).catch(() => [] as SemanticEvent[]),
        ),
      );
      framePlugins.forEach((p, i) => {
        const evs = results[i];
        if (evs.length) {
          rawByPlugin.get(p.id)!.push(...evs);
          frameEvents.push(...evs);
        }
      });
      options.onFrame?.(frame, frameEvents);
      if (frameEvents.length) options.onEvents?.(frameEvents);
      frame.bitmap.close();

      done++;
      options.onProgress?.(
        0.1 + 0.8 * Math.min(1, done / total),
        "Analisando frames",
      );
      // Respiro entre frames: mantém o preview/overlay/readout fluidos.
      await yieldToUi();
    }
  }

  // 3. Finalização por plugin (tracking, agrupamento de detecções contíguas).
  options.onProgress?.(0.92, "Consolidando eventos");
  const allEvents: SemanticEvent[] = [];
  for (const p of plugins) {
    const raw = rawByPlugin.get(p.id)!;
    const finalized = p.finalize ? p.finalize(raw, context) : raw;
    allEvents.push(...finalized);
  }

  for (const p of plugins) p.dispose();

  options.onProgress?.(1, "Timeline pronta");
  return buildSemanticTimeline(allEvents, options.durationSec);
}
