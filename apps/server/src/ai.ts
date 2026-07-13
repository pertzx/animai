/**
 * Proxy de IA (prd.txt §3.3, §7): o client nunca vê API keys.
 *
 * Providers são OpenAI-compatíveis (chat/completions). Iniciais: Nvidia e
 * OpenAI (prd.txt §3.3); o admin pode cadastrar outros no painel. O stream do
 * provider é convertido em eventos SSE simples para o front:
 *   data: {"reasoning": "..."} | {"content": "..."} | {"tool_calls": [...]} | {"error": "..."} | [DONE]
 */

import type { Request, Response } from "express";
import { config } from "./config.js";
import { AiProvider, Plan, User, getBillingSettings } from "./models.js";
import { buildPublicUser, rolloverAiPeriod } from "./auth.js";

interface ProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** USD por 1M de tokens (custo real, sem margem). */
  inputCostPerM: number;
  outputCostPerM: number;
}

/** Provider próprio do usuário (BYOK): volta ao limite por requisições. */
interface ByokConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const FALLBACK_PROVIDERS: ProviderConfig[] = [
  {
    name: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.3-70b-instruct",
    apiKey: config.nvidiaApiKey,
    inputCostPerM: 0,
    outputCostPerM: 0,
  },
  {
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: config.openaiApiKey,
    inputCostPerM: 0.15,
    outputCostPerM: 0.6,
  },
];

export async function resolveProvider(): Promise<ProviderConfig | null> {
  const stored = await AiProvider.findOne({ enabled: true }).sort({
    isDefault: -1,
    updatedAt: -1,
  });
  if (stored) {
    return {
      name: stored.name,
      baseUrl: stored.baseUrl.replace(/\/$/, ""),
      model: stored.model,
      apiKey: stored.apiKey,
      inputCostPerM: stored.inputCostPerM ?? 0,
      outputCostPerM: stored.outputCostPerM ?? 0,
    };
  }
  return FALLBACK_PROVIDERS.find((p) => p.apiKey) ?? null;
}

const MICRO = 1_000_000;

/**
 * Billing por saldo (prompt.txt item 8): cada requisição consome saldo em
 * USD calculado por tokens × preço/1M × multiplicador de margem. Plano free
 * usa o crédito único de cortesia; planos pagos têm orçamento mensal. O
 * client nunca vê USD — só a % restante.
 */
async function checkBalance(
  userId: string,
): Promise<
  | { ok: true; mode: "balance"; user: NonNullable<Awaited<ReturnType<typeof User.findById>>> }
  | { ok: false; status: number; error: string }
> {
  await rolloverAiPeriod(userId);
  const user = await User.findById(userId);
  if (!user) return { ok: false, status: 404, error: "Usuário não encontrado" };

  const plan = await Plan.findOne({ slug: user.plan });
  const monthlyBudgetMicro = Math.round((plan?.monthlyBudgetUsd ?? 0) * MICRO);

  if (monthlyBudgetMicro > 0) {
    if (user.aiUsageMicroUsd >= monthlyBudgetMicro) {
      return {
        ok: false,
        status: 402,
        error:
          "Seu saldo de IA deste mês acabou. Ele renova na próxima cobrança, ou faça upgrade de plano.",
      };
    }
    return { ok: true, mode: "balance", user };
  }

  // Plano sem orçamento mensal (free): crédito único de cortesia.
  const courtesyRemaining =
    (user.courtesyGrantedMicroUsd ?? 0) - (user.courtesyUsedMicroUsd ?? 0);
  if (courtesyRemaining <= 0) {
    return {
      ok: false,
      status: 402,
      error:
        "Seu crédito gratuito de IA acabou. Assine um plano para continuar, ou configure sua própria API key no perfil.",
    };
  }
  return { ok: true, mode: "balance", user };
}

/** Caminho BYOK: usuário usa a própria API key → limite por requisições. */
async function checkByokRequests(
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  await rolloverAiPeriod(userId);
  const user = await User.findById(userId);
  if (!user) return { ok: false, status: 404, error: "Usuário não encontrado" };
  const limit = config.byokRequestsPerMonth;
  if (user.aiRequestsUsed >= limit) {
    return {
      ok: false,
      status: 429,
      error: `Limite de ${limit} requisições/mês com API própria atingido.`,
    };
  }
  await User.updateOne({ _id: userId }, { $inc: { aiRequestsUsed: 1 } });
  return { ok: true };
}

