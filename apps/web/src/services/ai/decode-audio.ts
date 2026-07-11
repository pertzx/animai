/**
 * Decodifica o áudio de uma mídia (blob/fileHandle) para PCM mono 16 kHz —
 * formato usado tanto pelo Whisper (STT) quanto pela análise de áudio local.
 */

import { useProjectStore } from "../../stores/project-store";

export const ANALYSIS_SAMPLE_RATE = 16000;

export async function decodeMediaAudio(
  mediaId: string,
): Promise<Float32Array | null> {
  const item = useProjectStore
    .getState()
    .project.mediaLibrary.items.find((m) => m.id === mediaId);
  if (!item) return null;

  let blob = item.blob;
  if (!blob && item.fileHandle) {
    blob = await item.fileHandle.getFile();
  }
  if (!blob) return null;

  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close();
  }

  const targetLength = Math.ceil(decoded.duration * ANALYSIS_SAMPLE_RATE);
  const offline = new OfflineAudioContext(
    1,
    targetLength,
    ANALYSIS_SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
