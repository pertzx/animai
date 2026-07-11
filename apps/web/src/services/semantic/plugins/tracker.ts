/**
 * Object Tracker (prompt.txt) — tracker leve por IoU (estilo SORT) em JS puro.
 * Mantém identidade dos objetos ao longo do vídeo (Pessoa #1, Carro #3…) sem
 * modelo pesado. Usado pelo ObjectAnalyzer no estágio de finalização quando o
 * detector "tracker" está ativo.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection {
  time: number;
  label: string;
  confidence: number;
  box: Box; // normalizado 0..1
}

export interface Track {
  id: number;
  label: string;
  start: number;
  end: number;
  detections: Detection[];
  avgConfidence: number;
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

interface ActiveTrack extends Track {
  lastBox: Box;
  lastTime: number;
}

/**
 * Associa detecções por frame a tracks persistentes. IoU mínimo para casar,
 * e uma track "morre" se some por mais de maxGapSec.
 */
export function trackDetections(
  detections: Detection[],
  options: { iouThreshold?: number; maxGapSec?: number } = {},
): Track[] {
  const iouThreshold = options.iouThreshold ?? 0.3;
  const maxGapSec = options.maxGapSec ?? 1.5;

  // Agrupa por frame (mesmo time) preservando ordem temporal.
  const byTime = new Map<number, Detection[]>();
  for (const d of detections) {
    const arr = byTime.get(d.time) ?? [];
    arr.push(d);
    byTime.set(d.time, arr);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);

  let nextId = 1;
  const active: ActiveTrack[] = [];
  const finished: Track[] = [];

  for (const t of times) {
    // Aposenta tracks que sumiram há tempo demais.
    for (let i = active.length - 1; i >= 0; i--) {
      if (t - active[i].lastTime > maxGapSec) {
        finished.push(active.splice(i, 1)[0]);
      }
    }

    const frameDets = byTime.get(t)!;
    const usedTracks = new Set<number>();
    for (const det of frameDets) {
      // Melhor track candidato (mesmo label, maior IoU).
      let best: ActiveTrack | null = null;
      let bestIou = iouThreshold;
      for (const trk of active) {
        if (trk.label !== det.label || usedTracks.has(trk.id)) continue;
        const score = iou(trk.lastBox, det.box);
        if (score >= bestIou) {
          bestIou = score;
          best = trk;
        }
      }
      if (best) {
        best.detections.push(det);
        best.lastBox = det.box;
        best.lastTime = t;
        best.end = t;
        usedTracks.add(best.id);
      } else {
        const trk: ActiveTrack = {
          id: nextId++,
          label: det.label,
          start: t,
          end: t,
          detections: [det],
          avgConfidence: det.confidence,
          lastBox: det.box,
          lastTime: t,
        };
        active.push(trk);
        usedTracks.add(trk.id);
      }
    }
  }

  finished.push(...active);
  for (const trk of finished) {
    trk.avgConfidence =
      trk.detections.reduce((s, d) => s + d.confidence, 0) /
      trk.detections.length;
  }
  return finished.sort((a, b) => a.start - b.start);
}
