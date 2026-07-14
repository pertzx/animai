/**
 * API proxy utility for third-party service calls.
 *
 * All calls to ElevenLabs, OpenAI, and Anthropic pass through our own
 * Express server (/api/proxy/*) so API keys never leave the browser.
 * The server acts as a same-origin proxy, forwarding to the provider.
 *
 * In development and production alike, calls go through the server
 * at API_URL to ensure keys are never exposed to the browser.
 */

import { API_URL } from "../config/api-endpoints";

const PROXY_CONFIG = {
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io/v1",
    authHeaders: (key: string): Record<string, string> => ({
      "xi-api-key": key,
    }),
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    authHeaders: (key: string): Record<string, string> => ({
      Authorization: `Bearer ${key}`,
    }),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    authHeaders: (key: string): Record<string, string> => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    }),
  },
} as const;

export type ApiService = keyof typeof PROXY_CONFIG;

/**
 * Fetch from a third-party API through our Express proxy.
 * API key travels only to our server (same-origin), never to the
 * third party directly from the browser.
 *
 * @param service - Target service (elevenlabs, openai, anthropic)
 * @param path - API path including leading slash, e.g. "/models"
 * @param apiKey - Decrypted API key for the service (sent to our server only)
 * @param options - Standard RequestInit (method, body, extra headers, etc.)
 */
export async function apiFetch(
  service: ApiService,
  path: string,
  apiKey: string,
  options: globalThis.RequestInit = {},
): Promise<Response> {
  const extraHeaders = (options.headers ?? {}) as Record<string, string>;

  // Always proxy through our Express server (both dev and prod)
  const url = `${API_URL}/api/proxy/${service}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "x-proxy-api-key": apiKey,
      ...extraHeaders,
    },
  });
}
