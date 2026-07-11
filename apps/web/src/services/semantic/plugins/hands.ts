/**
 * Hand / Gesture Analyzer (prompt.txt) — MediaPipe GestureRecognizer.
 * Detecta mãos, landmarks e gestos (joinha, mão aberta, apontar, positivo/
 * negativo, coração, punho…). Emite eventos "gesture".
 */

import type {
  AnalyzerContext,
  AnalyzerFrame,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";
import {
  GestureRecognizer,
  type GestureRecognizerResult,
} from "@mediapipe/tasks-vision";
import { getVisionFileset, MODEL_URLS, pickDelegate } from "./mediapipe";

const GESTURE_PT: Record<string, string> = {
  Thumb_Up: "joinha",
  Thumb_Down: "negativo",
  Open_Palm: "mão aberta",
  Closed_Fist: "punho",
  Pointing_Up: "apontando",
  Victory: "vitória",
  ILoveYou: "te amo",
};

export class HandsAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "hands" as const;
  readonly label = "Mãos e gestos";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private recognizer: GestureRecognizer | null = null;

  async init(context: AnalyzerContext): Promise<void> {
    if (this.recognizer) return;
    const fileset = await getVisionFileset();
    this.recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URLS.gestureRecognizer,
        delegate: pickDelegate(context.config.performance.useWebGPU),
      },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  async analyzeFrame(
    frame: AnalyzerFrame,
    context: AnalyzerContext,
  ): Promise<SemanticEvent[]> {
    if (!this.recognizer) return [];
    const result: GestureRecognizerResult = this.recognizer.recognizeForVideo(
      frame.bitmap,
      Math.round(frame.time * 1000),
    );
    const events: SemanticEvent[] = [];
    const minConf = context.config.precision.minConfidence;

    result.gestures.forEach((handGestures, i) => {
      const g = handGestures[0];
      if (!g || g.score < minConf || g.categoryName === "None") return;
      const landmarks = (result.landmarks?.[i] ?? []).map((l) => ({
        x: Math.round(l.x * 1000) / 1000,
        y: Math.round(l.y * 1000) / 1000,
      }));
      events.push({
        start: frame.time,
        end: frame.time,
        type: "gesture",
        confidence: g.score,
        metadata: {
          gesture: GESTURE_PT[g.categoryName] ?? g.categoryName,
          rawGesture: g.categoryName,
          handIndex: i,
          landmarks,
        },
      });
    });
    return events;
  }

  /** Agrupa gestos iguais contíguos e enxuga landmarks. */
  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    const sorted = [...raw].sort((a, b) => a.start - b.start);
    const out: SemanticEvent[] = [];
    let current: SemanticEvent | null = null;
    for (const e of sorted) {
      const g = e.metadata.gesture;
      if (
        current &&
        current.metadata.gesture === g &&
        e.start - current.end < 1.0
      ) {
        current.end = e.start;
        current.confidence = Math.max(current.confidence, e.confidence);
      } else {
        if (current) out.push(current);
        current = {
          start: e.start,
          end: e.start,
          type: "gesture",
          confidence: e.confidence,
          metadata: { gesture: g, rawGesture: e.metadata.rawGesture },
        };
      }
    }
    if (current) out.push(current);
    return out;
  }

  dispose(): void {
    this.recognizer?.close();
    this.recognizer = null;
  }
}
