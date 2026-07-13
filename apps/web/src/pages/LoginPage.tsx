/**
 * Login obrigatório (prd.txt §6.1). Os projetos continuam locais; a conta
 * controla acesso à IA, catálogo e assinatura.
 */

import React, { useState } from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import { useAuthStore } from "../stores/auth-store";

export const LoginPage: React.FC = () => {
  const { login, register, loading, error } = useAuthStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") await login(email, password);
    else await register(name, email, password);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-bg p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-[22rem] space-y-4 rounded-xl border border-border bg-bg-1 p-6"
      >
        <div className="flex items-center gap-2">
          <Clapperboard className="text-accent" size={22} />
          <h1 className="text-lg font-semibold text-fg">AnimAI</h1>
        </div>
        <p className="text-xs text-fg-muted">
          Editor de vídeo com IA. Seus projetos e mídias ficam no seu
          computador; a conta dá acesso ao assistente de IA.
        </p>

        <div className="flex rounded border border-border text-sm">
          <button
            type="button"
            className={`flex-1 py-1.5 ${mode === "login" ? "bg-accent text-accent-fg" : "text-fg-2"}`}
            onClick={() => setMode("login")}
          >
            Entrar
          </button>
          <button
            type="button"
            className={`flex-1 py-1.5 ${mode === "register" ? "bg-accent text-accent-fg" : "text-fg-2"}`}
            onClick={() => setMode("register")}
          >
            Criar conta
          </button>
        </div>

        {mode === "register" && (
          <input
            className="w-full rounded border border-border bg-bg-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            placeholder="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          className="w-full rounded border border-border bg-bg-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          placeholder="E-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded border border-border bg-bg-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          placeholder="Senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />

        {error && <p className="text-xs text-status-error">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded bg-accent py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {mode === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>
    </div>
  );
};