/** Estimativa quando o provider não reporta usage (~4 chars por token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function chargeUsage(
  userId: string,
  provider: ProviderConfig,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  const billing = await getBillingSettings();
  // tokens × (USD por 1M tokens) = microUSD exatos (1e6 cancela).
  const realCostMicro =
    promptTokens * provider.inputCostPerM +
    completionTokens * provider.outputCostPerM;
  const chargedMicro = Math.ceil(realCostMicro * billing.marginMultiplier);
  if (chargedMicro <= 0) return;

  const user = await User.findById(userId);
  if (!user) return;
  const plan = await Plan.findOne({ slug: user.plan });
  const hasMonthlyBudget = (plan?.monthlyBudgetUsd ?? 0) > 0;

  // $inc atômico evita corrida entre requisições concorrentes.
  await User.updateOne(
    { _id: userId },
    hasMonthlyBudget
      ? { $inc: { aiUsageMicroUsd: chargedMicro } }
      : { $inc: { courtesyUsedMicroUsd: chargedMicro } },
  );
}

interface StreamedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** POST /api/ai/chat — streaming SSE com tool use. */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const userId = req.auth!.userId;
  const { messages, tools, byok } = req.body as {
    messages: unknown[];
    tools?: unknown[];
    byok?: ByokConfig;
  };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages é obrigatório" });
    return;
  }

  const usingByok = Boolean(byok?.baseUrl && byok?.apiKey && byok?.model);
  let provider: ProviderConfig | null;

  if (usingByok) {
    const check = await checkByokRequests(userId);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    provider = {
      name: "byok",
      baseUrl: byok!.baseUrl.replace(/\/$/, ""),
      model: byok!.model,
      apiKey: byok!.apiKey,
      inputCostPerM: 0,
      outputCostPerM: 0,
    };
  } else {
    const check = await checkBalance(userId);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    provider = await resolveProvider();
  }

  if (!provider) {
    res.status(503).json({
      error:
        "Nenhum provider de IA configurado. Cadastre um no painel admin ou defina NVIDIA_API_KEY/OPENAI_API_KEY no servidor.",
    });
    return;
  }

  const callProvider = (includeUsage: boolean) =>
    fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        stream: true,
        // Pede o total de tokens no último chunk do stream.
        ...(includeUsage
          ? { stream_options: { include_usage: true } }
          : {}),
        temperature: 0.2,
      }),
    });

  let upstream = await callProvider(true);
  // Alguns providers rejeitam stream_options; tenta de novo sem.
  if (upstream.status === 400) {
    upstream = await callProvider(false);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    res.status(502).json({
      error: `Provider ${provider.name} respondeu ${upstream.status}: ${detail.slice(0, 300)}`,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const toolCalls = new Map<number, StreamedToolCall>();
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Medição para cobrança: usage real do provider ou estimativa por chars.
  let reportedUsage: { prompt: number; completion: number } | null = null;
  let streamedChars = 0;

  try {
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

        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              reasoning?: string | null;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          } | null;
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }

        if (chunk.usage) {
          reportedUsage = {
            prompt: chunk.usage.prompt_tokens ?? 0,
            completion: chunk.usage.completion_tokens ?? 0,
          };
          send({
            usage: {
              promptTokens: reportedUsage.prompt,
              completionTokens: reportedUsage.completion,
              totalTokens:
                chunk.usage.total_tokens ??
                reportedUsage.prompt + reportedUsage.completion,
            },
          });
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (reasoning) {
          streamedChars += reasoning.length;
          send({ reasoning });
        }
        if (delta.content) {
          streamedChars += delta.content.length;
          send({ content: delta.content });
        }

        for (const tc of delta.tool_calls ?? []) {
          const existing = toolCalls.get(tc.index);
          if (existing) {
            if (tc.function?.arguments) {
              existing.function.arguments += tc.function.arguments;
            }
            if (tc.function?.name) existing.function.name = tc.function.name;
            if (tc.id) existing.id = tc.id;
          } else {
            toolCalls.set(tc.index, {
              id: tc.id ?? `call_${tc.index}_${Date.now()}`,
              type: "function",
              function: {
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              },
            });
          }
        }
      }
    }

    if (toolCalls.size > 0) {
      send({
        tool_calls: [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call),
      });
    }
    res.write("data: [DONE]\n\n");
  } catch (err) {
    send({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
    // Cobrança pós-stream (não bloqueia a resposta). BYOK não consome saldo.
    if (!usingByok) {
      const promptTokens =
        reportedUsage?.prompt ?? estimateTokens(JSON.stringify(messages));
      const completionTokens =
        reportedUsage?.completion ?? Math.ceil(streamedChars / 4);
      chargeUsage(userId, provider, promptTokens, completionTokens).catch(
        (err) => console.error("[animai-server] cobrança falhou:", err),
      );
    }
  }
}

/**
 * POST /api/ai/v1/chat/completions — passthrough OpenAI-compatible para o
 * OpenAI Agents SDK rodando no navegador. O SDK fala o protocolo padrão
 * /chat/completions; aqui autenticamos (JWT vem como Bearer), checamos saldo,
 * FORÇAMOS o modelo do provider (o client não escolhe), injetamos a key real e
 * repassamos o stream cru. Billing igual ao /api/ai/chat. Assim a key nunca vai
 * ao client e a lógica de providers (todos OpenAI-compatible) fica intacta.
 */
export async function handleChatCompletions(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.auth!.userId;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const check = await checkBalance(userId);
  if (!check.ok) {
    res.status(check.status).json({ error: check.error });
    return;
  }
  const provider = await resolveProvider();
  if (!provider) {
    res.status(503).json({ error: "Nenhum provider de IA configurado." });
    return;
  }

  const callProvider = (includeUsage: boolean) =>
    fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        ...body,
        model: provider.model, // servidor decide o modelo, não o client
        stream: true,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
      }),
    });

  let upstream = await callProvider(true);
  if (upstream.status === 400) upstream = await callProvider(false);

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    res.status(502).json({
      error: `Provider ${provider.name} respondeu ${upstream.status}: ${detail.slice(0, 300)}`,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reportedUsage: { prompt: number; completion: number } | null = null;
  let streamedChars = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      res.write(text); // passthrough cru para o SDK
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          if (chunk.usage) {
            reportedUsage = {
              prompt: chunk.usage.prompt_tokens ?? 0,
              completion: chunk.usage.completion_tokens ?? 0,
            };
          }
          const c = chunk.choices?.[0]?.delta?.content;
          if (c) streamedChars += c.length;
        } catch {
          /* chunk parcial; ignora */
        }
      }
    }
  } catch {
    /* cliente desconectou */
  } finally {
    res.end();
    const promptTokens =
      reportedUsage?.prompt ?? estimateTokens(JSON.stringify(body.messages ?? body));
    const completionTokens =
      reportedUsage?.completion ?? Math.ceil(streamedChars / 4);
    chargeUsage(userId, provider, promptTokens, completionTokens).catch((err) =>
      console.error("[animai-server] cobrança falhou:", err),
    );
  }
}

