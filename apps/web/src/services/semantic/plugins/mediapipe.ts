/**
 * Setup compartilhado do MediaPipe Tasks Vision (open source, roda local via
 * WASM + WebGPU/GPU). Os arquivos WASM e os modelos .task/.tflite são baixados
 * do CDN e ficam em cache do navegador (mesmo padrão do Whisper via HF).
 */

import { FilesetResolver } from "@mediapipe/tasks-vision";

// WASM do MediaPipe — a versão TEM de bater exatamente com o pacote npm
// instalado (@mediapipe/tasks-vision), senão os modelos falham silenciosamente
// e nada é detectado. Mantenha em sincronia com o package.json.
const MEDIAPIPE_VERSION = "0.10.35";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

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

/**
 * Cria um task do MediaPipe tentando GPU primeiro (se permitido) e caindo para
 * CPU/WASM se o delegate GPU falhar — muitos navegadores/GPUs não suportam o
 * delegate GPU, o que antes fazia o detector falhar silenciosamente.
 */
export async function createWithDelegateFallback<T>(
  create: (delegate: "GPU" | "CPU") => Promise<T>,
  preferGpu: boolean,
): Promise<T> {
  if (preferGpu) {
    try {
      return await create("GPU");
    } catch (err) {
      console.warn(
        "[semantic] delegate GPU falhou, usando CPU/WASM:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return create("CPU");
}
