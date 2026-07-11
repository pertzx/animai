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
  SemanticAnalyzerPlugin,
  SemanticEvent,
  SemanticTimeline,
} from "./types";
import { resolveConfig } from "./config";
import { extractFrames, estimateFrameCount } from "./frame-source";
import { buildSemanticTimeline } from "./timeline-builder";
import { createPlugins } from "./plugins";

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

  const plugins: SemanticAnalyzerPlugin[] = createPlugins(config);
  // Estado por plugin: eventos brutos acumulados (para finalize).
  const rawByPlugin = new Map<string, SemanticEvent[]>();
  for (const p of plugins) rawByPlugin.set(p.id, []);

  options.onProgress?.(0, "Carregando modelos");
  await Promise.all(plugins.map((p) => p.init(context).catch(() => undefined)));

  // 1. Plugins de sequência (áudio / STT) — rodam uma vez sobre a mídia toda.
  const sequencePlugins = plugins.filter((p) => p.analyzeSequence);
  for (const p of sequencePlugins) {
    if (options.signal.aborted) break;
    options.onProgress?.(0.05, `Analisando ${p.label}`);
    try {
      const events = await p.analyzeSequence!(context);
      rawByPlugin.get(p.id)!.push(...events);
      options.onEvents?.(events);
    } catch {
      /* plugin opcional falhou; segue */
    }
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
      const frameEvents: SemanticEvent[] = [];
      for (const p of framePlugins) {
        try {
          const evs = await p.analyzeFrame!(frame, context);
          if (evs.length) {
            rawByPlugin.get(p.id)!.push(...evs);
            frameEvents.push(...evs);
          }
        } catch {
          /* frame ruim; ignora */
        }
      }
      options.onFrame?.(frame, frameEvents);
      if (frameEvents.length) options.onEvents?.(frameEvents);
      frame.bitmap.close();

      done++;
      options.onProgress?.(
        0.1 + 0.8 * Math.min(1, done / total),
        "Analisando frames",
      );
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
