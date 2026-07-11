/** Decodifica o áudio de um Blob para PCM mono 16 kHz (plugins de áudio/STT). */

const SAMPLE_RATE = 16000;

export async function decodeBlobAudio(
  blob: Blob,
): Promise<Float32Array | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decodeCtx = new AudioContext();
    let decoded: AudioBuffer;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer);
    } finally {
      void decodeCtx.close();
    }
    const targetLength = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, targetLength, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } catch {
    // Vídeo sem trilha de áudio decodificável.
    return null;
  }
}
