/**
 * Authentication + admin catalog sync (prd.txt §5, §6).
 *
 * Login is required; the JWT is kept in localStorage. Projects and media stay
 * on the user's machine — the server only holds accounts, subscriptions and
 * the admin catalog, which is synced into this store at login.
 */

import { create } from "zustand";

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:4000";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  /** Slug do plano (free, pro, ou criado no admin). */
  plan: string;
  planName: string;
  planFeatures: Record<string, boolean>;
  /** % de saldo de IA restante (0–100). O valor em USD nunca chega ao client. */
  aiBalancePercent: number;
  /** monthly = orçamento mensal do plano; courtesy = crédito único do free. */
  balanceKind: "monthly" | "courtesy";
  /** Caminho BYOK (API própria): contagem de requisições. */
  byokRequestsUsed: number;
  byokRequestsLimit: number;
}

export interface CatalogItem {
  id: string;
  kind: "effect" | "transition" | "animation" | "template";
  name: string;
  description: string;
  /** Editor payload: effect type + default params, template primitives, etc. */
  payload: Record<string, unknown>;
  published: boolean;
  /** Exclusivo de planos com a feature premiumCatalog. */
  premium?: boolean;
  builtin?: boolean;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  catalog: CatalogItem[];
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
  /** Re-validate the stored token and refresh user + catalog. */
  restore: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
}

const TOKEN_KEY = "animai.token";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  catalog: [],
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const data = await apiRequest<{ token: string; user: AuthUser }>(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      localStorage.setItem(TOKEN_KEY, data.token);
      set({ token: data.token, user: data.user, loading: false });
      void get().refreshCatalog();
      return true;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  register: async (name, email, password) => {
    set({ loading: true, error: null });
    try {
      const data = await apiRequest<{ token: string; user: AuthUser }>(
        "/api/auth/register",
        { method: "POST", body: JSON.stringify({ name, email, password }) },
      );
      localStorage.setItem(TOKEN_KEY, data.token);
      set({ token: data.token, user: data.user, loading: false });
      void get().refreshCatalog();
      return true;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null, catalog: [] });
  },

  restore: async () => {
    const token = get().token;
    if (!token) return;
    set({ loading: true });
    try {
      const data = await apiRequest<{ user: AuthUser }>("/api/auth/me");
      set({ user: data.user, loading: false });
      void get().refreshCatalog();
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ token: null, user: null, loading: false });
    }
  },

  refreshCatalog: async () => {
    try {
      const data = await apiRequest<{ items: CatalogItem[] }>("/api/catalog");
      set({ catalog: data.items });
    } catch {
      // Catalog is an enhancement; the editor works without it (offline).
    }
  },
}));
