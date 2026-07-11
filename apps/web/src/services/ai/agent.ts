/**
 * Agent loop (prd.txt §3.3, §4).
 *
 * The LLM call goes through the backend proxy (API keys never reach the
 * client); tool execution happens here in the editor. Each turn streams:
 * thinking → text → tool calls → (tool results fed back) → ... → final text,
 * rendered linearly in the chat UI like Claude Code.
 */

import { API_URL, useAuthStore } from "../../stores/auth-store";
import { getAnimaiPrefs } from "../../stores/settings-store";
import { AI_TOOLS, executeAiTool, getToolDefinition } from "./tools";
import { getCurrentProjectContext } from "./project-context";

/** OpenAI-compatible chat message (what the providers understand). */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One visible block in the chat UI, in linear order. */
export type ChatBlock =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      toolCallId: string;
      name: string;
      args: string;
      status: "pending-confirmation" | "running" | "success" | "error" | "skipped";
      result?: string;
    };

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  blocks: ChatBlock[];
  createdAt: number;
  /** Tokens gastos nesta requisição (soma das iterações do loop agêntico). */
  tokens?: number;
}

export interface StreamCallbacks {
  onThinkingDelta: (delta: string) => void;
  onTextDelta: (delta: string) => void;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  toolCalls: LlmToolCall[];
  usage: TokenUsage | null;
}

const MAX_AGENT_ITERATIONS = 12;

export const COMPACT_EVERY_N_REQUESTS = 10;
export const SUMMARY_CHAR_LIMIT = 5000;

export function buildSystemPrompt(summary: string): string {
  const context = getCurrentProjectContext();
  const customPrompt = getAnimaiPrefs().customAiPrompt.trim();
  return [
    "Você é o assistente de edição de vídeo do AnimAI, integrado ao editor.",
    "Você edita o vídeo do usuário chamando tools; toda mudança aparece imediatamente na timeline e pode ser desfeita (undo).",
    "Regras:",
    "- Sempre confira ids e tempos atuais com get_project_state antes de editar (o estado muda entre mensagens).",
    "- Tempos em segundos. Responda em português, de forma curta e direta.",
    "- Se uma tool falhar, leia o erro, corrija os parâmetros e tente de novo.",
    "- Não invente ids de clipes ou mídias.",
    "- O contexto já traz, por mídia: metadados do arquivo (file), transcrição (transcripts) e análise local (insights: perfil de energia do áudio mesmo sem fala — música/silêncio/BPM — e onScreenText, texto embutido na tela via OCR). Use essas informações direto do contexto, sem tool.",
    "- editorState mostra o que o usuário está fazendo AGORA: playhead (clipsAtPlayhead = o que ele está vendo), selectedClips (o que está selecionado) e recentActions (o que acabou de acontecer). Quando o usuário disser 'esse clipe', 'aqui', 'isso que eu fiz', resolva por editorState em vez de perguntar.",
    "- Análise semântica do vídeo: você NUNCA vê o vídeo diretamente. Para entender o conteúdo visual (pessoas, objetos, veículos, animais, rostos, sorrisos/expressões, poses, gestos, cenas/cortes, textos na tela, ambiente), use a Timeline Semântica. Se media[].semanticTimeline.available existir, use get_semantic_timeline/find_moments direto; senão, chame run_semantic_analysis primeiro (demora). Para editar por intenção (cortar silêncios, dar zoom quando a pessoa sorri, achar animais/veículos, montar Shorts/melhores momentos), busque os momentos com find_moments e aplique com split_clip/trim_clip/delete_clip/apply_camera_move. cut_silences automatiza a remoção de silêncios.",
    "- Só chame get_media_insights se uma mídia não tiver o campo insights (a tool dispara a análise local e espera) ou se precisar dos segmentos completos.",
    customPrompt
      ? `\nInstruções personalizadas do usuário (perfil):\n${customPrompt.slice(0, 2000)}`
      : "",
    summary
      ? `\nResumo da conversa até aqui (memória compactada):\n${summary}`
      : "",
    `\nEstado atual do projeto (JSON global):\n${JSON.stringify(context)}`,
  ].join("\n");
}

/**
 * Stream one LLM call through the backend. SSE events:
 *  data: {"reasoning": "..."} | {"content": "..."} | {"tool_calls": [...]} | {"done": true} | {"error": "..."}
 */
