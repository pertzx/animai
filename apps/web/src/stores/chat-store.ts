/**
 * Chat state for the AI panel (prd.txt §3.3, §3.4, §4).
 *
 * Orchestrates the agent loop, renders its progress as linear blocks
 * (thinking → text → tool cards), persists everything per project in
 * IndexedDB and compacts the history every 10 requests.
 */

import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { ChatBlock, ChatTurn, LlmMessage, LlmToolCall } from "../services/ai/agent";
import {
  COMPACT_EVERY_N_REQUESTS,
  compactConversation,
  runAgentTurn,
  setCurrentSummary,
} from "../services/ai/agent";
import { loadChat, saveChat, clearChat } from "../services/ai/chat-db";
import { useProjectStore } from "./project-store";

interface PendingConfirmation {
  call: LlmToolCall;
  resolve: (approved: boolean) => void;
}

interface ChatState {
  projectId: string | null;
  turns: ChatTurn[];
  llmMessages: LlmMessage[];
  summary: string;
  requestsSinceCompact: number;
  /** Tokens gastos no projeto inteiro (persistido). */
  totalTokens: number;
  /** Tokens da última requisição (soma das iterações do loop). */
  lastRequestTokens: number;
  running: boolean;
  compacting: boolean;
  pendingConfirmation: PendingConfirmation | null;
  error: string | null;

