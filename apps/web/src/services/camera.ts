/**
 * Câmera 3D com profundidade, estilo Alight Motion (prompt.txt #2).
 *
 * Cada elemento tem uma profundidade (cameDepth, em unidades). A câmera
 * (x, y, zoom) afeta os elementos proporcionalmente à profundidade: elementos
 * ao fundo (profundidade alta) se movem/escalam MENOS com a câmera; elementos
 * à frente (profundidade negativa) se movem MAIS — gerando parallax real e o
 * aspecto 3D. O movimento é "assado" como keyframes de position/scale, então
 * funciona idêntico no preview e no export, sem tocar no pipeline de render.
 *
 * x/y em pixels do projeto (0,0 = centro); zoom 1 = enquadramento normal.
 */

import { KeyframeEngine } from "@openreel/core";
import type { Clip, Keyframe } from "@openreel/core";
import { shortId } from "../lib/short-id";
import { useProjectStore } from "../stores/project-store";

export interface CameraKeyframe {
  /** Tempo na timeline, em segundos. */
  time: number;
  /** Centro da câmera em pixels do projeto (0,0 = centro do quadro). */
  x: number;
  y: number;
  /** 1 = normal; 2 = aproxima 2x; 0.5 = afasta. */
  zoom: number;
}

/** Distância focal virtual: controla a força do parallax. */
const FOCAL = 1000;

const keyframeEngine = new KeyframeEngine();

/** Profundidade do clipe (0 = plano focal; >0 = fundo; <0 = frente). */
export function getClipDepth(clip: Clip): number {
  const d = clip.metadata?.cameraDepth;
  return typeof d === "number" && Number.isFinite(d) ? d : 0;
}

/**
 * Fator de parallax pela profundidade: 1 no plano focal, <1 no fundo (move
 * menos), >1 na frente (move mais). É a essência do efeito 3D.
 */
export function parallaxFactor(depth: number): number {
  return FOCAL / (FOCAL + depth);
}

/** Valor base de uma propriedade do clipe (sem câmera). */
function baseValue(clip: Clip, property: string): number {
  switch (property) {
    case "position.x":
      return clip.transform.position.x;
    case "position.y":
      return clip.transform.position.y;
    case "scale.x":
      return clip.transform.scale.x;
    case "scale.y":
      return clip.transform.scale.y;
    default:
      return 0;
  }
}

/** Define a profundidade 3D de um clipe (usada pela câmera para o parallax). */
export function setClipDepth(clipId: string, depth: number): boolean {
  let found = false;
  useProjectStore.setState((state) => ({
    project: {
      ...state.project,
      modifiedAt: Date.now(),
      timeline: {
        ...state.project.timeline,
        tracks: state.project.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            found = true;
            return {
              ...clip,
              metadata: { ...clip.metadata, cameraDepth: depth },
            };
          }),
        })),
      },
    },
  }));
  return found;
}

/**
 * Aplica o movimento de câmera aos clipes-alvo (default: clipes de vídeo e
 * imagem que cruzam o intervalo dos keyframes). Agrupado no histórico — um
 * undo desfaz o movimento inteiro.
 */
