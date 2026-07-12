/**
 * Face Analyzer + Expression Analyzer (prompt.txt) — MediaPipe FaceLandmarker
 * (468 landmarks + blendshapes + matriz de transformação). As expressões
 * (sorriso, surpresa, boca aberta, olhos fechados, olhando p/ câmera) são
 * derivadas das blendshapes, sem modelo extra — como os filtros de TikTok/IG.
 *
 * Emite eventos "face" (com landmarks para overlay) e, se `expression` estiver
 * ativo, eventos de expressão. finalize enxuga os landmarks pesados para o
 * timeline final.
 */

import type {
  AnalyzerContext,
  AnalyzerFrame,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";
import {
  FaceLandmarker,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  createWithDelegateFallback,
  getVisionFileset,
  MODEL_URLS,
} from "./mediapipe";

function blend(
  categories: Array<{ categoryName: string; score: number }>,
  name: string,
): number {
  return categories.find((c) => c.categoryName === name)?.score ?? 0;
}

/** Deriva ângulos de cabeça (yaw/pitch/roll, graus) da matriz 4x4. */
function headPose(matrix: number[] | undefined): {
  yaw: number;
  pitch: number;
  roll: number;
} {
  if (!matrix || matrix.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  // Matriz column-major; extrai rotação.
  const r00 = matrix[0];
  const r10 = matrix[1];
  const r20 = matrix[2];
  const r21 = matrix[6];
  const r22 = matrix[10];
  const deg = (r: number) => Math.round((r * 180) / Math.PI);
  return {
    yaw: deg(Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22))),
    pitch: deg(Math.atan2(r21, r22)),
    roll: deg(Math.atan2(r10, r00)),
  };
}

export class FaceAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "face" as const;
  readonly label = "Rosto e expressões";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private landmarker: FaceLandmarker | null = null;

  async init(context: AnalyzerContext): Promise<void> {
    if (this.landmarker) return;
    const fileset = await getVisionFileset();
    this.landmarker = await createWithDelegateFallback(
      (delegate) =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_URLS.faceLandmarker,
            delegate,
          },
          runningMode: "IMAGE",
          numFaces: 4,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        }),
      context.config.performance.useWebGPU,
    );
  }

  async analyzeFrame(
    frame: AnalyzerFrame,
    context: AnalyzerContext,
  ): Promise<SemanticEvent[]> {
    if (!this.landmarker) return [];
    const result: FaceLandmarkerResult = this.landmarker.detect(frame.bitmap);
    const events: SemanticEvent[] = [];
    const expressionOn = context.config.enabled.expression;

    result.faceLandmarks.forEach((landmarks, i) => {
      const pose = headPose(
        result.facialTransformationMatrixes?.[i]?.data
          ? Array.from(result.facialTransformationMatrixes[i].data)
          : undefined,
      );
      // Landmarks compactos para overlay (x,y normalizados).
      const pts = landmarks.map((l) => ({
        x: Math.round(l.x * 1000) / 1000,
        y: Math.round(l.y * 1000) / 1000,
      }));
      events.push({
        start: frame.time,
        end: frame.time,
        type: "face_raw",
        confidence: 0.9,
        metadata: { faceIndex: i, landmarks: pts, headPose: pose },
      });

      if (!expressionOn) return;
      const bs = result.faceBlendshapes?.[i]?.categories ?? [];
      const smile =
        (blend(bs, "mouthSmileLeft") + blend(bs, "mouthSmileRight")) / 2;
      const jawOpen = blend(bs, "jawOpen");
      const browUp = blend(bs, "browInnerUp");
      const eyesClosed =
        (blend(bs, "eyeBlinkLeft") + blend(bs, "eyeBlinkRight")) / 2;
      const gazeOut =
        blend(bs, "eyeLookOutLeft") + blend(bs, "eyeLookOutRight") +
        blend(bs, "eyeLookInLeft") + blend(bs, "eyeLookInRight");

      const push = (type: string, confidence: number, extra = {}) =>
        events.push({
          start: frame.time,
          end: frame.time,
          type,
          confidence: Math.round(confidence * 100) / 100,
          metadata: { faceIndex: i, ...extra },
        });

      if (smile > 0.4) push("face_smile", smile);
      if (jawOpen > 0.4 && browUp > 0.3) push("face_surprise", (jawOpen + browUp) / 2);
      else if (jawOpen > 0.5) push("face_mouth_open", jawOpen);
      if (eyesClosed > 0.5) push("face_eyes_closed", eyesClosed);
      if (Math.abs(pose.yaw) < 12 && Math.abs(pose.pitch) < 12 && gazeOut < 0.5) {
        push("face_looking_camera", 0.6);
      }
    });

    return events;
  }

  /** Enxuga: agrupa "face_raw" em eventos "face" leves; mantém expressões. */
  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    const out: SemanticEvent[] = [];
    for (const e of raw) {
      if (e.type === "face_raw") {
        out.push({
          start: e.start,
          end: e.start,
          type: "face",
          confidence: e.confidence,
          metadata: {
            faceIndex: e.metadata.faceIndex,
            headPose: e.metadata.headPose,
          },
        });
      } else {
        out.push(e); // expressões já são leves
      }
    }
    return out;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
