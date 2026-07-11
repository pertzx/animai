/**
 * Roda o Semantic Media Analyzer sobre uma mídia do projeto e cacheia a
 * timeline. Ponte entre a biblioteca de mídia do editor e o orquestrador.
 * A IA nunca recebe o vídeo — só a timeline resultante.
 */

import { useProjectStore } from "../../stores/project-store";
import { loadMediaBlob } from "../media-storage";
import { analyzeMedia } from "./orchestrator";
import { decodeBlobAudio } from "./audio-decode";
import { getAnalyzerConfig } from "./config";
import { useSemanticStore, loadTimeline } from "./store";
import type { SemanticTimeline } from "./types";

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
  const audioPcm = await decodeBlobAudio(blob);

  const timeline = await analyzeMedia({
    blob,
    durationSec,
    config: getAnalyzerConfig(),
    audioPcm,
    signal,
    onProgress: (fraction, stage) => options.onProgress?.({ fraction, stage }),
  });

  useSemanticStore.getState().setTimeline(mediaId, timeline);
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
