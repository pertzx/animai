/**
 * Centralized API endpoint configuration — AnimAI unified architecture.
 *
 * All calls to our own backend go through API_URL.
 * Third-party API calls (ElevenLabs, OpenAI, Anthropic) go through
 * our same-origin proxy (/api/proxy/*) so keys never leave the browser
 * directly. The proxy is handled by apiFetch() in services/api-proxy.ts.
 *
 * NOTE: the canonical URL is defined in config/url.ts — este arquivo
 * re-exporta para compatibilidade com quem já importa de api-endpoints.ts.
 */

export { API_URL } from "./url";