/**
 * Painel admin (prd.txt §5): CRUD do catálogo (efeitos, transições, animações,
 * templates) com publicar/despublicar, e configuração dos providers de IA
 * (iniciais: Nvidia, OpenAI). Tudo no MongoDB via backend.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { apiRequest, useAuthStore, type CatalogItem } from "../stores/auth-store";
import { EFFECTS, TRANSITIONS } from "../components/editor/panels/EffectsTransitionsPanel";
import { SemanticLab } from "../components/semantic/SemanticLab";

type Kind = CatalogItem["kind"];

const KIND_LABELS: Record<Kind, string> = {
  effect: "Efeito",
  transition: "Transição",
  animation: "Animação",
  template: "Template",
};

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  inputCostPerM: number;
  outputCostPerM: number;
}

interface PlanItem {
  id: string;
  slug: string;
  name: string;
  stripePriceId: string;
  monthlyBudgetUsd: number;
  features: Record<string, boolean>;
  published: boolean;
}

const PLAN_FEATURES = [
  ["assistant", "Assistente de IA"],
  ["premiumCatalog", "Efeitos/templates premium"],
  ["export4k", "Export 4K"],
  ["components", "Biblioteca de componentes"],
  ["aiGenerate", "Geração de mídia por IA"],
] as const;

const PROVIDER_PRESETS = [
  {
    name: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.3-70b-instruct",
  },
  {
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
];

const inputCls =
  "w-full rounded border border-border bg-bg-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

/** Documentação inline de payloads por tipo (prompt.txt item 7). */
const PAYLOAD_DOCS: Record<Kind, { text: string; example: string }> = {
  effect: {
    text: "Efeito de vídeo aplicado a um clipe. effectType é um dos tipos nativos do editor (brightness, contrast, saturation, hue, blur, sharpen, vignette, grain, temperature, tint, chromaKey, shadow, glow, motion-blur, radial-blur, chromatic-aberration) e params são os parâmetros default. Itens importados do editor usam ref e não devem ser alterados.",
    example: '{"effectType": "vignette", "params": {"intensity": 0.6}}',
  },
  transition: {
    text: "Transição entre dois clipes adjacentes. transitionType: crossfade, dipToBlack, dipToWhite, wipe, slide, zoom ou push; durationSec é a duração sugerida.",
    example: '{"transitionType": "crossfade", "durationSec": 1}',
  },
  animation: {
    text: "Preset de animação de texto. preset: typewriter, fade, slide-left/right/up/down, scale, blur, bounce, rotate ou wave; inDuration/outDuration em segundos.",
    example: '{"preset": "typewriter", "inDuration": 0.8, "outDuration": 0.4}',
  },
  template: {
    text: "Template de edição (recipe) aplicado a um clipe. templateId referencia um template built-in do editor; overrides ajusta os controles dele.",
    example: '{"templateId": "cinema-teal-orange", "overrides": {"intensity": 0.8}}',
  },
};

/** Mini-preview do resultado para efeitos (reusa o previewStyle do editor). */
const CatalogPreview: React.FC<{ item: { kind: Kind; payload: Record<string, unknown> } }> = ({
  item,
}) => {
  if (item.kind !== "effect") return null;
  const effectType =
    (item.payload.effectType as string | undefined) ??
    (item.payload.ref as string | undefined)?.replace("builtin:effect:", "");
  const def = EFFECTS.find((e) => e.type === effectType);
  if (!def) return null;
  return (
    <span
      className="inline-block h-8 w-12 shrink-0 rounded border border-border"
      title={`Preview: ${def.label}`}
      style={{
        background: "linear-gradient(135deg, oklch(0.55 0.14 295), oklch(0.72 0.16 162))",
        ...def.previewStyle(0.8),
      }}
    />
  );
};

