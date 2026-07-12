/**
 * Extração de frames do vídeo na FPS/resolução de análise (prompt.txt →
 * Performance).
 *
 * Opt 1: quando o navegador suporta requestVideoFrameCallback (Chromium —
 * Desktop Web/WebView e Android WebView), decodifica SEQUENCIALMENTE tocando o
 * vídeo e capturando frames conforme eles saem do decodificador. Isso evita o
 * `seek` por frame, que em HDD é lento (cada seek esvazia o pipeline de
 * decode). Fallback para o modo antigo (seek) onde rVFC não existe.
 *
 * Em ambos os casos, entrega o canvas reduzido direto aos modelos (Opt 7) —
 * um único canvas reutilizado, sem createImageBitmap por frame.
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
/** Timeout por amostra no modo sequencial (HDD lento ainda deve caber). */
const SAMPLE_TIMEOUT_MS = 15000;
/**
 * Acelera a decodificação sequencial. O áudio fica mudo; frames podem ser
 * descartados pelo navegador, mas a amostragem é esparsa, então a granularidade
 * continua boa. Não usar valores extremos: alguns navegadores limitam >16.
 */
const SEQ_PLAYBACK_RATE = 4;

interface LoadedVideo {
  video: HTMLVideoElement;
  url: string;
  width: number;
  height: number;
  duration: number;
  cleanup: () => void;
}

/** rVFC existe? (tipo não está em lib.dom padrão em todo TS.) */
function hasVideoFrameCallback(video: HTMLVideoElement): boolean {
  return typeof (
    video as unknown as { requestVideoFrameCallback?: unknown }
  ).requestVideoFrameCallback === "function";
}

type FrameMeta = { mediaTime: number };
type RVFC = (
  cb: (now: number, meta: FrameMeta) => void,
) => number;

function requestVideoFrame(
  video: HTMLVideoElement,
  cb: (now: number, meta: FrameMeta) => void,
): void {
  (video as unknown as { requestVideoFrameCallback: RVFC }).requestVideoFrameCallback(
    cb,
  );
}

async function loadVideo(
  blob: Blob,
  options: FrameSourceOptions,
): Promise<LoadedVideo> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

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

  const cleanup = () => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };

  return { video, url, width, height, duration, cleanup };
}

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
 * Gera frames do vídeo em tempos uniformes. Async generator: processa em
 * streaming (um frame por vez) e aborta no meio.
 */
export async function* extractFrames(
  blob: Blob,
  options: FrameSourceOptions,
): AsyncGenerator<AnalyzerFrame> {
  // Imagens: um único frame em t=0.
  if (blob.type.startsWith("image/")) {
    const source = await createImageBitmap(blob);
    const scale = Math.min(
      1,
      options.resolution / Math.max(source.width, source.height),
    );
    const width = Math.max(2, Math.round(source.width * scale));
    const height = Math.max(2, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
    source.close();
    yield { time: 0, image: canvas, width, height, index: 0 };
    return;
  }

  const loaded = await loadVideo(blob, options);
  try {
    if (hasVideoFrameCallback(loaded.video)) {
      yield* sequentialFrames(loaded, options);
    } else {
      yield* seekFrames(loaded, options);
    }
  } finally {
    loaded.cleanup();
  }
}

/**
 * Modo sequencial (Opt 1): toca o vídeo e captura no primeiro frame que cruza
 * cada ponto de amostragem. Pausa após capturar (backpressure) — o consumidor
 * roda a inferência enquanto o vídeo está parado, sem perder amostras — e
 * retoma na próxima chamada, sempre para frente (sem seek).
 */
async function* sequentialFrames(
  loaded: LoadedVideo,
  options: FrameSourceOptions,
): AsyncGenerator<AnalyzerFrame> {
  const { video, width, height, duration } = loaded;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2D indisponível");

  const step = 1 / Math.max(0.1, options.fps);
  video.playbackRate = SEQ_PLAYBACK_RATE;
  let nextSample = 0;
  let index = 0;
  let ended = false;

  // Espera o próximo frame que cruza `nextSample`, desenha no canvas e pausa.
  const waitForSample = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (captured: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.onended = null;
        resolve(captured);
      };
      const timer = setTimeout(() => finish(false), SAMPLE_TIMEOUT_MS);

      const onFrame = (_now: number, meta: FrameMeta) => {
        if (options.signal.aborted) {
          finish(false);
          return;
        }
        const t = meta.mediaTime;
        if (t + 1e-3 >= nextSample) {
          ctx.drawImage(video, 0, 0, width, height);
          video.pause();
          // Avança o alvo para além do tempo atual (pode ter pulado frames).
          while (nextSample <= t) nextSample += step;
          finish(true);
          return;
        }
        requestVideoFrame(video, onFrame);
      };

      video.onended = () => {
        ended = true;
        finish(false);
      };
      requestVideoFrame(video, onFrame);
      void video.play().catch(() => finish(false));
    });

  while (nextSample < duration && !ended) {
    if (options.signal.aborted) return;
    const capturedTime = nextSample; // tempo-alvo antes de avançar
    const ok = await waitForSample();
    if (!ok) break;
    yield {
      time: Math.round(capturedTime * 100) / 100,
      image: canvas,
      width,
      height,
      index: index++,
    };
  }
}

/**
 * Modo antigo (fallback): seek por frame. Mantido para navegadores sem rVFC.
 */
async function* seekFrames(
  loaded: LoadedVideo,
  options: FrameSourceOptions,
): AsyncGenerator<AnalyzerFrame> {
  const { video, width, height, duration } = loaded;
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
    yield { time: Math.round(t * 100) / 100, image: canvas, width, height, index };
    index++;
  }
}

/** Número total de frames que serão extraídos (para a barra de progresso). */
export function estimateFrameCount(durationSec: number, fps: number): number {
  return Math.max(1, Math.floor(durationSec * Math.max(0.1, fps)));
}
