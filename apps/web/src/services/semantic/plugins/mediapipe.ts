/**
 * Setup compartilhado do MediaPipe Tasks Vision (open source, roda local via
 * WASM + WebGPU/GPU). Os arquivos WASM e os modelos .task/.tflite são baixados
 * do CDN e ficam em cache do navegador (mesmo padrão do Whisper via HF).
 */

import { FilesetResolver } from "@mediapipe/tasks-vision";

// WASM do MediaPipe (versão casada com o pacote npm).
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";

// Modelos oficiais (Google Cloud Storage — gratuitos, open model cards).
export const MODEL_URLS = {
  objectDetector:
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  faceLandmarker:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  poseLandmarker:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  gestureRecognizer:
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
} as const;

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null =
  null;

export function getVisionFileset() {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_BASE);
  return filesetPromise;
}

/** GPU quando o config permite e o navegador suporta; senão CPU (WASM). */
export function pickDelegate(useWebGPU: boolean): "GPU" | "CPU" {
  return useWebGPU ? "GPU" : "CPU";
}