const CatalogTab: React.FC = () => {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDocs, setShowDocs] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState({
    kind: "effect" as Kind,
    name: "",
    description: "",
    payload: "{}",
  });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ items: CatalogItem[] }>(
        "/api/admin/catalog",
      );
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    setError(null);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(draft.payload || "{}") as Record<string, unknown>;
    } catch {
      setError("Payload precisa ser JSON válido.");
      return;
    }
    try {
      await apiRequest("/api/admin/catalog", {
        method: "POST",
        body: JSON.stringify({ ...draft, payload }),
      });
      setDraft({ kind: draft.kind, name: "", description: "", payload: "{}" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const togglePublish = async (item: CatalogItem) => {
    await apiRequest(`/api/admin/catalog/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ published: !item.published }),
    });
    await reload();
  };

  const togglePremium = async (item: CatalogItem) => {
    await apiRequest(`/api/admin/catalog/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ premium: !item.premium }),
    });
    await reload();
  };

  /** Traz efeitos/transições built-in do editor pro catálogo (item 7). */
  const importBuiltins = async () => {
    setImporting(true);
    try {
      const payload = [
        ...EFFECTS.map((e) => ({
          kind: "effect",
          name: e.label,
          description: e.description,
          payload: { ref: `builtin:effect:${e.type}`, effectType: e.type },
        })),
        ...TRANSITIONS.map((t) => ({
          kind: "transition",
          name: t.label,
          description: t.description,
          payload: {
            ref: `builtin:transition:${t.type}`,
            transitionType: t.type,
            durationSec: 1,
          },
        })),
      ];
      const result = await apiRequest<{ created: number }>(
        "/api/admin/catalog/import-builtins",
        { method: "POST", body: JSON.stringify({ items: payload }) },
      );
      setError(null);
      await reload();
      alert(`${result.created} itens built-in importados.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const remove = async (item: CatalogItem) => {
    await apiRequest(`/api/admin/catalog/${item.id}`, { method: "DELETE" });
    await reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          className="rounded border border-border px-3 py-1.5 text-xs text-fg-2 hover:border-accent hover:text-accent disabled:opacity-50"
          disabled={importing}
          onClick={() => void importBuiltins()}
        >
          {importing ? "Importando…" : "Importar efeitos/transições do editor"}
        </button>
        <button
          className="rounded border border-border px-3 py-1.5 text-xs text-fg-2 hover:border-accent hover:text-accent"
          onClick={() => setShowDocs((v) => !v)}
        >
          {showDocs ? "Ocultar documentação" : "Como criar um item? (docs)"}
        </button>
      </div>

      {showDocs && (
        <div className="space-y-3 rounded-lg border border-border bg-bg-1 p-4 text-xs text-fg-2">
          <p>
            Cada item tem um <strong>payload JSON declarativo</strong> que o
            editor interpreta (nunca código). Itens publicados aparecem no
            editor e viram opções das tools da IA. Marque{" "}
            <strong>Premium</strong> para restringir a planos com a feature
            “Efeitos/templates premium”.
          </p>
          {(Object.entries(PAYLOAD_DOCS) as Array<[Kind, { text: string; example: string }]>).map(
            ([kind, doc]) => (
              <div key={kind} className="rounded border border-border p-2.5">
                <p className="mb-1 font-medium text-fg">{KIND_LABELS[kind]}</p>
                <p className="mb-1.5">{doc.text}</p>
                <code className="block overflow-x-auto rounded bg-bg-3 p-1.5 font-mono text-[10px] text-fg">
                  {doc.example}
                </code>
              </div>
            ),
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-bg-1 p-4">
        <h3 className="mb-3 text-sm font-medium text-fg">Novo item</h3>
        <div className="grid grid-cols-2 gap-2">
          <select
            className={inputCls}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
          >
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder="Nome"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className={`${inputCls} col-span-2`}
            placeholder="Descrição (a IA usa isto para escolher o item)"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <textarea
            className={`${inputCls} col-span-2 font-mono text-xs`}
            rows={3}
            placeholder='Payload JSON — ex.: {"effectType":"vignette","params":{"intensity":0.6}}'
            value={draft.payload}
            onChange={(e) => setDraft({ ...draft, payload: e.target.value })}
          />
        </div>
        {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
        <button
          className="mt-3 flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-40"
          disabled={!draft.name}
          onClick={() => void create()}
        >
          <Plus size={14} /> Criar
        </button>
      </div>

      {loading ? (
        <Loader2 className="animate-spin text-fg-muted" />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-fg-muted">
            <tr>
              <th className="py-1">Tipo</th>
              <th>Nome</th>
              <th>Descrição</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-border text-fg-2">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <CatalogPreview item={item} />
                    {KIND_LABELS[item.kind]}
                  </span>
                </td>
                <td className="text-fg">
                  {item.name}
                  {item.builtin && (
                    <span className="ml-1.5 rounded bg-bg-3 px-1 text-[9px] text-fg-muted">
                      built-in
                    </span>
                  )}
                </td>
                <td className="max-w-[16rem] truncate">{item.description}</td>
                <td>
                  <span className="flex items-center gap-1.5">
                    <button
                      className={`rounded px-2 py-0.5 text-xs ${
                        item.published
                          ? "bg-accent-soft text-accent"
                          : "bg-bg-3 text-fg-muted"
                      }`}
                      onClick={() => void togglePublish(item)}
                    >
                      {item.published ? "Publicado" : "Rascunho"}
                    </button>
                    <button
                      className={`rounded px-2 py-0.5 text-xs ${
                        item.premium
                          ? "bg-yellow-500/20 text-yellow-500"
                          : "bg-bg-3 text-fg-muted"
                      }`}
                      title="Restringir a planos com catálogo premium"
                      onClick={() => void togglePremium(item)}
                    >
                      {item.premium ? "Premium" : "Grátis"}
                    </button>
                  </span>
                </td>
                <td className="text-right">
                  <button
                    className="text-fg-muted hover:text-status-error"
                    onClick={() => void remove(item)}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-fg-muted">
                  Nenhum item no catálogo ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

/** Configurações de billing: margem e crédito de cortesia (item 8). */
const BillingSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<{
    marginMultiplier: number;
    courtesyUsd: number;
  } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void apiRequest<{ settings: { marginMultiplier: number; courtesyUsd: number } }>(
      "/api/admin/billing-settings",
    ).then((d) => setSettings(d.settings));
  }, []);

  if (!settings) return null;

  const save = async () => {
    await apiRequest("/api/admin/billing-settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const margin = settings.marginMultiplier;
  const profitPct = margin > 0 ? Math.round((1 - 1 / margin) * 100) : 0;

  return (
    <div className="rounded-lg border border-border bg-bg-1 p-4">
      <h3 className="mb-1 text-sm font-medium text-fg">Cobrança por saldo</h3>
      <p className="mb-3 text-xs text-fg-muted">
        Custo cobrado = tokens × preço do modelo × multiplicador. O cliente
        nunca vê USD — só “% restante”.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-fg-2">
          Multiplicador de margem
          <input
            className={inputCls}
            type="number"
            min={1}
            step={0.1}
            value={settings.marginMultiplier}
            onChange={(e) =>
              setSettings({ ...settings, marginMultiplier: Number(e.target.value) })
            }
          />
          <span className="text-[10px] text-fg-muted">
            ≈ {profitPct}% de lucro sobre o custo real
          </span>
        </label>
        <label className="text-xs text-fg-2">
          Crédito de cortesia (USD, único, plano free)
          <input
            className={inputCls}
            type="number"
            min={0}
            step={0.1}
            value={settings.courtesyUsd}
            onChange={(e) =>
              setSettings({ ...settings, courtesyUsd: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <button
        className="mt-3 flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-accent-fg"
        onClick={() => void save()}
      >
        <Save size={14} /> {saved ? "Salvo!" : "Salvar"}
      </button>
    </div>
  );
};

/** Linha de um provider com edição inline do modelo (trocar para um mais forte). */
const ProviderRow: React.FC<{
  p: Provider;
  update: (id: string, updates: Partial<Provider>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}> = ({ p, update, remove }) => {
  const [model, setModel] = useState(p.model);
  const dirty = model.trim().length > 0 && model.trim() !== p.model;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-bg-1 px-3 py-2 text-sm">
      <span className="font-medium text-fg">{p.name}</span>
      <input
        className="w-52 rounded border border-border bg-bg-2 px-2 py-0.5 font-mono text-xs text-fg"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        title="Modelo do provider — troque para um mais forte e clique em Salvar modelo"
      />
      {dirty && (
        <button
          className="rounded bg-accent-soft px-2 py-0.5 text-xs text-accent"
          onClick={() => void update(p.id, { model: model.trim() })}
        >
          Salvar modelo
        </button>
      )}
      <span className="max-w-[12rem] truncate text-xs text-fg-muted">
        {p.baseUrl}
      </span>
      <div className="ml-auto flex items-center gap-2 text-xs">
        <button
          className={`rounded px-2 py-0.5 ${p.isDefault ? "bg-accent-soft text-accent" : "bg-bg-3 text-fg-muted"}`}
          onClick={() => void update(p.id, { isDefault: true })}
        >
          {p.isDefault ? "Padrão" : "Tornar padrão"}
        </button>
        <button
          className={`rounded px-2 py-0.5 ${p.enabled ? "bg-accent-soft text-accent" : "bg-bg-3 text-fg-muted"}`}
          onClick={() => void update(p.id, { enabled: !p.enabled })}
        >
          {p.enabled ? "Ativo" : "Inativo"}
        </button>
        <button
          className="text-fg-muted hover:text-status-error"
          onClick={() => void remove(p.id)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

const ProvidersTab: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    name: "nvidia",
    baseUrl: PROVIDER_PRESETS[0].baseUrl,
    model: PROVIDER_PRESETS[0].model,
    apiKey: "",
    isDefault: true,
    inputCostPerM: 0,
    outputCostPerM: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ providers: Provider[] }>(
        "/api/admin/providers",
      );
      setProviders(data.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    setError(null);
    try {
      await apiRequest("/api/admin/providers", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setDraft({ ...draft, apiKey: "" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const update = async (id: string, updates: Partial<Provider>) => {
    await apiRequest(`/api/admin/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    await reload();
  };

  const remove = async (id: string) => {
    await apiRequest(`/api/admin/providers/${id}`, { method: "DELETE" });
    await reload();
  };

  return (
    <div className="space-y-6">
      <BillingSettingsCard />
      <div className="rounded-lg border border-border bg-bg-1 p-4">
        <h3 className="mb-3 text-sm font-medium text-fg">Novo provider</h3>
        <div className="mb-2 flex gap-2">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.name}
              className="rounded border border-border px-2 py-1 text-xs text-fg-2 hover:border-accent"
              onClick={() =>
                setDraft({ ...draft, name: p.name, baseUrl: p.baseUrl, model: p.model })
              }
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            placeholder="Nome (ex.: nvidia)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Modelo"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
          <input
            className={`${inputCls} col-span-2`}
            placeholder="Base URL (OpenAI-compatível)"
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
          <input
            className={`${inputCls} col-span-2`}
            placeholder="API key (fica só no servidor)"
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />
          <label className="text-xs text-fg-2">
            Custo input (USD / 1M tokens)
            <input
              className={inputCls}
              type="number"
              min={0}
              step={0.01}
              value={draft.inputCostPerM}
              onChange={(e) =>
                setDraft({ ...draft, inputCostPerM: Number(e.target.value) })
              }
            />
          </label>
          <label className="text-xs text-fg-2">
            Custo output (USD / 1M tokens)
            <input
              className={inputCls}
              type="number"
              min={0}
              step={0.01}
              value={draft.outputCostPerM}
              onChange={(e) =>
                setDraft({ ...draft, outputCostPerM: Number(e.target.value) })
              }
            />
          </label>
        </div>
        {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
        <button
          className="mt-3 flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-40"
          disabled={!draft.name || !draft.apiKey}
          onClick={() => void create()}
        >
          <Save size={14} /> Salvar provider
        </button>
      </div>

      {loading ? (
        <Loader2 className="animate-spin text-fg-muted" />
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <ProviderRow key={p.id} p={p} update={update} remove={remove} />
          ))}
          {providers.length === 0 && (
            <p className="py-4 text-center text-xs text-fg-muted">
              Nenhum provider cadastrado — o servidor usa NVIDIA_API_KEY /
              OPENAI_API_KEY do ambiente como fallback.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/** CRUD de planos (prompt.txt item 14). */
const PlansTab: React.FC = () => {
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    slug: "",
    name: "",
    stripePriceId: "",
    monthlyBudgetUsd: 10,
    features: { assistant: true } as Record<string, boolean>,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ plans: PlanItem[] }>("/api/admin/plans");
      setPlans(data.plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    setError(null);
    try {
      await apiRequest("/api/admin/plans", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setDraft({
        slug: "",
        name: "",
        stripePriceId: "",
        monthlyBudgetUsd: 10,
        features: { assistant: true },
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const update = async (id: string, updates: Partial<PlanItem>) => {
    await apiRequest(`/api/admin/plans/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    await reload();
  };

  const remove = async (id: string) => {
    try {
      await apiRequest(`/api/admin/plans/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-bg-1 p-4">
        <h3 className="mb-3 text-sm font-medium text-fg">Novo plano</h3>
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            placeholder="Slug (ex.: pro-plus)"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Nome"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Stripe price_id (price_...)"
            value={draft.stripePriceId}
            onChange={(e) =>
              setDraft({ ...draft, stripePriceId: e.target.value })
            }
          />
          <label className="text-xs text-fg-2">
            Saldo de IA mensal (USD)
            <input
              className={inputCls}
              type="number"
              min={0}
              step={1}
              value={draft.monthlyBudgetUsd}
              onChange={(e) =>
                setDraft({ ...draft, monthlyBudgetUsd: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          {PLAN_FEATURES.map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 text-xs text-fg-2">
              <input
                type="checkbox"
                checked={Boolean(draft.features[key])}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    features: { ...draft.features, [key]: e.target.checked },
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-status-error">{error}</p>}
        <button
          className="mt-3 flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-40"
          disabled={!draft.slug || !draft.name}
          onClick={() => void create()}
        >
          <Plus size={14} /> Criar plano
        </button>
      </div>

      {loading ? (
        <Loader2 className="animate-spin text-fg-muted" />
      ) : (
        <div className="space-y-2">
          {plans.map((p) => (
            <div
              key={p.id}
              className="rounded border border-border bg-bg-1 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-fg">{p.name}</span>
                <code className="text-xs text-fg-muted">{p.slug}</code>
                <span className="text-xs text-fg-muted">
                  IA: ${p.monthlyBudgetUsd}/mês
                </span>
                {p.stripePriceId && (
                  <code className="max-w-[10rem] truncate text-[10px] text-fg-muted">
                    {p.stripePriceId}
                  </code>
                )}
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <button
                    className={`rounded px-2 py-0.5 ${p.published ? "bg-accent-soft text-accent" : "bg-bg-3 text-fg-muted"}`}
                    onClick={() => void update(p.id, { published: !p.published })}
                  >
                    {p.published ? "Publicado" : "Rascunho"}
                  </button>
                  {p.slug !== "free" && (
                    <button
                      className="text-fg-muted hover:text-status-error"
                      onClick={() => void remove(p.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-3">
                {PLAN_FEATURES.map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-1 text-[11px] text-fg-2"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(p.features?.[key])}
                      onChange={(e) =>
                        void update(p.id, {
                          features: { ...p.features, [key]: e.target.checked },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  plan: string;
  createdAt: string | null;
  aiUsageUsd: number;
  monthlyBudgetUsd: number;
  courtesyGrantedUsd: number;
  courtesyUsedUsd: number;
  byokRequestsUsed: number;
}

/** Gestão de usuários: listar todos e trocar plano/role (item extra do admin). */
const UsersTab: React.FC = () => {
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const [u, p] = await Promise.all([
        apiRequest<{ users: AdminUser[] }>(
          `/api/admin/users${query ? `?search=${encodeURIComponent(query)}` : ""}`,
        ),
        apiRequest<{ plans: PlanItem[] }>("/api/admin/plans"),
      ]);
      setUsers(u.users);
      setPlans(p.plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload("");
  }, [reload]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const { user } = await apiRequest<{ user: AdminUser }>(
        `/api/admin/users/${id}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const usagePct = (u: AdminUser): number | null => {
    if (u.monthlyBudgetUsd > 0) {
      return Math.round((u.aiUsageUsd / u.monthlyBudgetUsd) * 100);
    }
    if (u.courtesyGrantedUsd > 0) {
      return Math.round((u.courtesyUsedUsd / u.courtesyGrantedUsd) * 100);
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          className={inputCls}
          placeholder="Buscar por nome ou e-mail…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void reload(search);
          }}
        />
        <button
          className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm text-accent-fg"
          onClick={() => void reload(search)}
        >
          Buscar
        </button>
      </div>

      {error && <p className="text-xs text-status-error">{error}</p>}

      {loading ? (
        <Loader2 className="animate-spin text-fg-muted" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-fg-muted">
              <tr>
                <th className="py-1">Usuário</th>
                <th>Plano</th>
                <th>Uso de IA</th>
                <th>Acesso</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const pct = usagePct(u);
                return (
                  <tr key={u.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-fg">{u.name}</div>
                      <div className="text-xs text-fg-muted">{u.email}</div>
                    </td>
                    <td className="pr-3">
                      <select
                        className={`${inputCls} py-1`}
                        value={u.plan}
                        disabled={busyId === u.id}
                        onChange={(e) =>
                          void patch(u.id, { plan: e.target.value })
                        }
                      >
                        {plans.map((p) => (
                          <option key={p.slug} value={p.slug}>
                            {p.name}
                          </option>
                        ))}
                        {/* Plano atual não listado (ex.: removido) */}
                        {!plans.some((p) => p.slug === u.plan) && (
                          <option value={u.plan}>{u.plan}</option>
                        )}
                      </select>
                    </td>
                    <td className="pr-3 text-xs text-fg-2">
                      {u.monthlyBudgetUsd > 0 ? (
                        <span>
                          ${u.aiUsageUsd.toFixed(2)} / ${u.monthlyBudgetUsd}
                          /mês
                        </span>
                      ) : u.courtesyGrantedUsd > 0 ? (
                        <span>
                          cortesia: ${u.courtesyUsedUsd.toFixed(2)} / $
                          {u.courtesyGrantedUsd.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-fg-muted">sem saldo</span>
                      )}
                      {pct !== null && (
                        <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-bg-3">
                          <div
                            className={`h-full ${pct >= 90 ? "bg-status-error" : "bg-accent"}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      )}
                      <button
                        className="mt-1 text-[10px] text-fg-muted hover:text-accent"
                        disabled={busyId === u.id}
                        onClick={() => void patch(u.id, { resetUsage: true })}
                      >
                        zerar uso
                      </button>
                    </td>
                    <td>
                      <button
                        className={`rounded px-2 py-0.5 text-xs ${
                          u.role === "admin"
                            ? "bg-accent-soft text-accent"
                            : "bg-bg-3 text-fg-muted"
                        } disabled:opacity-40`}
                        disabled={busyId === u.id || u.id === currentUser?.id}
                        title={
                          u.id === currentUser?.id
                            ? "Você não pode alterar seu próprio acesso"
                            : "Alternar admin/usuário"
                        }
                        onClick={() =>
                          void patch(u.id, {
                            role: u.role === "admin" ? "user" : "admin",
                          })
                        }
                      >
                        {u.role === "admin" ? "Admin" : "Usuário"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-fg-muted">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

type AdminTab =
  | "catalog"
  | "providers"
  | "plans"
  | "users"
  | "semantic";

export const AdminPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<AdminTab>("catalog");

  if (user?.role !== "admin") {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-sm text-fg-muted">
        Acesso restrito a administradores.
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-bg text-fg">
      <div
        className={`mx-auto px-6 py-8 ${tab === "semantic" ? "max-w-6xl" : "max-w-3xl"}`}
      >
        <div className="mb-6 flex items-center gap-3">
          <button
            className="flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
            onClick={() => (window.location.hash = "#/editor")}
          >
            <ArrowLeft size={14} /> Editor
          </button>
          <h1 className="text-xl font-semibold">Painel Admin</h1>
        </div>

        <div className="mb-6 flex gap-2 border-b border-border text-sm">
          {(
            [
              ["catalog", "Catálogo"],
              ["providers", "Providers de IA"],
              ["plans", "Planos"],
              ["users", "Usuários"],
              ["semantic", "Semantic Analyzer Lab"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`px-3 py-2 ${tab === key ? "border-b-2 border-accent text-fg" : "text-fg-muted"}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "semantic" ? (
          <SemanticLab />
        ) : tab === "catalog" ? (
          <CatalogTab />
        ) : tab === "providers" ? (
          <ProvidersTab />
        ) : tab === "plans" ? (
          <PlansTab />
        ) : (
          <UsersTab />
        )}
      </div>
    </div>
  );
};
