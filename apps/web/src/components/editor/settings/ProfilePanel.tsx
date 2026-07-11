/**
 * Aba Perfil (prompt.txt item 6): status do plano, % de uso de IA, prompt
 * customizado para o agente e API própria (BYOK).
 */

import React, { useEffect, useState } from "react";
import { LogOut, RefreshCw } from "lucide-react";
import { apiRequest, useAuthStore } from "../../../stores/auth-store";
import {
  getAnimaiPrefs,
  setAnimaiPrefs,
  type AnimaiPrefs,
} from "../../../stores/settings-store";

const inputCls =
  "w-full rounded border border-border bg-background-tertiary px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary";

export const ProfilePanel: React.FC = () => {
  const { user, logout, restore } = useAuthStore();
  const [prefs, setPrefs] = useState<AnimaiPrefs>(getAnimaiPrefs());
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    void restore(); // atualiza % de uso ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return <p className="text-sm text-text-muted">Faça login.</p>;

  const save = (patch: Partial<AnimaiPrefs>) => {
    const next = setAnimaiPrefs(patch);
    setPrefs(next);
    setSavedAt(Date.now());
  };

  const pct = Math.max(0, Math.min(100, user.aiBalancePercent));

  return (
    <div className="space-y-5 py-2">
      <div className="rounded-lg border border-border bg-background-tertiary/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">{user.name}</p>
            <p className="text-xs text-text-muted">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
              {user.planName}
            </span>
            <button
              className="text-text-muted hover:text-status-error"
              title="Sair"
              onClick={logout}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              {user.balanceKind === "courtesy"
                ? "Crédito gratuito de IA (único)"
                : "Saldo de IA do mês"}
            </span>
            <span className="flex items-center gap-1.5 text-text-primary">
              {pct}% restante
              <button
                title="Atualizar"
                className="text-text-muted hover:text-text-primary"
                onClick={() => void restore()}
              >
                <RefreshCw size={11} />
              </button>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background-tertiary">
            <div
              className={`h-full rounded-full ${pct > 25 ? "bg-primary" : "bg-status-error"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {user.plan === "free" && (
            <button
              className="mt-2 text-xs text-primary hover:underline"
              onClick={() =>
                void apiRequest<{ url: string }>("/api/billing/checkout", {
                  method: "POST",
                  body: JSON.stringify({}),
                })
                  .then((d) => {
                    window.location.href = d.url;
                  })
                  .catch(() => undefined)
              }
            >
              Fazer upgrade de plano →
            </button>
          )}
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-medium text-text-primary">
          Instruções para a IA
        </h4>
        <p className="mb-2 text-xs text-text-muted">
          Anexadas a toda conversa do assistente (ex.: “sempre responda em
          português”, “prefira cortes rápidos estilo vlog”).
        </p>
        <textarea
          className={`${inputCls} min-h-[5rem] resize-y`}
          maxLength={2000}
          value={prefs.customAiPrompt}
          onChange={(e) => save({ customAiPrompt: e.target.value })}
          placeholder="Suas preferências para o assistente…"
        />
      </div>

      <div>
        <h4 className="mb-1 text-sm font-medium text-text-primary">
          API própria (BYOK)
        </h4>
        <p className="mb-2 text-xs text-text-muted">
          Use sua própria API OpenAI-compatível. Nesse modo o consumo não usa
          seu saldo — vale o limite de {user.byokRequestsLimit} requisições/mês
          ({user.byokRequestsUsed} usadas).
        </p>
        <label className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={prefs.byok.enabled}
            onChange={(e) =>
              save({ byok: { ...prefs.byok, enabled: e.target.checked } })
            }
          />
          Usar minha API no assistente
        </label>
        {prefs.byok.enabled && (
          <div className="grid grid-cols-2 gap-2">
            <input
              className={`${inputCls} col-span-2`}
              placeholder="Base URL (ex.: https://api.openai.com/v1)"
              value={prefs.byok.baseUrl}
              onChange={(e) =>
                save({ byok: { ...prefs.byok, baseUrl: e.target.value } })
              }
            />
            <input
              className={inputCls}
              placeholder="Modelo (ex.: gpt-4o-mini)"
              value={prefs.byok.model}
              onChange={(e) =>
                save({ byok: { ...prefs.byok, model: e.target.value } })
              }
            />
            <input
              className={inputCls}
              type="password"
              placeholder="API key"
              value={prefs.byok.apiKey}
              onChange={(e) =>
                save({ byok: { ...prefs.byok, apiKey: e.target.value } })
              }
            />
          </div>
        )}
      </div>

      {savedAt > 0 && (
        <p className="text-[10px] text-text-muted">Preferências salvas.</p>
      )}
    </div>
  );
};
