/**
 * Biblioteca de componentes reutilizáveis (prompt.txt item 10).
 *
 * Um componente é um trecho de timeline (clipes + mídia embutida) salvo em
 * IndexedDB de escopo do app — disponível em QUALQUER projeto do usuário,
 * como no Alight Motion. Pode ter fundo transparente (sem clipes de fundo) e
 * ao inserir é re-importado com IDs novos, sem tocar no servidor.
 *
 * MVP: cobre clipes da timeline (vídeo/áudio/imagem) com efeitos, transform,
 * volume e keyframes. Texto/shapes (engines separadas) ficam para a fase 2.
 */

import type { Clip, Track } from "@openreel/core";
import { shortId } from "../lib/short-id";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { loadMediaBlob } from "./media-storage";

const DB_NAME = "animai-components";
const DB_VERSION = 1;
const STORE = "components";

interface StoredMedia {
  /** Chave interna do componente (remapeada ao inserir). */
  key: string;
  name: string;
  blob: Blob;
}

interface StoredClip {
  mediaKey: string;
  trackType: Track["type"];
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  effects: unknown[];
  audioEffects: unknown[];
  transform: unknown;
  volume: number;
  keyframes: unknown[];
  speed?: number;
  fade?: { fadeIn: number; fadeOut: number };
}

export interface StoredComponent {
  id: string;
  name: string;
  transparentBackground: boolean;
  durationSec: number;
  clipCount: number;
  createdAt: number;
  clips: StoredClip[];
  media: StoredMedia[];
}

