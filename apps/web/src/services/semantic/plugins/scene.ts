/**
 * Scene Analyzer (prompt.txt) — 100% JS, sem modelo.
 * Detecta cortes, fades e mudanças bruscas por diferença de histograma de
 * luminância entre frames consecutivos.
 */

import type {
  AnalyzerContext,
  AnalyzerFrame,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";

const BINS = 16;
const CUT_THRESHOLD = 0.45; // distância de histograma p/ corte
const FADE_LUMA = 0.08; // luminância média p/ considerar preto/fade

function lumaHistogram(bitmap: ImageBitmap): {
  hist: Float32Array;
  meanLuma: number;
} {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const hist = new Float32Array(BINS);
  let sum = 0;
  const px = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    hist[Math.min(BINS - 1, Math.floor(l * BINS))]++;
    sum += l;
  }
  for (let b = 0; b < BINS; b++) hist[b] /= px;
  return { hist, meanLuma: sum / px };
}

/** Distância L1 entre histogramas normalizados (0..2 → normaliza p/ 0..1). */
function histDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < BINS; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

export class SceneAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "scene" as const;
  readonly label = "Cenas";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private prevHist: Float32Array | null = null;
  private prevLuma = 1;

  async init(): Promise<void> {}

  async analyzeFrame(frame: AnalyzerFrame): Promise<SemanticEvent[]> {
    const { hist, meanLuma } = lumaHistogram(frame.bitmap);
    const events: SemanticEvent[] = [];

    if (this.prevHist) {
      const dist = histDistance(this.prevHist, hist);
      if (dist > CUT_THRESHOLD) {
        events.push({
          start: frame.time,
          end: frame.time,
          type: "scene_cut",
          confidence: Math.min(1, dist),
          metadata: { distance: Math.round(dist * 100) / 100 },
        });
      }
      // Fade: passa por (quase) preto vindo de um frame claro, ou vice-versa.
      if (
        (meanLuma < FADE_LUMA && this.prevLuma > 0.2) ||
        (this.prevLuma < FADE_LUMA && meanLuma > 0.2)
      ) {
        events.push({
          start: frame.time,
          end: frame.time,
          type: "scene_fade",
          confidence: 0.7,
          metadata: { meanLuma: Math.round(meanLuma * 100) / 100 },
        });
      }
    }

    this.prevHist = hist;
    this.prevLuma = meanLuma;
    return events;
  }

  finalize(raw: SemanticEvent[], _context: AnalyzerContext): SemanticEvent[] {
    return raw;
  }

  dispose(): void {
    this.prevHist = null;
  }
}
