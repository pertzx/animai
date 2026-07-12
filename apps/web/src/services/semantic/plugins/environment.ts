/**
 * Environment Analyzer (prompt.txt) — classificação de cena zero-shot via CLIP
 * (transformers.js, open source), em DUAS ETAPAS para robustez:
 *
 *   1. Aberto (outdoor) vs Fechado (indoor) — decisão binária, muito mais
 *      confiável que classificar a cena direto. Usa ensemble de prompts.
 *   2. A cena específica é escolhida SÓ dentro da categoria vencedora — assim
 *      um parque ao ar livre nunca é rotulado como "academia" (indoor).
 *
 * A decisão é por VOTAÇÃO entre todos os frames amostrados (não um frame só).
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

// Ensemble de prompts para a decisão aberto/fechado (média das pontuações).
const OUTDOOR_PROMPTS = [
  "a photo taken outdoors in the open air",
  "an outdoor scene with sky, trees or streets",
  "a person outside in nature or a city",
];
const INDOOR_PROMPTS = [
  "a photo taken indoors inside a building",
  "an indoor scene with walls, floor and ceiling",
  "a person inside a room or building",
];

type Scene = { label: string; prompt: string };

const OUTDOOR_SCENES: Scene[] = [
  { label: "parque", prompt: "an outdoor park with trees and grass" },
  { label: "floresta", prompt: "a forest with many trees" },
  { label: "campo", prompt: "an open field or countryside" },
  { label: "praia", prompt: "a beach with sand and sea" },
  { label: "cidade", prompt: "a city street with buildings outdoors" },
  { label: "estrada", prompt: "a road or highway outdoors" },
  { label: "quadra", prompt: "an outdoor sports court or field" },
];
const INDOOR_SCENES: Scene[] = [
  { label: "academia", prompt: "the inside of a gym with exercise equipment" },
  { label: "escritório", prompt: "the inside of an office with desks" },
  { label: "cozinha", prompt: "the inside of a kitchen" },
  { label: "quarto", prompt: "the inside of a bedroom with a bed" },
  { label: "sala", prompt: "the inside of a living room with a sofa" },
  { label: "loja", prompt: "the inside of a store or shop" },
];

const THROTTLE_SEC = 2;

export class EnvironmentAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "environment" as const;
  readonly label = "Ambiente";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private classifier: ZeroShotImageClassificationPipeline | null = null;
  private lastRun = -Infinity;

  // Acumuladores para a votação final.
  private outdoorScore = 0;
  private indoorScore = 0;
  private sceneSum = new Map<string, number>();
  private samples = 0;
  private firstTime = 0;
  private lastTime = 0;

  async init(): Promise<void> {
    if (this.classifier) return;
    this.classifier = (await pipeline(
      "zero-shot-image-classification",
      "Xenova/clip-vit-base-patch32",
      { dtype: "q8" },
    )) as ZeroShotImageClassificationPipeline;
  }

  private async classify(
    dataUrl: string,
    prompts: string[],
  ): Promise<Map<string, number>> {
    const out = (await this.classifier!(dataUrl, prompts)) as Array<{
      label: string;
      score: number;
    }>;
    return new Map(out.map((o) => [o.label, o.score]));
  }

  async analyzeFrame(frame: AnalyzerFrame): Promise<SemanticEvent[]> {
    if (!this.classifier) return [];
    if (frame.time - this.lastRun < THROTTLE_SEC) return [];
    this.lastRun = frame.time;

    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d")!.drawImage(frame.bitmap, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    // Etapa 1: aberto vs fechado (ensemble → média).
    const oi = await this.classify(dataUrl, [
      ...OUTDOOR_PROMPTS,
      ...INDOOR_PROMPTS,
    ]);
    const outAvg =
      OUTDOOR_PROMPTS.reduce((s, p) => s + (oi.get(p) ?? 0), 0) /
      OUTDOOR_PROMPTS.length;
    const inAvg =
      INDOOR_PROMPTS.reduce((s, p) => s + (oi.get(p) ?? 0), 0) /
      INDOOR_PROMPTS.length;
    this.outdoorScore += outAvg;
    this.indoorScore += inAvg;

    const isOutdoorFrame = outAvg >= inAvg;

    // Etapa 2: cena específica DENTRO da categoria mais provável do frame.
    const scenes = isOutdoorFrame ? OUTDOOR_SCENES : INDOOR_SCENES;
    const sc = await this.classify(
      dataUrl,
      scenes.map((s) => s.prompt),
    );
    for (const s of scenes) {
      this.sceneSum.set(s.label, (this.sceneSum.get(s.label) ?? 0) + (sc.get(s.prompt) ?? 0));
    }

    if (this.samples === 0) this.firstTime = frame.time;
    this.lastTime = frame.time;
    this.samples++;

    // Feedback ao vivo no Lab.
    let topScene = "";
    let topScore = -1;
    for (const s of scenes) {
      const v = sc.get(s.prompt) ?? 0;
      if (v > topScore) {
        topScore = v;
        topScene = s.label;
      }
    }
    return [
      {
        start: frame.time,
        end: frame.time,
        type: "environment_frame",
        confidence: Math.round(topScore * 100) / 100,
        metadata: {
          scene: topScene,
          openOrClosed: isOutdoorFrame ? "aberto" : "fechado",
        },
      },
    ];
  }

  /** Votação final: categoria (aberto/fechado) + cena dominante dentro dela. */
  finalize(_raw: SemanticEvent[], context: AnalyzerContext): SemanticEvent[] {
    if (this.samples === 0) return [];
    const isOutdoor = this.outdoorScore >= this.indoorScore;
    const allowed = new Set(
      (isOutdoor ? OUTDOOR_SCENES : INDOOR_SCENES).map((s) => s.label),
    );

    let best = "";
    let bestScore = -1;
    for (const [scene, sum] of this.sceneSum) {
      if (!allowed.has(scene)) continue; // ignora cenas da categoria errada
      if (sum > bestScore) {
        bestScore = sum;
        best = scene;
      }
    }
    if (!best) return [];

    const openConfidence =
      Math.max(this.outdoorScore, this.indoorScore) /
      (this.outdoorScore + this.indoorScore || 1);

    return [
      {
        start: this.firstTime,
        end: Math.max(this.lastTime, context.durationSec),
        type: "environment",
        confidence: Math.round(openConfidence * 100) / 100,
        metadata: {
          scene: best,
          openOrClosed: isOutdoor ? "aberto" : "fechado",
          samples: this.samples,
        },
      },
    ];
  }

  dispose(): void {
    this.classifier = null;
    this.lastRun = -Infinity;
    this.outdoorScore = 0;
    this.indoorScore = 0;
    this.sceneSum.clear();
    this.samples = 0;
  }
}
