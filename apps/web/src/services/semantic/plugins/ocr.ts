/**
 * OCR Analyzer (prompt.txt) — texto na tela via tesseract.js.
 * Emite eventos por frame; finalize agrupa em janelas (entrada/saída/mudança
 * do texto) com timestamps.
 */

import type {
  AnalyzerContext,
  AnalyzerFrame,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";

function cleanText(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && /[\p{L}\p{N}]{2,}/u.test(l))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export class OcrAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "ocr" as const;
  readonly label = "Texto na tela (OCR)";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private worker: TesseractWorker | null = null;
  // OCR é caro (upscale + reconhecimento); texto na tela persiste por segundos,
  // então analisa no máximo a cada ~1,5s de vídeo em vez de todo frame.
  private lastRun = -Infinity;
  private readonly throttleSec = 1.5;

  async init(): Promise<void> {
    this.worker ??= await createWorker(["por", "eng"]);
  }

  async analyzeFrame(
    frame: AnalyzerFrame,
    _context: AnalyzerContext,
  ): Promise<SemanticEvent[]> {
    if (!this.worker) return [];
    if (frame.time - this.lastRun < this.throttleSec) return [];
    this.lastRun = frame.time;
    // Upscale para ~1024px no lado maior + escala de cinza e contraste: o
    // frame de análise (ex.: 480px) é pequeno demais para o OCR ler texto.
    const target = 1024;
    const scale = Math.max(1, target / Math.max(frame.width, frame.height));
    const w = Math.round(frame.width * scale);
    const h = Math.round(frame.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(frame.bitmap, 0, 0, w, h);
    // Pré-processa: cinza + aumento de contraste ajuda muito o Tesseract.
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const c = Math.max(0, Math.min(255, (g - 128) * 1.4 + 128));
      d[i] = d[i + 1] = d[i + 2] = c;
    }
    ctx.putImageData(img, 0, 0);

    const { data } = await this.worker.recognize(canvas);
    // Confiança do OCR é mais baixa que a de detecção; usa limiar próprio.
    const conf = (data.confidence ?? 0) / 100;
    if (conf < 0.3) return [];
    const text = cleanText(data.text ?? "");
    if (!text) return [];
    // Evento pontual por frame; finalize agrupa em intervalos.
    return [
      {
        start: frame.time,
        end: frame.time,
        type: "onscreen_text_raw",
        confidence: conf,
        metadata: { text },
      },
    ];
  }

  /** Agrupa detecções contíguas do mesmo texto em um único intervalo. */
  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    const sorted = [...raw].sort((a, b) => a.start - b.start);
    const grouped: SemanticEvent[] = [];
    let current: SemanticEvent | null = null;
    const GAP = 2.5; // segundos de tolerância entre frames do mesmo texto

    for (const e of sorted) {
      const text = String(e.metadata.text ?? "");
      if (
        current &&
        current.metadata.text === text &&
        e.start - current.end <= GAP
      ) {
        current.end = e.start;
        current.confidence = Math.max(current.confidence, e.confidence);
      } else {
        if (current) grouped.push(current);
        current = {
          start: e.start,
          end: e.start,
          type: "onscreen_text",
          confidence: e.confidence,
          metadata: { text },
        };
      }
    }
    if (current) grouped.push(current);
    return grouped;
  }

  dispose(): void {
    void this.worker?.terminate();
    this.worker = null;
    this.lastRun = -Infinity;
  }
}