  initForProject: (projectId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  interrupt: () => void;
  resolveConfirmation: (approved: boolean) => void;
  clearHistory: () => Promise<void>;
}

let abortController: AbortController | null = null;

function lastTurn(turns: ChatTurn[]): ChatTurn {
  return turns[turns.length - 1];
}

export const useChatStore = create<ChatState>((set, get) => {
  const persist = () => {
    const {
      projectId,
      turns,
      llmMessages,
      summary,
      requestsSinceCompact,
      totalTokens,
    } = get();
    if (!projectId) return;
    void saveChat({
      projectId,
      turns,
      llmMessages,
      summary,
      requestsSinceCompact,
      totalTokens,
      updatedAt: Date.now(),
    });
  };

  /** Append/replace blocks of the current assistant turn immutably. */
  const updateAssistantTurn = (updater: (blocks: ChatBlock[]) => ChatBlock[]) => {
    set((state) => {
      const turns = [...state.turns];
      const turn = lastTurn(turns);
      if (!turn || turn.role !== "assistant") return {};
      turns[turns.length - 1] = { ...turn, blocks: updater([...turn.blocks]) };
      return { turns };
    });
  };

  return {
    projectId: null,
    turns: [],
    llmMessages: [],
    summary: "",
    requestsSinceCompact: 0,
    totalTokens: 0,
    lastRequestTokens: 0,
    running: false,
    compacting: false,
    pendingConfirmation: null,
    error: null,

    initForProject: async (projectId) => {
      if (get().projectId === projectId) return;
      const stored = await loadChat(projectId);
      setCurrentSummary(stored?.summary ?? "");
      set({
        projectId,
        turns: stored?.turns ?? [],
        llmMessages: stored?.llmMessages ?? [],
        summary: stored?.summary ?? "",
        requestsSinceCompact: stored?.requestsSinceCompact ?? 0,
        totalTokens: stored?.totalTokens ?? 0,
        lastRequestTokens: 0,
        running: false,
        pendingConfirmation: null,
        error: null,
      });
    },

    sendMessage: async (text) => {
      const state = get();
      if (state.running || !text.trim()) return;

      abortController = new AbortController();
      const signal = abortController.signal;

      const userTurn: ChatTurn = {
        id: uuidv4(),
        role: "user",
        blocks: [{ kind: "text", text }],
        createdAt: Date.now(),
      };
      const assistantTurn: ChatTurn = {
        id: uuidv4(),
        role: "assistant",
        blocks: [],
        createdAt: Date.now(),
      };

      const llmMessages = [...state.llmMessages, { role: "user" as const, content: text }];
      set({
        turns: [...state.turns, userTurn, assistantTurn],
        llmMessages,
        running: true,
        lastRequestTokens: 0,
        error: null,
      });

      try {
        await runAgentTurn(
          llmMessages,
          {
            onIterationStart: () => {
              // New thinking/text blocks start on each iteration.
              updateAssistantTurn((blocks) => blocks);
            },
            onUsage: (usage) => {
              set((s) => {
                const turns = [...s.turns];
                const turn = turns[turns.length - 1];
                if (turn?.role === "assistant") {
                  turns[turns.length - 1] = {
                    ...turn,
                    tokens: (turn.tokens ?? 0) + usage.totalTokens,
                  };
                }
                return {
                  turns,
                  totalTokens: s.totalTokens + usage.totalTokens,
                  lastRequestTokens: s.lastRequestTokens + usage.totalTokens,
                };
              });
            },
            onThinkingDelta: (delta) => {
              updateAssistantTurn((blocks) => {
                const last = blocks[blocks.length - 1];
                if (last?.kind === "thinking") {
                  blocks[blocks.length - 1] = {
                    ...last,
                    text: last.text + delta,
                  };
                } else {
                  blocks.push({ kind: "thinking", text: delta });
                }
                return blocks;
              });
            },
            onTextDelta: (delta) => {
              updateAssistantTurn((blocks) => {
                const last = blocks[blocks.length - 1];
                if (last?.kind === "text") {
                  blocks[blocks.length - 1] = { ...last, text: last.text + delta };
                } else {
                  blocks.push({ kind: "text", text: delta });
                }
                return blocks;
              });
            },
            onToolStart: (call) => {
              updateAssistantTurn((blocks) => {
                const existing = blocks.findIndex(
                  (b) => b.kind === "tool" && b.toolCallId === call.id,
                );
                const block: ChatBlock = {
                  kind: "tool",
                  toolCallId: call.id,
                  name: call.function.name,
                  args: call.function.arguments,
                  status: "running",
                };
                if (existing >= 0) blocks[existing] = block;
                else blocks.push(block);
                return blocks;
              });
            },
            onToolEnd: (call, outcome) => {
              updateAssistantTurn((blocks) => {
                const index = blocks.findIndex(
                  (b) => b.kind === "tool" && b.toolCallId === call.id,
                );
                const block: ChatBlock = {
                  kind: "tool",
                  toolCallId: call.id,
                  name: call.function.name,
                  args: call.function.arguments,
                  status: outcome.status,
                  result: outcome.result,
                };
                if (index >= 0) blocks[index] = block;
                else blocks.push(block);
                return blocks;
              });
            },
            confirmDestructive: (call) =>
              new Promise<boolean>((resolve) => {
                updateAssistantTurn((blocks) => {
                  blocks.push({
                    kind: "tool",
                    toolCallId: call.id,
                    name: call.function.name,
                    args: call.function.arguments,
                    status: "pending-confirmation",
                  });
                  return blocks;
                });
                set({ pendingConfirmation: { call, resolve } });
              }),
          },
          signal,
        );
      } catch (err) {
        if (!signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          set({ error: message });
          updateAssistantTurn((blocks) => {
            blocks.push({ kind: "text", text: `⚠️ ${message}` });
            return blocks;
          });
        }
      } finally {
        abortController = null;
        const requests = get().requestsSinceCompact + 1;
        set({ running: false, pendingConfirmation: null, requestsSinceCompact: requests });
        persist();

        // Memory compaction every N requests (prd.txt §3.4).
        if (requests >= COMPACT_EVERY_N_REQUESTS) {
          set({ compacting: true });
          try {
            const { summary, llmMessages: all } = get();
            const compacted = await compactConversation(summary, all);
            setCurrentSummary(compacted.summary);
            // Keep only the tail of raw messages; the summary carries the rest.
            const tail = all.slice(-6).filter((m) => m.role !== "tool");
            set((s) => ({
              summary: compacted.summary,
              llmMessages: tail,
              requestsSinceCompact: 0,
              totalTokens: s.totalTokens + compacted.totalTokens,
            }));
            persist();
          } catch {
            // Compaction is opportunistic; try again after the next request.
          } finally {
            set({ compacting: false });
          }
        }
      }
    },

    interrupt: () => {
      abortController?.abort();
      const pending = get().pendingConfirmation;
      if (pending) {
        pending.resolve(false);
        set({ pendingConfirmation: null });
      }
      set({ running: false });
      persist();
    },

    resolveConfirmation: (approved) => {
      const pending = get().pendingConfirmation;
      if (!pending) return;
      set({ pendingConfirmation: null });
      pending.resolve(approved);
    },

    clearHistory: async () => {
      const projectId = get().projectId ?? useProjectStore.getState().project.id;
      await clearChat(projectId);
      setCurrentSummary("");
      set({
        turns: [],
        llmMessages: [],
        summary: "",
        requestsSinceCompact: 0,
        error: null,
      });
    },
  };
});