/** POST /api/ai/compact — atualiza o resumo da conversa (prd.txt §3.4). */
export async function handleCompact(req: Request, res: Response): Promise<void> {
  const provider = await resolveProvider();
  if (!provider) {
    res.status(503).json({ error: "Nenhum provider de IA configurado." });
    return;
  }

  const { summary, messages, charLimit } = req.body as {
    summary?: string;
    messages?: Array<{ role: string; content: string | null }>;
    charLimit?: number;
  };
  const limit = Math.min(charLimit ?? 5000, 5000);

  const transcript = (messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role}: ${(m.content ?? "").slice(0, 1500)}`)
    .join("\n");

  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Você mantém a memória de longo prazo de um assistente de edição de vídeo. Atualize o resumo anterior incorporando as novas mensagens. Preserve: objetivos do usuário, decisões de edição, preferências, ids/nomes relevantes do projeto. Responda SOMENTE com o resumo atualizado, em português, com no máximo ${limit} caracteres.`,
        },
        {
          role: "user",
          content: `Resumo anterior:\n${summary || "(vazio)"}\n\nNovas mensagens:\n${transcript}`,
        },
      ],
    }),
  });

  if (!upstream.ok) {
    res.status(502).json({ error: `Provider respondeu ${upstream.status}` });
    return;
  }
  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  const newSummary = data.choices?.[0]?.message?.content ?? "";
  res.json({
    summary: newSummary.slice(0, limit),
    totalTokens: data.usage?.total_tokens ?? 0,
  });
}

// ── Pesquisa na web para o agente (via DuckDuckGo HTML, sem API key) ──

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractDdgUrl(href: string): string {
  // DDG envolve o destino em //duckduckgo.com/l/?uddg=<url-encodada>&rut=…
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

/** POST /api/ai/search — pesquisa web para a tool web_search do agente. */
export async function handleSearch(req: Request, res: Response): Promise<void> {
  const { query, maxResults } = req.body as {
    query?: string;
    maxResults?: number;
  };
  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "query é obrigatória" });
    return;
  }
  const limit = Math.min(Math.max(maxResults ?? 5, 1), 10);

  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    },
  );
  if (!response.ok) {
    res
      .status(502)
      .json({ error: `Busca indisponível (HTTP ${response.status})` });
    return;
  }

  const html = await response.text();
  const results: SearchResult[] = [];
  const blockRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < limit) {
    const url = extractDdgUrl(match[1]);
    // Anúncios do DDG apontam para redirecionadores próprios — pula.
    if (url.includes("duckduckgo.com/y.js")) continue;
    results.push({
      title: decodeEntities(match[2]),
      url,
      snippet: decodeEntities(match[3]),
    });
  }

  res.json({ query, results });
}

/** GET /api/ai/usage — uso atual (para a UI do plano). */
export async function handleUsage(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.auth!.userId);
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({ user: await buildPublicUser(user) });
}