export async function applyCameraMove(
  cameraKeyframes: CameraKeyframe[],
  options: { clipIds?: string[]; easing?: string } = {},
): Promise<{ ok: true; clipsAffected: number } | { ok: false; error: string }> {
  if (cameraKeyframes.length < 2) {
    return { ok: false, error: "Informe pelo menos 2 keyframes de câmera." };
  }
  const sorted = [...cameraKeyframes].sort((a, b) => a.time - b.time);
  const rangeStart = sorted[0].time;
  const rangeEnd = sorted[sorted.length - 1].time;
  const easing = (options.easing ?? "ease-in-out") as Parameters<
    KeyframeEngine["addKeyframe"]
  >[4];

  const store = useProjectStore.getState();
  const project = store.project;

  const targets: Clip[] = [];
  for (const track of project.timeline.tracks) {
    if (track.type !== "video" && track.type !== "image") continue;
    for (const clip of track.clips) {
      if (options.clipIds && !options.clipIds.includes(clip.id)) continue;
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd < rangeStart || clip.startTime > rangeEnd) continue;
      targets.push(clip);
    }
  }
  if (targets.length === 0) {
    return {
      ok: false,
      error:
        "Nenhum clipe de vídeo/imagem no intervalo dos keyframes de câmera.",
    };
  }

  store.beginHistoryGroup("Movimento de câmera");
  try {
    for (const clip of targets) {
      // Remove keyframes anteriores das propriedades da câmera no intervalo
      // (para reaplicar um movimento sem acumular).
      const cameraProps = new Set([
        "position.x",
        "position.y",
        "scale.x",
        "scale.y",
      ]);
      let keyframes: Keyframe[] = clip.keyframes.filter(
        (kf) =>
          !(
            cameraProps.has(kf.property) &&
            kf.time >= rangeStart - clip.startTime - 0.001 &&
            kf.time <= rangeEnd - clip.startTime + 0.001
          ),
      );

      // Profundidade do clipe → fator de parallax (o coração do efeito 3D).
      const factor = parallaxFactor(getClipDepth(clip));

      for (const cam of sorted) {
        // Keyframes do clipe são relativos ao início do clipe.
        const localTime = cam.time - clip.startTime;
        if (localTime < 0 || localTime > clip.duration) continue;

        // Transform inverso da câmera COM profundidade:
        //  - pan: deslocamento proporcional ao parallax (fundo move menos).
        //  - zoom: dolly — elementos à frente crescem mais que os do fundo.
        const zoomForDepth = 1 + (cam.zoom - 1) * factor;
        const values: Array<[string, number]> = [
          ["position.x", baseValue(clip, "position.x") - cam.x * factor],
          ["position.y", baseValue(clip, "position.y") - cam.y * factor],
          ["scale.x", baseValue(clip, "scale.x") * zoomForDepth],
          ["scale.y", baseValue(clip, "scale.y") * zoomForDepth],
        ];
        for (const [property, value] of values) {
          const created = keyframeEngine.addKeyframe(
            clip.id,
            property,
            localTime,
            value,
            easing,
          );
          keyframes.push({ ...created, id: shortId("kf") });
        }
      }

      keyframes = keyframes.sort((a, b) => a.time - b.time);
      store.updateClipKeyframes(clip.id, keyframes);
    }
  } finally {
    store.endHistoryGroup();
  }

  return { ok: true, clipsAffected: targets.length };
}

/** Presets prontos de movimento (UI da aba graphics). */
export function cameraPresets(durationSec: number): Array<{
  id: string;
  name: string;
  keyframes: CameraKeyframe[];
}> {
  const d = Math.max(1, durationSec);
  return [
    {
      id: "zoom-in",
      name: "Zoom in lento",
      keyframes: [
        { time: 0, x: 0, y: 0, zoom: 1 },
        { time: d, x: 0, y: 0, zoom: 1.25 },
      ],
    },
    {
      id: "zoom-out",
      name: "Zoom out",
      keyframes: [
        { time: 0, x: 0, y: 0, zoom: 1.3 },
        { time: d, x: 0, y: 0, zoom: 1 },
      ],
    },
    {
      id: "pan-right",
      name: "Pan esquerda → direita",
      keyframes: [
        { time: 0, x: -120, y: 0, zoom: 1.15 },
        { time: d, x: 120, y: 0, zoom: 1.15 },
      ],
    },
    {
      id: "punch-in",
      name: "Punch-in dramático",
      keyframes: [
        { time: 0, x: 0, y: 0, zoom: 1 },
        { time: Math.min(0.4, d / 3), x: 0, y: -40, zoom: 1.45 },
      ],
    },
    {
      id: "parallax",
      name: "Parallax 3D (defina profundidades)",
      keyframes: [
        { time: 0, x: -160, y: 0, zoom: 1.2 },
        { time: d, x: 160, y: 0, zoom: 1.2 },
      ],
    },
    {
      id: "dolly-3d",
      name: "Dolly 3D (aproxima com profundidade)",
      keyframes: [
        { time: 0, x: 0, y: 0, zoom: 1 },
        { time: d, x: 0, y: 0, zoom: 1.6 },
      ],
    },
  ];
}
