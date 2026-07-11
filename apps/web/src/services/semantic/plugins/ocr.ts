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

  async init(): Promise<void> {
    this.worker ??= await createWorker(["por", "eng"]);
  }

  async analyzeFrame(
    frame: AnalyzerFrame,
    context: AnalyzerContext,
  ): Promise<SemanticEvent[]> {
    if (!this.worker) return [];
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d")!.drawImage(frame.bitmap, 0, 0);
    const { data } = await this.worker.recognize(canvas);
    const conf = (data.confidence ?? 0) / 100;
    if (conf < context.config.precision.minConfidence) return [];
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
  }
}