export async function streamChat(
  messages: LlmMessage[],
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<StreamResult> {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${API_URL}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      messages,
      tools: AI_TOOLS.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      // BYOK: API própria do usuário (configurada no perfil). Nesse modo o
      // servidor não consome saldo — vale o limite de requisições/mês.
      ...(() => {
        const byok = getAnimaiPrefs().byok;
        return byok.enabled && byok.baseUrl && byok.apiKey && byok.model
          ? { byok }
          : {};
      })(),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Falha na chamada de IA (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const result: StreamResult = {
    content: "",
    reasoning: "",
    toolCalls: [],
    usage: null,
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: {
        reasoning?: string;
        content?: string;
        tool_calls?: LlmToolCall[];
        usage?: TokenUsage;
        error?: string;
      };
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      if (event.reasoning) {
        result.reasoning += event.reasoning;
        callbacks.onThinkingDelta(event.reasoning);
      }
      if (event.content) {
        result.content += event.content;
        callbacks.onTextDelta(event.content);
      }
      if (event.tool_calls) {
        result.toolCalls.push(...event.tool_calls);
      }
      if (event.usage) {
        result.usage = event.usage;
      }
    }
  }

  return result;
}

export interface AgentRunCallbacks extends StreamCallbacks {
  /** A new LLM iteration started (new thinking/text blocks begin). */
  onIterationStart: () => void;
  /** Token usage reported by the provider for one LLM call. */
  onUsage: (usage: TokenUsage) => void;
  onToolStart: (call: LlmToolCall) => void;
  onToolEnd: (
    call: LlmToolCall,
    outcome: { status: "success" | "error" | "skipped"; result: string },
  ) => void;
  /** Ask the user to confirm a bulk-destructive tool. Resolves false to skip. */
  confirmDestructive: (call: LlmToolCall) => Promise<boolean>;
}

/**
 * Run the agent loop for one user request. Mutates `messages` in place
 * (appends assistant/tool messages) and returns when the model produces a
 * final answer without tool calls, the iteration cap is hit, or `signal`
 * aborts.
 */
export async function runAgentTurn(
  messages: LlmMessage[],
  callbacks: AgentRunCallbacks,
  signal: AbortSignal,
): Promise<void> {
  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    if (signal.aborted) return;
    callbacks.onIterationStart();

    const result = await streamChat(
      [
        { role: "system", content: buildSystemPrompt(currentSummary) },
        ...messages,
      ],
      callbacks,
      signal,
    );

    if (result.usage) callbacks.onUsage(result.usage);

    messages.push({
      role: "assistant",
      content: result.content || null,
      ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}),
    });

    if (result.toolCalls.length === 0) return;

    for (const call of result.toolCalls) {
      if (signal.aborted) return;
      const definition = getToolDefinition(call.function.name);

      let outcome: { status: "success" | "error" | "skipped"; result: string };
      if (definition?.destructive) {
        const approved = await callbacks.confirmDestructive(call);
        if (!approved) {
          outcome = {
            status: "skipped",
            result: "Usuário recusou a execução desta ação.",
          };
          callbacks.onToolEnd(call, outcome);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: outcome.result }),
          });
          continue;
        }
      }

      callbacks.onToolStart(call);
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        // Model produced invalid JSON; feed the error back.
      }
      const toolResult = await executeAiTool(call.function.name, args);
      outcome = {
        status: toolResult.ok ? "success" : "error",
        result: toolResult.ok
          ? JSON.stringify(toolResult.result ?? "ok")
          : (toolResult.error ?? "erro desconhecido"),
      };
      callbacks.onToolEnd(call, outcome);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
    }
  }
}

// The compacted summary lives here so buildSystemPrompt can read it; the
// chat store keeps it in sync with IndexedDB.
let currentSummary = "";
export function setCurrentSummary(summary: string): void {
  currentSummary = summary;
}

/** Ask the backend to update the compacted summary (prd.txt §3.4). */
export async function compactConversation(
  previousSummary: string,
  recentMessages: LlmMessage[],
): Promise<{ summary: string; totalTokens: number }> {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${API_URL}/api/ai/compact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      summary: previousSummary,
      messages: recentMessages,
      charLimit: SUMMARY_CHAR_LIMIT,
    }),
  });
  if (!response.ok) {
    throw new Error(`Falha ao compactar conversa (HTTP ${response.status})`);
  }
  const data = (await response.json()) as {
    summary: string;
    totalTokens?: number;
  };
  return {
    summary: data.summary.slice(0, SUMMARY_CHAR_LIMIT),
    totalTokens: data.totalTokens ?? 0,
  };
}
