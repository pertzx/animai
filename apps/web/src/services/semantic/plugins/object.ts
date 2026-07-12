/**
 * Object Detection + Tracking (prompt.txt) — MediaPipe EfficientDet (COCO,
 * open source) por frame; IDs estáveis via tracker IoU no estágio final.
 * Classes COCO incluem person, car, motorcycle, bus, truck, bicycle, dog,
 * cat, bird, horse, cell phone, laptop, chair, dining table, tv, bottle,
 * cup, sports ball, backpack — exatamente as pedidas no prompt.
 */

import type {
  AnalyzerContext,
  AnalyzerFrame,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";
import { ObjectDetector, type ObjectDetectorResult } from "@mediapipe/tasks-vision";
import {
  createWithDelegateFallback,
  getVisionFileset,
  MODEL_URLS,
} from "./mediapipe";
import { trackDetections, type Detection } from "./tracker";

/** COCO (inglês) → rótulo pt-BR para o resumo. */
const LABELS_PT: Record<string, string> = {
  person: "Pessoa",
  bicycle: "Bicicleta",
  car: "Carro",
  motorcycle: "Moto",
  bus: "Ônibus",
  truck: "Caminhão",
  dog: "Cachorro",
  cat: "Gato",
  bird: "Pássaro",
  horse: "Cavalo",
  "cell phone": "Celular",
  laptop: "Notebook",
  chair: "Cadeira",
  "dining table": "Mesa",
  tv: "Televisão",
  bottle: "Garrafa",
  cup: "Copo",
  "sports ball": "Bola",
  backpack: "Mochila",
};

export class ObjectAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "object" as const;
  readonly label = "Objetos";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private detector: ObjectDetector | null = null;

  async init(context: AnalyzerContext): Promise<void> {
    if (this.detector) return;
    const fileset = await getVisionFileset();
    this.detector = await createWithDelegateFallback(
      (delegate) =>
        ObjectDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_URLS.objectDetector,
            delegate,
          },
          runningMode: "IMAGE",
          scoreThreshold: context.config.precision.minConfidence,
          maxResults: context.config.performance.maxObjects,
        }),
      context.config.performance.useWebGPU,
    );
  }

  async analyzeFrame(
    frame: AnalyzerFrame,
    context: AnalyzerContext,
  ): Promise<SemanticEvent[]> {
    if (!this.detector) return [];
    const result: ObjectDetectorResult = this.detector.detect(frame.image);
    const wanted = context.config.objectClasses;
    const events: SemanticEvent[] = [];
    for (const det of result.detections) {
      const cat = det.categories[0];
      if (!cat?.categoryName) continue;
      if (wanted.length > 0 && !wanted.includes(cat.categoryName)) continue;
      const bb = det.boundingBox;
      if (!bb) continue;
      // Guarda detecção crua; finalize agrupa em tracks.
      events.push({
        start: frame.time,
        end: frame.time,
        type: "object_raw",
        confidence: cat.score,
        metadata: {
          label: cat.categoryName,
          box: {
            x: bb.originX / frame.width,
            y: bb.originY / frame.height,
            w: bb.width / frame.width,
            h: bb.height / frame.height,
          },
        },
      });
    }
    return events;
  }

  finalize(raw: SemanticEvent[], context: AnalyzerContext): SemanticEvent[] {
    const detections: Detection[] = raw.map((e) => ({
      time: e.start,
      label: String(e.metadata.label),
      confidence: e.confidence,
      box: e.metadata.box as Detection["box"],
    }));

    // Sem tracker: um evento por detecção (sem id persistente).
    if (!context.config.enabled.tracker) {
      return raw.map((e) => ({
        start: e.start,
        end: e.start,
        type: "object",
        confidence: e.confidence,
        metadata: {
          label: LABELS_PT[String(e.metadata.label)] ?? e.metadata.label,
          rawLabel: e.metadata.label,
          box: e.metadata.box,
        },
      }));
    }

    // Com tracker: uma entidade por track, com intervalo e trackId estável.
    const tracks = trackDetections(detections);
    return tracks
      .filter((t) => t.detections.length >= 1)
      .map((t) => ({
        start: t.start,
        end: Math.max(t.end, t.start + 0.1),
        type: "object",
        confidence: Math.round(t.avgConfidence * 100) / 100,
        metadata: {
          label: LABELS_PT[t.label] ?? t.label,
          rawLabel: t.label,
          trackId: t.id,
          appearances: t.detections.length,
          box: t.detections[t.detections.length - 1].box,
        },
      }));
  }

  dispose(): void {
    this.detector?.close();
    this.detector = null;
  }
}
