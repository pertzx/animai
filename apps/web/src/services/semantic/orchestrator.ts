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
  PluginCache,
  SemanticAnalyzerPlugin,
  SemanticEvent,
  SemanticTimeline,
} from "./types";
import { resolveConfig } from "./config";
import { extractFrames, estimateFrameCount } from "./frame-source";
import { buildSemanticTimeline } from "./timeline-builder";
import { createPlugins } from "./plugins";
import { detectBestBackend } from "./plugins/mediapipe";
import { pluginSignature } from "./signature";

export interface AnalyzeOptions {
  blob: Blob;
  durationSec: number;
  config: AnalyzerConfig;
  /**
   * PCM de áudio, ou uma promessa dele (Opt 4): passar a promessa deixa o
   * decode de áudio rodar em paralelo com o carregamento dos modelos.
   */
  audioPcm: Float32Array | null | Promise<Float32Array | null>;
  /**
   * Máx. de modelos inicializando em paralelo (Opt 3). Evita OOM ao carregar
   * vários modelos de uma vez em máquinas fracas. Default: sem limite prático.
   */
  maxConcurrentInit?: number;
  /** Cache por plugin de uma análise anterior (Opt 9): reusa o que não mudou. */
  pluginCache?: PluginCache;
  /** Recebe o cache atualizado por plugin ao fim (para persistir). */
  onPluginCache?: (cache: PluginCache) => void;
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

/**
 * Cede a thread principal para o navegador repintar entre frames, mantendo o
 * editor interativo durante a análise. requestAnimationFrame alinha com o
 * paint (~16ms) e não roda quando a aba está em background.
 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Opt 2: em vez de ceder a thread a CADA frame (um rAF de ~16ms por frame,
 * que domina o tempo quando a inferência é rápida), só cede quando já se gastou
 * este orçamento de trabalho ininterrupto. Mantém a UI responsiva sem pagar o
 * pedágio do rAF em todo frame.
 */
const FRAME_YIELD_BUDGET_MS = 40;

/**
 * Opt 5/6: average-hash (aHash) 8×8 para detectar frames quase idênticos ao
 * último frame realmente inferido. Em footage estática (talking-head,
 * screencast, imagem parada), os modelos de visão re-emitiriam as mesmas
 * detecções — desperdício. Ao pular a inferência e reaproveitar as detecções
 * do frame-âncora (remapeadas para o novo tempo), o resultado é idêntico ao de
 * rodar o modelo, mas sem o custo. O limiar em BITS é bem apertado, então só
 * frames de fato imóveis pulam — movimento real re-ancora e roda tudo.
 */
const HASH_SIZE = 8;
const AHASH_SKIP_BITS = 2;

function aHash(source: HTMLCanvasElement, scratch: HTMLCanvasElement): Uint8Array {
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, HASH_SIZE, HASH_SIZE);
  const { data } = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
  const n = HASH_SIZE * HASH_SIZE;
  const lum = new Float32Array(n);
  let sum = 0;
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[p] = l;
    sum += l;
  }
  const mean = sum / n;
  const bits = new Uint8Array(n);
  for (let p = 0; p < n; p++) bits[p] = lum[p] >= mean ? 1 : 0;
  return bits;
}

