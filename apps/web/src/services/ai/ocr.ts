/**
 * OCR local de texto embutido no vídeo (legendas queimadas, títulos, placas),
 * via tesseract.js — zero tokens: roda na máquina e vira texto compacto com
 * timestamps que o agente lê sob demanda.
 */

import type { OnScreenTextSegment } from "@openreel/core";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";

const MAX_FRAMES = 10;
const TARGET_WIDTH = 960;
const MIN_CONFIDENCE = 40;
const SEEK_TIMEOUT_MS = 8000;

let workerPromise: Promise<TesseractWorker> | null = null;

function getOcrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker(["por", "eng"]).catch((err) => {
      // Permite nova tentativa depois (ex.: rede caiu no download do modelo).
      workerPromise = null;
      throw err instanceof Error
        ? err
        : new Error(`falha ao iniciar OCR: ${String(err)}`);
    });
  }
  return workerPromise;
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`seek para ${time.toFixed(1)}s expirou`)),
      SEEK_TIMEOUT_MS,
    );
    video.onseeked = () => {
      clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      clearTimeout(timer);
      reject(new Error("erro ao decodificar vídeo durante seek"));
    };
    video.currentTime = time;
  });
}

/** Amostra frames do vídeo em tempos uniformes e desenha num canvas reduzido. */
async function sampleFrames(
  blob: Blob,
  durationSec: number,
): Promise<Array<{ time: number; canvas: HTMLCanvasElement }>> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("metadados do vídeo não carregaram")),
        SEEK_TIMEOUT_MS,
      );
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("formato de vídeo não suportado pelo navegador"));
      };
      video.src = url;
    });

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : durationSec;
    const frameCount = Math.min(
      MAX_FRAMES,
      Math.max(3, Math.floor(duration / 3)),
    );
    const scale = TARGET_WIDTH / (video.videoWidth || TARGET_WIDTH);
    const width = TARGET_WIDTH;
    const height = Math.round((video.videoHeight || 540) * scale);

    const frames: Array<{ time: number; canvas: HTMLCanvasElement }> = [];
    for (let i = 0; i < frameCount; i++) {
      // Evita 0s e o último instante (frames pretos/transições).
      const time = ((i + 0.5) / frameCount) * duration;
      try {
        await seekTo(video, time);
      } catch (err) {
        console.warn("[animai-ocr] frame ignorado:", err);
        continue;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
      frames.push({ time: Math.round(time * 10) / 10, canvas });
    }
    if (frames.length === 0) {
      throw new Error("nenhum frame pôde ser extraído do vídeo");
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function cleanText(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && /[\p{L}\p{N}]{2,}/u.test(l))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function extractOnScreenText(
  blob: Blob,
  durationSec: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OnScreenTextSegment[]> {
  const frames = await sampleFrames(blob, durationSec);
  const worker = await getOcrWorker();

  const segments: OnScreenTextSegment[] = [];
  let previous = "";
  for (let i = 0; i < frames.length; i++) {
    const { time, canvas } = frames[i];
    const { data } = await worker.recognize(canvas);
    onProgress?.(i + 1, frames.length);
    const text = cleanText(data.text ?? "");
    console.info(
      `[animai-ocr] ${time}s conf=${Math.round(data.confidence ?? 0)} texto="${text.slice(0, 80)}"`,
    );
    if ((data.confidence ?? 0) < MIN_CONFIDENCE) continue;
    if (!text || text === previous) continue;
    previous = text;
    segments.push({ time, text });
  }
  return segments;
}
