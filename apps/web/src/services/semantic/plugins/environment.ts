/**
 * Environment Analyzer (prompt.txt) — classificação de cena zero-shot via CLIP
 * (transformers.js, open source). Zero-shot permite usar exatamente os rótulos
 * pedidos (praia, cidade, estrada, floresta, escritório, academia, cozinha,
 * quarto, sala). Roda esparsamente (a cada ~3s) por ser o detector mais pesado.
 */

import type {
  AnalyzerContext,
  AnalyzerFrame,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";
import {
  env,
  pipeline,
  type ZeroShotImageClassificationPipeline,
} from "@huggingface/transformers";

env.allowLocalModels = false;

const SCENES: Array<{ label: string; prompt: string }> = [
  { label: "praia", prompt: "a beach" },
  { label: "cidade", prompt: "a city street" },
  { label: "estrada", prompt: "a road or highway" },
  { label: "floresta", prompt: "a forest" },
  { label: "escritório", prompt: "an office" },
  { label: "academia", prompt: "a gym" },
  { label: "cozinha", prompt: "a kitchen" },
  { label: "quarto", prompt: "a bedroom" },
  { label: "sala", prompt: "a living room" },
];

const THROTTLE_SEC = 3;

export class EnvironmentAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "environment" as const;
  readonly label = "Ambiente";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private classifier: ZeroShotImageClassificationPipeline | null = null;
  private lastRun = -Infinity;

  async init(): Promise<void> {
    if (this.classifier) return;
    this.classifier = (await pipeline(
      "zero-shot-image-classification",
      "Xenova/clip-vit-base-patch32",
      { dtype: "q8" },
    )) as ZeroShotImageClassificationPipeline;
  }

  async analyzeFrame(
    frame: AnalyzerFrame,
    context: AnalyzerContext,
  ): Promise<SemanticEvent[]> {
    if (!this.classifier) return [];
    if (frame.time - this.lastRun < THROTTLE_SEC) return [];
    this.lastRun = frame.time;

    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d")!.drawImage(frame.bitmap, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

    const output = (await this.classifier(
      dataUrl,
      SCENES.map((s) => s.prompt),
    )) as Array<{ label: string; score: number }>;
    const top = output[0];
    if (!top || top.score < Math.max(0.25, context.config.precision.minConfidence)) {
      return [];
    }
    const scene = SCENES.find((s) => s.prompt === top.label)?.label ?? top.label;
    return [
      {
        start: frame.time,
        end: frame.time,
        type: "environment_raw",
        confidence: top.score,
        metadata: { scene },
      },
    ];
  }

  /** Agrupa cenas contíguas iguais em intervalos. */
  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    const sorted = [...raw].sort((a, b) => a.start - b.start);
    const out: SemanticEvent[] = [];
    let current: SemanticEvent | null = null;
    for (const e of sorted) {
      const scene = e.metadata.scene;
      if (
        current &&
        current.metadata.scene === scene &&
        e.start - current.end < THROTTLE_SEC * 2
      ) {
        current.end = e.start;
        current.confidence = Math.max(current.confidence, e.confidence);
      } else {
        if (current) out.push(current);
        current = {
          start: e.start,
          end: e.start,
          type: "environment",
          confidence: e.confidence,
          metadata: { scene },
        };
      }
    }
    if (current) out.push(current);
    return out;
  }

  dispose(): void {
    this.classifier = null;
    this.lastRun = -Infinity;
  }
}
