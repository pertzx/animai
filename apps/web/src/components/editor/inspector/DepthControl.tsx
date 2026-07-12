/**
 * Controle de profundidade 3D do clipe (prompt.txt #2). Define quão "fundo" ou
 * "à frente" o elemento está — a câmera usa isso para o parallax/aspecto 3D:
 * fundo se move menos, frente se move mais. Camadas prontas: frente/foco/fundo.
 */

import React from "react";
import { LabeledSlider } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { getClipDepth, setClipDepth } from "../../../services/camera";

const PRESETS: Array<{ label: string; depth: number; hint: string }> = [
  { label: "Frente", depth: -500, hint: "primeiro plano (move mais)" },
  { label: "Foco", depth: 0, hint: "plano da câmera" },
  { label: "Fundo", depth: 1200, hint: "background (move menos)" },
];

export const DepthControl: React.FC<{ clipId: string }> = ({ clipId }) => {
  const project = useProjectStore((s) => s.project);
  const clip = project.timeline.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === clipId);
  if (!clip) return null;

  const depth = getClipDepth(clip);

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-text-muted">
        A profundidade só tem efeito visível quando a câmera se move (aba
        Gráficos → Câmera, ou peça ao assistente). Elementos com profundidades
        diferentes criam o parallax 3D.
      </p>

      <div className="grid grid-cols-3 gap-1">
        {PRESETS.map((p) => {
          const active = Math.abs(depth - p.depth) < 1;
          return (
            <button
              key={p.label}
              title={p.hint}
              onClick={() => setClipDepth(clipId, p.depth)}
              className={`rounded py-1.5 text-[10px] transition-colors ${
                active
                  ? "bg-primary text-white"
                  : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <LabeledSlider
        label="Profundidade"
        value={depth}
        onChange={(v) => setClipDepth(clipId, v)}
        min={-800}
        max={3000}
        step={10}
        defaultValue={0}
      />
    </div>
  );
};
