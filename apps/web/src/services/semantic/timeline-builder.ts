/**
 * Timeline Builder (prompt.txt): funde os eventos de todos os plugins numa
 * Timeline Semântica ordenada, gera o resumo legível e as contagens, e o
 * JSON final que a IA consome.
 */

import type {
  SemanticEvent,
  SemanticSummaryLine,
  SemanticTimeline,
} from "./types";

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Texto humano para uma linha do resumo, por tipo de evento. */
function describe(event: SemanticEvent): string | null {
  const meta = event.metadata;
  switch (event.type) {
    case "speech":
      return `Fala: "${String(meta.text ?? "").slice(0, 60)}"`;
    case "silence":
      return "Silêncio";
    case "onscreen_text":
      return `Texto "${String(meta.text ?? "").slice(0, 40)}" aparece`;
    case "scene_cut":
      return "Mudança de cena";
    case "scene_fade":
      return "Fade";
    case "object":
      return `${meta.label ?? "Objeto"}${meta.trackId ? ` #${meta.trackId}` : ""} aparece`;
    case "face":
      return "Rosto detectado";
    case "face_smile":
      return "Pessoa sorri";
    case "face_surprise":
      return "Expressão de surpresa";
    case "face_mouth_open":
      return "Boca aberta";
    case "face_eyes_closed":
      return "Olhos fechados";
    case "face_looking_camera":
      return "Olhando para a câmera";
    case "pose":
      return `Pose: ${meta.pose ?? "desconhecida"}`;
    case "gesture":
      return `Gesto: ${meta.gesture ?? "mão"}`;
    case "audio_event":
      return `Áudio: ${meta.event ?? "evento"}`;
    case "music":
      return `Música${meta.bpm ? ` (~${meta.bpm} BPM)` : ""}`;
    case "environment":
      return `Ambiente: ${meta.scene ?? "cena"}`;
    default:
      return event.type;
  }
}

export function buildSemanticTimeline(
  allEvents: SemanticEvent[],
  durationSec: number,
): SemanticTimeline {
  const events = [...allEvents].sort((a, b) => a.start - b.start);

  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

  // Resumo: uma linha por evento "notável" (evita poluir com cada frame).
  // Deduplica eventos idênticos consecutivos dentro de 1s.
  const summary: SemanticSummaryLine[] = [];
  let lastKey = "";
  let lastTime = -Infinity;
  for (const e of events) {
    const text = describe(e);
    if (!text) continue;
    const key = `${e.type}:${text}`;
    if (key === lastKey && e.start - lastTime < 1.0) continue;
    summary.push({ time: e.start, text: `${fmtTime(e.start)} ${text}` });
    lastKey = key;
    lastTime = e.start;
  }

  return {
    durationSec,
    generatedAt: Date.now(),
    events,
    summary,
    counts,
  };
}

/** JSON final no formato pedido pelo prompt.txt ({ events: [...] }). */
export function timelineToJson(timeline: SemanticTimeline): {
  events: SemanticEvent[];
} {
  return {
    events: timeline.events.map((e) => ({
      start: Math.round(e.start * 100) / 100,
      end: Math.round(e.end * 100) / 100,
      type: e.type,
      confidence: Math.round(e.confidence * 100) / 100,
      metadata: e.metadata,
    })),
  };
}
