/**
 * Extração de frames do vídeo na FPS/resolução de análise (prompt.txt →
 * Performance). Usa um <video> + createImageBitmap para gerar frames
 * reduzidos, um a um, sem carregar o vídeo inteiro na memória.
 */

import type { AnalyzerFrame } from "./types";

export interface FrameSourceOptions {
  fps: number;
  /** Lado maior alvo, em pixels. */
  resolution: number;
  durationSec: number;
  signal: AbortSignal;
}

const SEEK_TIMEOUT_MS = 8000;

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`seek para ${time.toFixed(2)}s expirou`)),
      SEEK_TIMEOUT_MS,
    );
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

/**
 * Gera frames do vídeo em tempos uniformes. Async generator para permitir
 * processamento streaming (um frame por vez) e abortar no meio.
 */
export async function* extractFrames(
  blob: Blob,
  options: FrameSourceOptions,
): AsyncGenerator<AnalyzerFrame> {
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
      video.onerror = () =>
        reject(new Error("formato de vídeo não suportado pelo navegador"));
      video.src = url;
    });

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : options.durationSec;
    const srcW = video.videoWidth || options.resolution;
    const srcH = video.videoHeight || options.resolution;
    const scale = Math.min(1, options.resolution / Math.max(srcW, srcH));
    const width = Math.max(2, Math.round(srcW * scale));
    const height = Math.max(2, Math.round(srcH * scale));

    const step = 1 / Math.max(0.1, options.fps);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2D indisponível");

    let index = 0;
    for (let t = 0; t < duration; t += step) {
      if (options.signal.aborted) return;
      try {
        await seek(video, Math.min(t, duration - 0.01));
      } catch {
        continue;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const bitmap = await createImageBitmap(canvas);
      yield { time: Math.round(t * 100) / 100, bitmap, width, height, index };
      index++;
    }
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Número total de frames que serão extraídos (para a barra de progresso). */
export function estimateFrameCount(durationSec: number, fps: number): number {
  return Math.max(1, Math.floor(durationSec * Math.max(0.1, fps)));
}
