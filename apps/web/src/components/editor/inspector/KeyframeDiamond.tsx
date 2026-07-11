/**
 * Diamante de keyframe estilo CapCut (prompt.txt item 5).
 *
 * Fica ao lado de cada parâmetro animável do inspector. Três estados:
 *  - vazio: propriedade sem keyframes
 *  - contorno: tem keyframes, mas nenhum no playhead (clique cria um aqui)
 *  - preenchido: keyframe exatamente no playhead (clique remove)
 * O valor gravado é o valor atual do parâmetro (raw, unidades do engine).
 */

import React, { useMemo } from "react";
import { Diamond } from "lucide-react";
import { KeyframeEngine } from "@openreel/core";

const keyframeEngine = new KeyframeEngine();
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEngineStore } from "../../../stores/engine-store";

const AT_PLAYHEAD_EPSILON = 0.01;

export interface KeyframeDiamondProps {
  clipId: string;
  /** Id da propriedade animável (ex.: "position.x", "opacity", "volume"). */
  property: string;
  /** Valor atual do parâmetro em unidades do engine (não da UI). */
  currentValue: number;
}

export const KeyframeDiamond: React.FC<KeyframeDiamondProps> = ({
  clipId,
  property,
  currentValue,
}) => {
  const { getClip, updateClipKeyframes, updateTextClipKeyframes, project } =
    useProjectStore();
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const getGraphicsEngine = useEngineStore((s) => s.getGraphicsEngine);
  const getTitleEngine = useEngineStore((s) => s.getTitleEngine);

  const resolved = useMemo(() => {
    const timelineClip = getClip(clipId);
    if (timelineClip) {
      return { keyframes: timelineClip.keyframes ?? [], kind: "timeline" as const };
    }
    const graphics = getGraphicsEngine();
    const graphicClip =
      graphics?.getSVGClip(clipId) ??
      graphics?.getShapeClip(clipId) ??
      graphics?.getStickerClip(clipId);
    if (graphicClip) {
      return { keyframes: graphicClip.keyframes ?? [], kind: "timeline" as const };
    }
    const textClip = getTitleEngine()?.getTextClip(clipId);
    if (textClip) {
      return { keyframes: textClip.keyframes ?? [], kind: "text" as const };
    }
    return null;
    // project.modifiedAt força recomputo quando keyframes mudam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, getClip, getGraphicsEngine, getTitleEngine, project.modifiedAt]);

  if (!resolved) return null;

  const propertyKeyframes = resolved.keyframes.filter(
    (kf) => kf.property === property,
  );
  const atPlayhead = propertyKeyframes.find(
    (kf) => Math.abs(kf.time - playhead) < AT_PLAYHEAD_EPSILON,
  );
  const hasAny = propertyKeyframes.length > 0;

  const commit = (updated: typeof resolved.keyframes) => {
    if (resolved.kind === "text") updateTextClipKeyframes(clipId, updated);
    else updateClipKeyframes(clipId, updated);
  };

  const toggle = () => {
    if (atPlayhead) {
      commit(keyframeEngine.removeKeyframe(resolved.keyframes, atPlayhead.id));
      return;
    }
    const created = keyframeEngine.addKeyframe(
      clipId,
      property,
      playhead,
      currentValue,
      "ease-in-out",
    );
    commit(
      [...resolved.keyframes, created].sort((a, b) => a.time - b.time),
    );
  };

  return (
    <button
      onClick={toggle}
      title={
        atPlayhead
          ? "Remover keyframe neste ponto"
          : hasAny
            ? "Adicionar keyframe no playhead (propriedade já animada)"
            : "Animar esta propriedade: criar keyframe no playhead"
      }
      className={`shrink-0 rounded p-0.5 transition-colors ${
        atPlayhead
          ? "text-accent"
          : hasAny
            ? "text-accent/60 hover:text-accent"
            : "text-fg-muted hover:text-fg"
      }`}
    >
      <Diamond
        size={11}
        fill={atPlayhead ? "currentColor" : hasAny ? "transparent" : "none"}
        strokeWidth={atPlayhead ? 0 : 2}
      />
    </button>
  );
};

/** Linha utilitária: controle + diamante alinhado à direita. */
export const KeyframeRow: React.FC<
  KeyframeDiamondProps & { children: React.ReactNode }
> = ({ children, ...diamond }) => (
  <div className="flex items-end gap-1.5">
    <div className="min-w-0 flex-1">{children}</div>
    <div className="pb-1.5">
      <KeyframeDiamond {...diamond} />
    </div>
  </div>
);
