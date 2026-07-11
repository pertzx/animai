/**
 * Pose Analyzer (prompt.txt) — MediaPipe PoseLandmarker. Classifica poses
 * (em pé, sentado, andando, braço levantado, apontando, acenando…) por
 * geometria dos 33 landmarks. Andar/correr são inferidos pela variação de
 * posição dos pés entre frames.
 */

import type {
  AnalyzerContext,
  AnalyzerFrame,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";
import {
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { getVisionFileset, MODEL_URLS, pickDelegate } from "./mediapipe";

// Índices dos landmarks (BlazePose).
const L = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

type Pt = { x: number; y: number };

function classifyPose(pts: Pt[]): { pose: string; confidence: number } {
  const hipY = (pts[L.leftHip].y + pts[L.rightHip].y) / 2;
  const kneeY = (pts[L.leftKnee].y + pts[L.rightKnee].y) / 2;
  const shoulderY = (pts[L.leftShoulder].y + pts[L.rightShoulder].y) / 2;

  // Sentado: joelho perto do quadril (verticalmente).
  const torso = Math.abs(hipY - shoulderY) || 0.01;
  const sitting = (kneeY - hipY) / torso < 0.6;

  // Braço levantado: pulso acima do ombro.
  const leftArmUp = pts[L.leftWrist].y < shoulderY - 0.02;
  const rightArmUp = pts[L.rightWrist].y < shoulderY - 0.02;

  if (leftArmUp || rightArmUp) {
    return { pose: "levantando braço", confidence: 0.7 };
  }
  if (sitting) return { pose: "sentado", confidence: 0.65 };
  return { pose: "em pé", confidence: 0.6 };
}

export class PoseAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "pose" as const;
  readonly label = "Pose corporal";
  readonly usesFrames = true;
  readonly usesAudio = false;

  private landmarker: PoseLandmarker | null = null;
  private prevAnkle: { y: number; time: number } | null = null;

  async init(context: AnalyzerContext): Promise<void> {
    if (this.landmarker) return;
    const fileset = await getVisionFileset();
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URLS.poseLandmarker,
        delegate: pickDelegate(context.config.performance.useWebGPU),
      },
      runningMode: "VIDEO",
      numPoses: 2,
    });
  }

  async analyzeFrame(frame: AnalyzerFrame): Promise<SemanticEvent[]> {
    if (!this.landmarker) return [];
    const result: PoseLandmarkerResult = this.landmarker.detectForVideo(
      frame.bitmap,
      Math.round(frame.time * 1000),
    );
    const events: SemanticEvent[] = [];

    result.landmarks.forEach((landmarks, i) => {
      const pts: Pt[] = landmarks.map((l) => ({ x: l.x, y: l.y }));
      const { pose, confidence } = classifyPose(pts);

      // Andando/correndo: deslocamento vertical dos tornozelos entre frames.
      const ankleY = (pts[L.leftAnkle].y + pts[L.rightAnkle].y) / 2;
      let motion = pose;
      let motionConf = confidence;
      if (i === 0 && this.prevAnkle) {
        const dt = frame.time - this.prevAnkle.time || 1;
        const speed = Math.abs(ankleY - this.prevAnkle.y) / dt;
        if (speed > 0.25) {
          motion = "correndo";
          motionConf = 0.6;
        } else if (speed > 0.08) {
          motion = "andando";
          motionConf = 0.55;
        }
      }
      if (i === 0) this.prevAnkle = { y: ankleY, time: frame.time };

      // Overlay: skeleton compacto.
      const skeleton = pts.map((p) => ({
        x: Math.round(p.x * 1000) / 1000,
        y: Math.round(p.y * 1000) / 1000,
      }));
      events.push({
        start: frame.time,
        end: frame.time,
        type: "pose_raw",
        confidence: motionConf,
        metadata: { poseIndex: i, pose: motion, skeleton },
      });
    });

    return events;
  }

  /** Agrupa poses contíguas iguais e enxuga o skeleton. */
  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    const sorted = [...raw].sort((a, b) => a.start - b.start);
    const out: SemanticEvent[] = [];
    let current: SemanticEvent | null = null;
    for (const e of sorted) {
      const pose = e.metadata.pose;
      if (current && current.metadata.pose === pose && e.start - current.end < 1.5) {
        current.end = e.start;
      } else {
        if (current) out.push(current);
        current = {
          start: e.start,
          end: e.start,
          type: "pose",
          confidence: e.confidence,
          metadata: { pose },
        };
      }
    }
    if (current) out.push(current);
    return out;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.prevAnkle = null;
  }
}
