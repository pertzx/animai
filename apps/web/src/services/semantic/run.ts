/**
 * Roda o Semantic Media Analyzer sobre uma mídia do projeto e cacheia a
 * timeline. Ponte entre a biblioteca de mídia do editor e o orquestrador.
 * A IA nunca recebe o vídeo — só a timeline resultante.
 */

import { useProjectStore } from "../../stores/project-store";
import { loadMediaBlob } from "../media-storage";
import { analyzeMedia } from "./orchestrator";
import { decodeBlobAudio } from "./audio-decode";
import { getAnalyzerConfig, getMaxConcurrentModels } from "./config";
import {
  useSemanticStore,
  loadTimeline,
  loadPluginCache,
  savePluginCache,
} from "./store";
import type { PluginCache, SemanticTimeline } from "./types";

async function getMediaBlob(mediaId: string): Promise<Blob | null> {
  const item = useProjectStore
    .getState()
    .project.mediaLibrary.items.find((m) => m.id === mediaId);
  if (!item) return null;
  if (item.blob) return item.blob;
  if (item.fileHandle) {
    try {
      return await item.fileHandle.getFile();
    } catch {
      /* cai no storage */
    }
  }
  return loadMediaBlob(mediaId);
}

/** Duração da mídia (metadados do projeto). */
function mediaDuration(mediaId: string): number {
  const item = useProjectStore
    .getState()
    .project.mediaLibrary.items.find((m) => m.id === mediaId);
  return item?.metadata.duration ?? 0;
}

export interface RunProgress {
  fraction: number;
  stage: string;
}

/**
 * Garante a timeline semântica de uma mídia: retorna a cacheada (memória →
 * IndexedDB) ou dispara a análise. `force` reanalisa mesmo com cache.
 */
export async function ensureSemanticTimeline(
  mediaId: string,
  options: {
    force?: boolean;
    signal?: AbortSignal;
    onProgress?: (p: RunProgress) => void;
  } = {},
): Promise<SemanticTimeline | null> {
  if (!options.force) {
    const mem = useSemanticStore.getState().timelines[mediaId];
    if (mem) return mem;
    const stored = await loadTimeline(mediaId);
    if (stored) {
      useSemanticStore.getState().setTimeline(mediaId, stored);
      return stored;
    }
  }

  const blob = await getMediaBlob(mediaId);
  if (!blob) return null;
  const durationSec = mediaDuration(mediaId) || 0;
  if (!durationSec) return null;

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  // Opt 4: NÃO espera o decode de áudio aqui — passa a promessa. O orquestrador
  // carrega os modelos (init) enquanto o áudio decodifica em paralelo, em vez
  // de bloquear a thread esperando o PCM antes de começar qualquer coisa.
  const audioPcm = decodeBlobAudio(blob).catch(() => null);

  // Opt 9: carrega o cache por plugin da última análise — detectores cuja
  // config não mudou são reaproveitados em vez de rodar de novo.
  const pluginCache = (await loadPluginCache(mediaId).catch(() => null)) ?? undefined;
  let nextCache: PluginCache | null = null;

  const timeline = await analyzeMedia({
    blob,
    durationSec,
    config: getAnalyzerConfig(),
    audioPcm,
    maxConcurrentInit: getMaxConcurrentModels(),
    pluginCache,
    onPluginCache: (cache) => {
      nextCache = cache;
    },
    signal,
    onProgress: (fraction, stage) => options.onProgress?.({ fraction, stage }),
  });

  useSemanticStore.getState().setTimeline(mediaId, timeline);
  if (nextCache) void savePluginCache(mediaId, nextCache);
  return timeline;
}

/** Timeline já cacheada (sem disparar análise). */
export async function getCachedTimeline(
  mediaId: string,
): Promise<SemanticTimeline | null> {
  const mem = useSemanticStore.getState().timelines[mediaId];
  if (mem) return mem;
  return loadTimeline(mediaId);
}
