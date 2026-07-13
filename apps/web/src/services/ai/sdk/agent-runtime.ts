/**
 * Runtime agêntico sobre o OpenAI Agents SDK (substitui runAgentTurn).
 *
 * Reusa TUDO que já existe: as 32 tools (JSON Schema aceito pelo SDK), o system
 * prompt por fases + doc de capacidades, e o executor executeAiTool. O loop de
 * tools passa a ser do SDK (mais robusto); as tools continuam rodando no
 * navegador (editam o project-store); o LLM vai pelo passthrough do backend.
 *
 * Um único agente (não Planner+Executor+Reflector separados) — o raciocínio por
 * fases mora no prompt, então planejamento e validação acontecem na mesma
 * chamada, sem multiplicar tokens.
 */

import { Agent, run, tool } from "@openai/agents";
import {
  AI_TOOLS,
  executeAiTool,
  type AiToolDefinition,
} from "../tools";
import {
  currentSystemPrompt,
  type AgentRunCallbacks,
  type LlmMessage,
  type LlmToolCall,
} from "../agent";
import { ensureSdkConfigured } from "./setup";

/** Ligar/desligar o runtime do SDK (fallback para o loop legado). */
export const USE_SDK_AGENT = true;

// Máx. de "turnos" do agente (cada turno = 1 chamada de LLM que pode disparar
// várias tools). Generoso para tarefas complexas (montar um anúncio inteiro),
// mas ainda um teto contra loop infinito. Ao estourar, encerra com aviso.
const MAX_TURNS = 40;

/** Contexto por turno passado às tools (para reportar início/fim à UI). */
interface TurnContext {
  callbacks: AgentRunCallbacks;
}

/** Embrulha uma tool existente como tool do SDK, reusando o JSON Schema. */
function toSdkTool(def: AiToolDefinition) {
  return tool({
    name: def.name,
    description: def.description,
    // O SDK aceita JSON Schema direto (ToolInputParameters). Sem strict para
    // permitir campos opcionais como nas definições atuais.
    parameters: def.parameters as never,
    strict: false,
    // HITL: tools destrutivas (delete em massa) PAUSAM para o usuário aprovar
    // antes de executar (o SDK gera uma "interruption").
    needsApproval: def.destructive === true,
    execute: async (input: unknown, runContext?: unknown) => {
      const args = (input ?? {}) as Record<string, unknown>;
      const call: LlmToolCall = {
        id: `call_${Math.random().toString(36).slice(2, 10)}`,
        type: "function",
        function: { name: def.name, arguments: JSON.stringify(args) },
      };
      const cb = (runContext as { context?: TurnContext } | undefined)?.context
        ?.callbacks;
      cb?.onToolStart(call);
      const result = await executeAiTool(def.name, args);
      cb?.onToolEnd(call, {
        status: result.ok ? "success" : "error",
        result: result.ok
          ? JSON.stringify(result.result ?? "ok")
          : (result.error ?? "erro desconhecido"),
      });
      return JSON.stringify(result);
    },
  });
}

function createAgent() {
  return new Agent({
    name: "AnimAI",
    // Prompt dinâmico (fases + doc de capacidades + contexto do projeto).
    instructions: () => currentSystemPrompt(),
    // Placeholder: o backend FORÇA o modelo do provider; este valor é ignorado.
    model: "animai",
    tools: AI_TOOLS.map(toSdkTool),
  });
}

let agentSingleton: ReturnType<typeof createAgent> | null = null;

function getAgent(): ReturnType<typeof createAgent> {
  return (agentSingleton ??= createAgent());
}

/** Converte o histórico do chat para itens de input do SDK (texto user/assistant). */
function toInputItems(messages: LlmMessage[]) {
  return messages
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0,
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
}

/**
 * Roda um turno do agente pelo SDK. Mesma assinatura de runAgentTurn, para o
 * chat-store trocar sem mudar mais nada.
 */
