/**
 * Store leve do Semantic Media Analyzer: guarda a última timeline gerada por
 * mídia (em memória + IndexedDB) para o editor e a IA reutilizarem sem
 * reanalisar. A timeline é derivada de eventos locais — nunca do vídeo cru.
 */

import { create } from "zustand";
import type { SemanticTimeline } from "./types";

const DB_NAME = "animai-semantic";
const DB_VERSION = 1;
const STORE = "timelines";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "mediaId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTimeline(
  mediaId: string,
  timeline: SemanticTimeline,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ mediaId, timeline });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadTimeline(
  mediaId: string,
): Promise<SemanticTimeline | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(mediaId);
      req.onsuccess = () =>
        resolve(
          (req.result as { timeline: SemanticTimeline } | undefined)?.timeline ??
            null,
        );
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

interface SemanticState {
  /** mediaId → timeline (cache em memória da sessão). */
  timelines: Record<string, SemanticTimeline>;
  setTimeline: (mediaId: string, timeline: SemanticTimeline) => void;
}

export const useSemanticStore = create<SemanticState>((set) => ({
  timelines: {},
  setTimeline: (mediaId, timeline) => {
    set((s) => ({ timelines: { ...s.timelines, [mediaId]: timeline } }));
    void saveTimeline(mediaId, timeline);
  },
}));
