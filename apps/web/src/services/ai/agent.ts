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
import {
  recordToolError,
  renderWorkingMemory,
  resetWorkingMemory,
} from "./working-memory";
import { ELEMENT_CAPABILITIES_DOC } from "./element-capabilities";

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

export const COMPACT_EVERY_N_REQUESTS = 4;
export const SUMMARY_CHAR_LIMIT = 5000;

export function buildSystemPrompt(summary: string): string {
  const context = getCurrentProjectContext();
  const customPrompt = getAnimaiPrefs().customAiPrompt.trim();
  const workingMemory = renderWorkingMemory();

  const parts = [
    "Você é o editor de vídeo AGÊNTICO do AnimAI, dentro do editor. Você EDITA o vídeo chamando tools; toda mudança aparece na timeline e pode ser desfeita (undo). Você age como um profissional: pensa, planeja, executa e confere o próprio trabalho.",
    "",
    "TRABALHE EM FASES, raciocinando de forma concisa antes de agir:",
    "1) ENTENDER — reformule em 1 frase o que o usuário quer. Se o pedido for AMBÍGUO ou faltar informação essencial para não errar, faça UMA pergunta objetiva e pare (não chute).",
    "2) PLANEJAR — para tarefas de várias etapas, liste 2 a 6 passos curtos e verificáveis ANTES de agir. Pedido trivial (ex.: uma saudação, uma pergunta): pule direto para RESPONDER.",
    "3) AGIR — execute UM passo por vez. SEMPRE chame get_project_state antes de editar, para pegar ids e posições atuais (o estado muda entre mensagens). Nunca invente ids.",
    "4) VALIDAR — depois de editar, releia o estado e confira que o objetivo foi cumprido: sem sobreposição (o campo overlap:true no contexto sinaliza colisão), cores com contraste, tempos e ids certos. Se algo ficou errado, CORRIJA (update_element/delete_clip) e valide de novo. NUNCA finalize um pedido de edição sem esta fase.",
    "5) RESPONDER — só no final, dê uma resposta CURTA ao usuário (brevidade vale só aqui; nas fases acima, pense o quanto precisar).",
    "",
    "GUIA DE TOOLS (escolha a família certa):",
    "- Consultar: get_project_state (estado/ids/posições/overlap), get_transcript (fala), get_media_insights (áudio/OCR), get_semantic_timeline e find_moments (conteúdo visual do vídeo).",
    "- Mover no TEMPO: split_clip / trim_clip / move_clip. Mover/estilizar na TELA (posição, cor, tamanho): update_element. NÃO confunda tempo com posição.",
    "- Criar: add_text e add_vector (com x, y, cor, tamanho), add_clip, apply_effect, apply_transition, add_captions, cut_silences, apply_camera_move.",
    "- Apagar QUALQUER elemento (clipe, texto, vetor, legenda) pelo id: delete_clip.",
    "- Se uma tool falhar, LEIA o erro, diagnostique a causa, ajuste os parâmetros e tente de novo — não repita o mesmo erro.",
    "",
    "Você é o DIRETOR DE ARTE: cada texto/clipe/vetor no contexto traz x, y, color, fontSize e overlap — LEIA antes de criar/editar. Consulte o manual abaixo para saber TODA propriedade que cada elemento aceita; não deixe nada no padrão sem intenção.",
    "",
    ELEMENT_CAPABILITIES_DOC,
    "",
    "CONTEXTO: o JSON do projeto já traz, por mídia: file (metadados), transcripts (fala, pode vir resumida — use get_transcript para o texto completo) e insights (energia de áudio/OCR). Use direto, sem tool. editorState mostra o AGORA: clipsAtPlayhead (o que o usuário vê), selectedClips (seleção), recentActions — quando ele disser 'esse clipe'/'aqui'/'isso', resolva por editorState.",
    "ANÁLISE SEMÂNTICA: você NUNCA vê o vídeo. Para conteúdo visual (pessoas, objetos, rostos, expressões, poses, cenas/cortes, texto na tela, ambiente) use a Timeline Semântica: se media[].semanticTimeline.available, use get_semantic_timeline/find_moments; senão run_semantic_analysis antes (demora). Edite por intenção com find_moments + split_clip/trim_clip/delete_clip/apply_camera_move; cut_silences remove silêncios.",
  ];

  if (workingMemory) parts.push(workingMemory);
  if (customPrompt) {
    parts.push(`\nInstruções personalizadas do usuário (perfil):\n${customPrompt.slice(0, 2000)}`);
  }
  if (summary) {
    parts.push(`\nResumo da conversa até aqui (memória compactada):\n${summary}`);
  }
  parts.push(`\nEstado atual do projeto (JSON global):\n${JSON.stringify(context)}`);

  return parts.join("\n");
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
  // Novo turno: zera os erros de tools acumulados (memória de trabalho).
  resetWorkingMemory();

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
      // Erro fica saliente na memória de trabalho para o modelo corrigir na
      // fase VALIDAR, em vez de repetir o mesmo erro ou desistir calado.
      if (!toolResult.ok) {
        recordToolError(`${call.function.name}: ${outcome.result}`);
      }
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

/** System prompt atual (com o resumo vigente) — usado pelo runtime do SDK. */
export function currentSystemPrompt(): string {
  return buildSystemPrompt(currentSummary);
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
