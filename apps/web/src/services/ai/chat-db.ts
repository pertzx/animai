/**
 * Local chat persistence per project (prd.txt §3.4).
 *
 * IndexedDB (not localStorage — 5 MB limit) holds, per project: the visible
 * chat turns, the LLM message history, the compacted summary and the request
 * counter used to trigger compaction. Reopening a project restores the AI's
 * "memory" without any provider-side caching.
 */

import type { ChatTurn, LlmMessage } from "./agent";

const DB_NAME = "animai-chat";
const DB_VERSION = 1;
const STORE = "chats";

export interface StoredChat {
  projectId: string;
  turns: ChatTurn[];
  llmMessages: LlmMessage[];
  summary: string;
  requestsSinceCompact: number;
  /** Total de tokens de IA gastos neste projeto (todas as requisições). */
  totalTokens?: number;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "projectId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadChat(projectId: string): Promise<StoredChat | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(projectId);
      request.onsuccess = () =>
        resolve((request.result as StoredChat | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveChat(chat: StoredChat): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...chat, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function clearChat(projectId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