export async function runSdkTurn(
  messages: LlmMessage[],
  callbacks: AgentRunCallbacks,
  signal: AbortSignal,
): Promise<void> {
  ensureSdkConfigured();
  callbacks.onIterationStart();

  const runOptions = {
    stream: true as const,
    signal,
    maxTurns: MAX_TURNS,
    context: { callbacks } satisfies TurnContext,
  };

  try {
    let result = await run(getAgent(), toInputItems(messages) as never, runOptions);
    await consumeStream(result, callbacks, signal);

    // Loop de aprovação HITL: enquanto houver tools aguardando confirmação,
    // pergunta ao usuário, aprova/rejeita e retoma a execução de onde parou.
    let guard = 0;
    while (
      !signal.aborted &&
      result.interruptions &&
      result.interruptions.length > 0 &&
      guard++ < 10
    ) {
      for (const approval of result.interruptions) {
        const call: LlmToolCall = {
          id:
            ((approval as { rawItem?: { callId?: string } }).rawItem?.callId) ??
            `appr_${Math.random().toString(36).slice(2, 8)}`,
          type: "function",
          function: {
            name: approval.name ?? "ação destrutiva",
            arguments: approval.arguments ?? "{}",
          },
        };
        const approved = await callbacks.confirmDestructive(call);
        if (approved) result.state.approve(approval);
        else result.state.reject(approval);
      }
      result = await run(getAgent(), result.state as never, runOptions);
      await consumeStream(result, callbacks, signal);
    }

    emitUsage(result, callbacks);

    const final = result.finalOutput;
    const finalText =
      typeof final === "string" ? final : final ? String(final) : "";
    messages.push({ role: "assistant", content: finalText || null });
  } catch (err) {
    if (signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    // Estourou o teto de passos numa tarefa longa: encerra com aviso em vez de
    // quebrar, preservando tudo o que já foi executado.
    if (/max.*turns|turns.*exceed/i.test(msg)) {
      callbacks.onTextDelta(
        "\n\n⚠️ A tarefa exigiu muitos passos e cheguei ao limite desta rodada. O que já fiz está aplicado — é só pedir para eu **continuar** de onde parei.",
      );
      messages.push({
        role: "assistant",
        content: "(limite de passos atingido; aguardando continuar)",
      });
      return;
    }
    throw err;
  }
}

/**
 * Consome o stream de eventos do SDK, mapeando para a UI:
 * - texto (output_text_delta) → onTextDelta (streaming token a token);
 * - raciocínio (reasoning_item_created) → onThinkingDelta (bloco "Pensando");
 * As tools reportam início/fim dentro do próprio execute (onToolStart/End).
 */
async function consumeStream(
  result: unknown,
  callbacks: AgentRunCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const stream = result as AsyncIterable<unknown> & { completed: Promise<void> };
  for await (const event of stream) {
    if (signal.aborted) break;
    const ev = event as {
      type?: string;
      name?: string;
      data?: { type?: string; delta?: string };
      item?: unknown;
    };
    if (ev.type === "raw_model_stream_event") {
      if (ev.data?.type === "output_text_delta" && ev.data.delta) {
        callbacks.onTextDelta(ev.data.delta);
      }
    } else if (
      ev.type === "run_item_stream_event" &&
      ev.name === "reasoning_item_created"
    ) {
      const text = extractReasoning(ev.item);
      if (text) callbacks.onThinkingDelta(text);
    }
  }
  await stream.completed;
}

/** Extrai o texto de um item de raciocínio (formatos variam por provider). */
function extractReasoning(item: unknown): string {
  const raw = (item as { rawItem?: { content?: unknown } })?.rawItem;
  const content = raw?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : (c as { text?: string })?.text ?? ""))
      .join("");
  }
  return "";
}

/** Reporta o uso de tokens à UI (o billing real é feito no servidor). */
function emitUsage(result: unknown, callbacks: AgentRunCallbacks): void {
  try {
    const usage = (
      result as {
        state?: { context?: { usage?: Record<string, number> } };
      }
    )?.state?.context?.usage;
    if (!usage) return;
    const prompt = usage.inputTokens ?? usage.promptTokens ?? 0;
    const completion = usage.outputTokens ?? usage.completionTokens ?? 0;
    const total = usage.totalTokens ?? prompt + completion;
    if (total > 0) {
      callbacks.onUsage({
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: total,
      });
    }
  } catch {
    /* best-effort */
  }
}