export interface ComponentSummary {
  id: string;
  name: string;
  transparentBackground: boolean;
  durationSec: number;
  clipCount: number;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function listComponents(): Promise<ComponentSummary[]> {
  const all = await withStore<StoredComponent[]>("readonly", (s) =>
    s.getAll(),
  );
  return all
    .map(({ id, name, transparentBackground, durationSec, clipCount, createdAt }) => ({
      id,
      name,
      transparentBackground,
      durationSec,
      clipCount,
      createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteComponent(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

async function resolveMediaBlob(mediaId: string): Promise<Blob | null> {
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

/**
 * Salva os clipes selecionados como componente reutilizável.
 * Retorna erro legível quando a seleção não é utilizável.
 */
export async function saveComponentFromSelection(
  name: string,
  transparentBackground: boolean,
): Promise<{ ok: true; component: ComponentSummary } | { ok: false; error: string }> {
  const project = useProjectStore.getState().project;
  const selectedIds = new Set(useUIStore.getState().getSelectedClipIds());
  if (selectedIds.size === 0) {
    return { ok: false, error: "Selecione ao menos um clipe na timeline." };
  }

  const found: Array<{ clip: Clip; track: Track }> = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (selectedIds.has(clip.id)) found.push({ clip, track });
    }
  }
  if (found.length === 0) {
    return { ok: false, error: "A seleção não contém clipes da timeline." };
  }

  const minStart = Math.min(...found.map((f) => f.clip.startTime));
  const maxEnd = Math.max(
    ...found.map((f) => f.clip.startTime + f.clip.duration),
  );

  // Empacota as mídias referenciadas (dedup por mediaId).
  const mediaKeyById = new Map<string, string>();
  const media: StoredMedia[] = [];
  for (const { clip } of found) {
    if (mediaKeyById.has(clip.mediaId)) continue;
    const blob = await resolveMediaBlob(clip.mediaId);
    if (!blob) {
      return {
        ok: false,
        error: `Mídia de um clipe não está disponível localmente (${clip.mediaId}).`,
      };
    }
    const item = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
    const key = `m${media.length}`;
    mediaKeyById.set(clip.mediaId, key);
    media.push({ key, name: item?.name ?? "media", blob });
  }

  const component: StoredComponent = {
    id: shortId("comp"),
    name: name.trim() || "Componente",
    transparentBackground,
    durationSec: maxEnd - minStart,
    clipCount: found.length,
    createdAt: Date.now(),
    clips: found.map(({ clip, track }) => ({
      mediaKey: mediaKeyById.get(clip.mediaId)!,
      trackType: track.type,
      startTime: clip.startTime - minStart,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      effects: structuredClone(clip.effects) as unknown[],
      audioEffects: structuredClone(clip.audioEffects) as unknown[],
      transform: structuredClone(clip.transform),
      volume: clip.volume,
      keyframes: structuredClone(clip.keyframes) as unknown[],
      ...(clip.speed !== undefined ? { speed: clip.speed } : {}),
      ...(clip.fade ? { fade: clip.fade } : {}),
    })),
    media,
  };

  await withStore("readwrite", (s) => s.put(component));
  const { clips: _c, media: _m, ...summary } = component;
  return { ok: true, component: summary };
}

/**
 * Insere um componente no projeto ATUAL: re-importa as mídias embutidas,
 * cria tracks novas por tipo e recria os clipes com IDs novos.
 */
export async function insertComponent(
  componentId: string,
  atSec: number,
): Promise<
  { ok: true; clipsCreated: number; name: string } | { ok: false; error: string }
> {
  const component = await withStore<StoredComponent | undefined>(
    "readonly",
    (s) => s.get(componentId),
  );
  if (!component) return { ok: false, error: "Componente não encontrado." };

  const store = useProjectStore.getState();

  // 1. Importa as mídias do pacote e mapeia key → mediaId novo.
  const mediaIdByKey = new Map<string, string>();
  for (const media of component.media) {
    const before = new Set(
      useProjectStore.getState().project.mediaLibrary.items.map((m) => m.id),
    );
    const file = new File([media.blob], media.name, { type: media.blob.type });
    const result = await store.importMedia(file);
    if (!result.success) {
      return {
        ok: false,
        error: `Falha ao importar mídia do componente (${media.name}).`,
      };
    }
    const after = useProjectStore.getState().project.mediaLibrary.items;
    const imported = after.find((m) => !before.has(m.id));
    if (!imported) {
      return { ok: false, error: "Mídia importada não localizada." };
    }
    mediaIdByKey.set(media.key, imported.id);
  }

  // 2. Uma track nova por tipo usado (mantém o componente isolado).
  const trackIdByType = new Map<string, string>();
  for (const type of new Set(component.clips.map((c) => c.trackType))) {
    const before = useProjectStore.getState().project.timeline.tracks;
    const r = await store.addTrack(
      type as "video" | "audio" | "image" | "text" | "graphics",
      0,
    );
    if (!r.success) {
      return { ok: false, error: `Falha ao criar track ${type}.` };
    }
    const after = useProjectStore.getState().project.timeline.tracks;
    const created = after.find((t) => !before.some((b) => b.id === t.id));
    if (!created) return { ok: false, error: "Track criada não localizada." };
    trackIdByType.set(type, created.id);
  }

  // 3. Recria os clipes com fidelidade (efeitos/transform/keyframes) via o
  // sistema de actions — entra no undo como qualquer edição.
  let clipsCreated = 0;
  store.beginHistoryGroup(`Inserir componente: ${component.name}`);
  try {
    for (const clip of component.clips) {
      const result = await store.executeAction({
        type: "clip/add",
        id: shortId("act"),
        timestamp: Date.now(),
        params: {
          trackId: trackIdByType.get(clip.trackType)!,
          mediaId: mediaIdByKey.get(clip.mediaKey)!,
          startTime: atSec + clip.startTime,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          effects: clip.effects,
          audioEffects: clip.audioEffects,
          transform: clip.transform,
          volume: clip.volume,
          keyframes: clip.keyframes,
        },
      });
      if (!result.success) {
        return {
          ok: false,
          error: result.error?.message ?? "Falha ao recriar clipe do componente.",
        };
      }
      clipsCreated++;
    }
  } finally {
    store.endHistoryGroup();
  }

  return { ok: true, clipsCreated, name: component.name };
}
