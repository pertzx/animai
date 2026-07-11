/**
 * Aba Performance (prompt.txt item 6): modo de uso do editor para
 * dispositivos fracos. "Desempenho" reduz a resolução do preview — o export
 * SEMPRE sai em qualidade máxima, e a UI deixa isso claro.
 */

import React, { useEffect, useState } from "react";
import { Gauge, Rocket, Wand2 } from "lucide-react";
import {
  getAnimaiPrefs,
  setAnimaiPrefs,
  type PerformanceMode,
} from "../../../stores/settings-store";
import { getDeviceProfile } from "@openreel/core";

const MODES: Array<{
  id: PerformanceMode;
  label: string;
  description: string;
  icon: typeof Gauge;
}> = [
  {
    id: "auto",
    label: "Automático",
    description: "Detecta o seu dispositivo e escolhe o melhor equilíbrio.",
    icon: Wand2,
  },
  {
    id: "desempenho",
    label: "Desempenho",
    description:
      "Desativa previews animados e análises automáticas em segundo plano (transcrição/OCR sob demanda). Ideal para dispositivos fracos.",
    icon: Gauge,
  },
  {
    id: "maximo",
    label: "Máximo",
    description:
      "Tudo ligado: previews animados e análises automáticas. Exige um dispositivo mais potente.",
    icon: Rocket,
  },
];

/** True quando processamento em segundo plano deve ser evitado. */
export function isLowPowerMode(): boolean {
  return getAnimaiPrefs().performanceMode === "desempenho";
}

export const PerformancePanel: React.FC = () => {
  const [mode, setMode] = useState<PerformanceMode>(
    getAnimaiPrefs().performanceMode,
  );
  const [tier, setTier] = useState<string | null>(null);

  useEffect(() => {
    getDeviceProfile()
      .then((profile) => setTier(profile.overallTier))
      .catch(() => setTier(null));
  }, []);

  const select = (m: PerformanceMode) => {
    setAnimaiPrefs({ performanceMode: m });
    setMode(m);
  };

  return (
    <div className="space-y-4 py-2">
      {tier && (
        <p className="text-xs text-text-muted">
          Seu dispositivo foi classificado como{" "}
          <span className="font-medium text-text-primary">
            {tier === "high" ? "potente" : tier === "mid" ? "intermediário" : "básico"}
          </span>
          .
        </p>
      )}

      <div className="space-y-2">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => select(m.id)}
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
              <span>
                <span className="block text-sm font-medium text-text-primary">
                  {m.label}
                </span>
                <span className="block text-xs text-text-muted">
                  {m.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-200">
        <strong>Importante:</strong> o modo de performance afeta apenas a
        experiência durante a edição. O <strong>export do vídeo final sempre
        sai em qualidade máxima</strong>, independente do modo escolhido. Se
        seu dispositivo aguentar, ative “Máximo” para ter tudo ligado.
      </div>
    </div>
  );
};