function hammingBits(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export async function analyzeMedia(
  options: AnalyzeOptions,
): Promise<SemanticTimeline> {
  const config = resolveConfig(options.config);
  const context: AnalyzerContext = {
    durationSec: options.durationSec,
    config,
    // Resolvido logo antes dos plugins de sequência (Opt 4): o decode de áudio
    // corre em paralelo com o init dos modelos.
    audioPcm: null,
    mediaBlob: options.blob,
    signal: options.signal,
  };

  // Auto-detecta o melhor backend (GPU/WebGL2 vs CPU/WASM) para este
  // dispositivo e o usa — em vez de depender só do toggle manual.
  const backend = detectBestBackend();
  config.performance.useWebGPU = backend === "GPU";

  const allPlugins: SemanticAnalyzerPlugin[] = createPlugins(config);

  // Opt 9: cache granular por plugin. Reaproveita detectores cuja assinatura
  // de config não mudou; só os demais rodam de fato. Se TODOS baterem no cache,
  // pula init/áudio/frames e só remonta a timeline.
  const inCache = options.pluginCache ?? {};
  const outCache: PluginCache = {};
  const cachedEvents: SemanticEvent[] = [];
  const sigById = new Map<string, string>();
  const plugins: SemanticAnalyzerPlugin[] = [];
  for (const p of allPlugins) {
    const sig = pluginSignature(p.id, config);
    sigById.set(p.id, sig);
    const hit = inCache[p.id];
    if (hit && hit.sig === sig) {
      cachedEvents.push(...hit.events);
      outCache[p.id] = hit;
    } else {
      plugins.push(p);
    }
  }

  // Estado por plugin: eventos brutos acumulados (para finalize).
  const rawByPlugin = new Map<string, SemanticEvent[]>();
  for (const p of plugins) rawByPlugin.set(p.id, []);

  options.onProgress?.(
    0,
    `Carregando modelos (${backend === "GPU" ? "GPU" : "CPU/WASM"})`,
  );
  // Init com status por detector — falhas ficam VISÍVEIS (antes eram engolidas,
  // por isso "só fala e texto" apareciam: os modelos de visão falhavam calados).
  // Opt 3: init com concorrência limitada (pool) para não carregar todos os
  // modelos ao mesmo tempo e estourar a RAM em máquinas fracas.
  const statuses: DetectorStatus[] = new Array(plugins.length);
  const initLimit = Math.max(
    1,
    Math.min(options.maxConcurrentInit ?? plugins.length, plugins.length),
  );
  let nextInit = 0;
  const initWorker = async (): Promise<void> => {
    for (;;) {
      const i = nextInit++;
      if (i >= plugins.length) return;
      const p = plugins[i];
      try {
        await p.init(context);
        statuses[i] = { id: p.id, label: p.label, ok: true };
      } catch (err) {
        console.error(`[semantic] init de ${p.id} falhou:`, err);
        statuses[i] = {
          id: p.id,
          label: p.label,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(initLimit, plugins.length) }, initWorker),
  );
  options.onDetectorStatus?.(statuses);

  // 1. Plugins de sequência (áudio / STT) — rodam em paralelo: o STT (worker
  // Whisper) sobrepõe com a análise de áudio/música em vez de um por vez.
  const sequencePlugins = plugins.filter((p) => p.analyzeSequence);
  if (sequencePlugins.length > 0) {
    options.onProgress?.(0.05, "Analisando áudio e fala");
    // Agora sim espera o PCM (decodificou em paralelo com o init acima).
    context.audioPcm = await Promise.resolve(options.audioPcm);
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

  // 2. Plugins de visão — um passe de frames alimenta todos. Mídia só de áudio
  // não tem frames: pula (só os plugins de sequência valem para áudio).
  const audioOnly = options.blob.type.startsWith("audio/");
  const framePlugins = audioOnly
    ? []
    : plugins.filter((p) => p.analyzeFrame);
  const needsFrames = framePlugins.length > 0;

  if (needsFrames) {
    const total = estimateFrameCount(
      options.durationSec,
      config.performance.analysisFps,
    );
    // Scene precisa de todo frame (detecta cortes); os demais são puláveis em
    // frames quase idênticos (Opt 5/6).
    const alwaysRun = framePlugins.filter((p) => p.id === "scene");
    const skippable = framePlugins.filter((p) => p.id !== "scene");
    // Últimas detecções por plugin no frame-âncora (para reaproveitar no skip).
    const lastEventsByPlugin = new Map<string, SemanticEvent[]>();
    // Hash do último frame REALMENTE inferido (âncora) — evita drift: comparar
    // contra o vizinho imediato deixaria diferenças pequenas se acumularem.
    let anchorHash: Uint8Array | null = null;
    const hashScratch = document.createElement("canvas");
    hashScratch.width = HASH_SIZE;
    hashScratch.height = HASH_SIZE;

    let done = 0;
    let lastYield = performance.now();
    for await (const frame of extractFrames(options.blob, {
      fps: config.performance.analysisFps,
      resolution: config.performance.analysisResolution,
      durationSec: options.durationSec,
      signal: options.signal,
    })) {
      if (options.signal.aborted) break;

      const frameEvents: SemanticEvent[] = [];

      // Plugins que precisam de todo frame (scene) sempre rodam.
      if (alwaysRun.length) {
        const results = await Promise.all(
          alwaysRun.map((p) =>
            p.analyzeFrame!(frame, context).catch(() => [] as SemanticEvent[]),
          ),
        );
        alwaysRun.forEach((p, i) => {
          const evs = results[i];
          if (evs.length) {
            rawByPlugin.get(p.id)!.push(...evs);
            frameEvents.push(...evs);
          }
        });
      }

      // Decide se este frame é quase idêntico ao âncora (Opt 5/6).
      const hash = skippable.length ? aHash(frame.image, hashScratch) : null;
      const nearIdentical =
        hash !== null &&
        anchorHash !== null &&
        hammingBits(anchorHash, hash) <= AHASH_SKIP_BITS;

      if (nearIdentical) {
        // Reaproveita as detecções do âncora, remapeadas para este tempo — sem
        // rodar os modelos de visão de novo.
        for (const p of skippable) {
          const last = lastEventsByPlugin.get(p.id);
          if (!last?.length) continue;
          const remapped = last.map((e) => ({
            ...e,
            start: frame.time,
            end: frame.time,
          }));
          rawByPlugin.get(p.id)!.push(...remapped);
          frameEvents.push(...remapped);
        }
      } else if (skippable.length) {
        // Frame novo o bastante: roda todos os detectores de visão em paralelo
        // (OCR/worker sobrepõe com os síncronos) e re-ancora.
        if (hash) anchorHash = hash;
        const results = await Promise.all(
          skippable.map((p) =>
            p.analyzeFrame!(frame, context).catch(() => [] as SemanticEvent[]),
          ),
        );
        skippable.forEach((p, i) => {
          const evs = results[i];
          lastEventsByPlugin.set(p.id, evs);
          if (evs.length) {
            rawByPlugin.get(p.id)!.push(...evs);
            frameEvents.push(...evs);
          }
        });
      }

      options.onFrame?.(frame, frameEvents);
      if (frameEvents.length) options.onEvents?.(frameEvents);

      done++;
      options.onProgress?.(
        0.1 + 0.8 * Math.min(1, done / total),
        "Analisando frames",
      );
      // Respiro só quando já se gastou o orçamento (Opt 2): mantém o preview
      // fluido sem pagar um rAF em cada frame.
      if (performance.now() - lastYield >= FRAME_YIELD_BUDGET_MS) {
        await yieldToUi();
        lastYield = performance.now();
      }
    }
  }

  // 3. Finalização por plugin (tracking, agrupamento de detecções contíguas).
  // Começa com os eventos vindos do cache (plugins não reprocessados).
  options.onProgress?.(0.92, "Consolidando eventos");
  const allEvents: SemanticEvent[] = [...cachedEvents];
  for (const p of plugins) {
    const raw = rawByPlugin.get(p.id)!;
    const finalized = p.finalize ? p.finalize(raw, context) : raw;
    allEvents.push(...finalized);
    // Guarda o resultado finalizado deste plugin para o próximo run (Opt 9).
    outCache[p.id] = { sig: sigById.get(p.id)!, events: finalized };
  }

  for (const p of plugins) p.dispose();

  options.onPluginCache?.(outCache);
  options.onProgress?.(1, "Timeline pronta");
  return buildSemanticTimeline(allEvents, options.durationSec);
}
