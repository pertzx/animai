/**
 * Configuração do OpenAI Agents SDK no NAVEGADOR.
 *
 * O SDK fala o protocolo padrão /chat/completions; apontamos o client para o
 * passthrough do backend (/api/ai/v1), que injeta a API key real e faz billing.
 * A key NUNCA vem para o client — a autenticação é o JWT do usuário, injetado
 * dinamicamente no fetch (sempre o token vigente). Tracing desligado (usa
 * async_hooks, indisponível no browser).
 */

import { OpenAI } from "openai";
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { API_URL, useAuthStore } from "../../../stores/auth-store";

let configured = false;

export function ensureSdkConfigured(): void {
  if (configured) return;
  configured = true;

  const client = new OpenAI({
    // Placeholder — a auth real é o JWT injetado no fetch abaixo.
    apiKey: "browser",
    baseURL: `${API_URL}/api/ai/v1`,
    dangerouslyAllowBrowser: true,
    // Injeta o Authorization com o token vigente a cada chamada.
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const token = useAuthStore.getState().token;
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    }) as typeof fetch,
  });

  setDefaultOpenAIClient(client);
  // Providers são OpenAI-compatible via /chat/completions (não a Responses API).
  setOpenAIAPI("chat_completions");
  setTracingDisabled(true);
}
