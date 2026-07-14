/**
 * Single source of truth for the AnimAI backend API URL.
 *
 * - Set VITE_API_URL in apps/web/.env to your server URL.
 * - If empty/undefined, falls back to localhost:4000 (pnpm dev:server default).
 *
 * All modules import from here — do NOT define API_URL elsewhere.
 */

const envUrl = import.meta.env.VITE_API_URL as string | undefined;

export const API_URL =
  envUrl && envUrl.trim().length > 0 ? envUrl : "http://localhost:4000";