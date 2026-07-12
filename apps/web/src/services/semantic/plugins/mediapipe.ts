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

let cachedBackend: "GPU" | "CPU" | null = null;

/**
 * Auto-detecta o melhor backend para os modelos MediaPipe. O delegate "GPU"
 * usa WebGL2; se o dispositivo não suporta (ou é um contexto de software
 * lento), usa CPU/WASM. Resultado cacheado.
 */
export function detectBestBackend(): "GPU" | "CPU" {
  if (cachedBackend) return cachedBackend;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: true, // evita GPU emulada por software
    }) as WebGL2RenderingContext | null;
    if (gl) {
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = debug
        ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
        : "";
      // Renderizadores por software (swiftshader/llvmpipe) são lentos → CPU.
      const software = /swiftshader|software|llvmpipe|basic render/i.test(
        renderer,
      );
      cachedBackend = software ? "CPU" : "GPU";
    } else {
      cachedBackend = "CPU";
    }
  } catch {
    cachedBackend = "CPU";
  }
  return cachedBackend;
}

/**
 * Cria um task do MediaPipe no melhor backend detectado, com fallback para
 * CPU/WASM se o delegate GPU falhar. Só tenta GPU quando o WebGL2 real está
 * disponível — evita a tentativa lenta de GPU em quem não suporta.
 */
export async function createWithDelegateFallback<T>(
  create: (delegate: "GPU" | "CPU") => Promise<T>,
  preferGpu: boolean,
): Promise<T> {
  const backend = detectBestBackend();
  if (preferGpu && backend === "GPU") {
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
