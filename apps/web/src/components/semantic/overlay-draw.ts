/**
 * Desenho dos overlays de visão computacional no canvas do Semantic Lab:
 * bounding boxes com rótulo/confiança/trackId, landmarks faciais, skeleton de
 * pose e landmarks de mão. Recebe os eventos brutos do frame atual.
 */

import type { SemanticEvent } from "../../services/semantic/types";

interface Pt {
  x: number;
  y: number;
}

// Conexões do skeleton (BlazePose) para desenhar linhas.
const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28],
];

// Conexões da mão (MediaPipe Hands).
const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  events: SemanticEvent[],
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 2;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "top";

  for (const e of events) {
    const meta = e.metadata;

    if ((e.type === "object" || e.type === "object_raw") && meta.box) {
      const b = meta.box as { x: number; y: number; w: number; h: number };
      const x = b.x * w;
      const y = b.y * h;
      const bw = b.w * w;
      const bh = b.h * h;
      ctx.strokeStyle = "#10b981";
      ctx.strokeRect(x, y, bw, bh);
      const label = `${meta.label ?? meta.rawLabel ?? "obj"}${meta.trackId ? ` #${meta.trackId}` : ""} ${Math.round(e.confidence * 100)}%`;
      ctx.fillStyle = "#10b981";
      const tw = ctx.measureText(label).width + 6;
      ctx.fillRect(x, Math.max(0, y - 16), tw, 16);
      ctx.fillStyle = "#04170f";
      ctx.fillText(label, x + 3, Math.max(0, y - 15));
    }

    if (e.type === "face_raw" && Array.isArray(meta.landmarks)) {
      ctx.fillStyle = "rgba(59,130,246,0.85)";
      for (const p of meta.landmarks as Pt[]) {
        ctx.fillRect(p.x * w, p.y * h, 1.4, 1.4);
      }
    }

    if (e.type === "pose_raw" && Array.isArray(meta.skeleton)) {
      const pts = meta.skeleton as Pt[];
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      for (const [a, b] of POSE_CONNECTIONS) {
        if (!pts[a] || !pts[b]) continue;
        ctx.beginPath();
        ctx.moveTo(pts[a].x * w, pts[a].y * h);
        ctx.lineTo(pts[b].x * w, pts[b].y * h);
        ctx.stroke();
      }
      ctx.fillStyle = "#f59e0b";
      for (const p of pts) ctx.fillRect(p.x * w - 2, p.y * h - 2, 4, 4);
    }

    if (e.type === "gesture" && Array.isArray(meta.landmarks)) {
      const pts = meta.landmarks as Pt[];
      ctx.strokeStyle = "#ec4899";
      ctx.lineWidth = 1.5;
      for (const [a, b] of HAND_CONNECTIONS) {
        if (!pts[a] || !pts[b]) continue;
        ctx.beginPath();
        ctx.moveTo(pts[a].x * w, pts[a].y * h);
        ctx.lineTo(pts[b].x * w, pts[b].y * h);
        ctx.stroke();
      }
    }
  }
}
