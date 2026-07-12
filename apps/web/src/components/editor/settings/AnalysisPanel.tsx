/**
 * Aba "Análise" (prompt.txt → Configuração para usuários finais). Deixa o
 * usuário escolher o modo de análise semântica (Econômico/Balanceado/Avançado)
 * conforme a potência do dispositivo, ou configurar cada detector manualmente.
 * A config é a mesma consumida pelo Semantic Media Analyzer e pela IA.
 */

import React, { useEffect, useState } from "react";
import { Battery, Gauge, Rocket, SlidersHorizontal } from "lucide-react";
import { getDeviceProfile } from "@openreel/core";
import {
  ALL_ANALYZERS,
  MODE_PRESETS,
  defaultModeForTier,
  getAnalyzerConfig,
  getSavedMode,
  saveAnalyzerConfig,
  setAnalyzerMode,
  type AnalyzerMode,
} from "../../../services/semantic/config";
import type { AnalyzerConfig, AnalyzerId } from "../../../services/semantic/types";

const ANALYZER_LABELS: Record<AnalyzerId, string> = {
  speech: "Detectar fala (legendas)",
  ocr: "Detectar texto na tela",
  scene: "Detectar cortes/cenas",
  object: "Detectar objetos",
  tracker: "Rastrear objetos (IDs)",
  face: "Detectar rostos",
  expression: "Detectar expressões",
  pose: "Detectar poses",
  hands: "Detectar mãos/gestos",
  audio: "Detectar eventos de áudio",
  music: "Detectar música",
  environment: "Detectar ambiente",
};

const MODES: Array<{
  id: Exclude<AnalyzerMode, "manual">;
  label: string;
  description: string;
  icon: typeof Gauge;
}> = [
  {
    id: "economico",
    label: "Econômico",
    description:
      "Para celulares e PCs fracos. Só o essencial (fala, texto, áudio, cenas) em baixa frequência.",
    icon: Battery,
  },
  {
    id: "balanceado",
    label: "Balanceado",
    description:
      "Fala, texto, áudio, cenas, objetos, rastreamento e rostos. Bom equilíbrio.",
    icon: Gauge,
  },
  {
    id: "avancado",
    label: "Avançado",
    description:
      "Para PCs fortes. Todos os detectores: faces, expressões, poses, gestos, ambiente…",
    icon: Rocket,
  },
];

export const AnalysisPanel: React.FC = () => {
  const [mode, setMode] = useState<AnalyzerMode>(getSavedMode());
  const [config, setConfig] = useState<AnalyzerConfig>(getAnalyzerConfig());
  const [tier, setTier] = useState<"low" | "mid" | "high" | null>(null);

  useEffect(() => {
    getDeviceProfile()
      .then((p) => setTier(p.overallTier))
      .catch(() => setTier(null));
  }, []);

  const selectMode = (m: Exclude<AnalyzerMode, "manual">) => {
    const next = setAnalyzerMode(m);
    setMode(m);
    setConfig(next);
  };

  const toggle = (id: AnalyzerId) => {
    const next: AnalyzerConfig = {
      ...config,
      enabled: { ...config.enabled, [id]: !config.enabled[id] },
    };
    saveAnalyzerConfig(next);
    setConfig(next);
    setMode("manual");
  };

  const recommended = defaultModeForTier(tier);

  return (
    <div className="space-y-4 py-2">
      <p className="text-xs text-text-muted">
        O AnimAI analisa seu vídeo localmente (no seu dispositivo, sem enviar o
        arquivo) para o assistente entender o conteúdo — pessoas, objetos,
        rostos, cenas, fala e mais. Escolha quanto processar de acordo com a
        potência do seu aparelho.
      </p>

      <div className="space-y-2">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => selectMode(m.id)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                active
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <Icon
                size={18}
                className={active ? "text-primary" : "text-text-muted"}
              />
              <span className="flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  {m.label}
                  {recommended === m.id && (
                    <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                      recomendado p/ seu dispositivo
                    </span>
                  )}
                </span>
                <span className="block text-xs text-text-muted">
                  {m.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
          <SlidersHorizontal size={14} />
          Detectores (manual)
          {mode === "manual" && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
              personalizado
            </span>
          )}
        </div>
        <p className="mb-2 text-xs text-text-muted">
          Escolha exatamente o que processar. Desligar detectores acelera a
          análise em aparelhos fracos.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {ALL_ANALYZERS.map((id) => (
            <label
              key={id}
              className="flex items-center gap-2 text-xs text-text-secondary"
            >
              <input
                type="checkbox"
                checked={config.enabled[id]}
                onChange={() => toggle(id)}
              />
              {ANALYZER_LABELS[id]}
            </label>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-text-muted">
        Dica: no modo {MODES.find((m) => m.id === "economico")?.label}, a análise
        usa ~{MODE_PRESETS.economico.performance.analysisFps} frame/s e resolução
        de {MODE_PRESETS.economico.performance.analysisResolution}px — leve o
        bastante para celulares.
      </p>
    </div>
  );
};
