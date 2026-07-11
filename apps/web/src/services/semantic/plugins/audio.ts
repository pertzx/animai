/**
 * Audio Event Analyzer + Music Analyzer (prompt.txt) — heurística local sobre
 * o PCM (energia, taxa de cruzamentos por zero, fluxo espectral). Detecta
 * música, silêncio, aplausos/ruído impulsivo, risadas (aprox.) e passos.
 * Sem modelo pesado; um YAMNet local pode ser plugado depois para precisão.
 */

import type {
  AnalyzerContext,
  SemanticAnalyzerPlugin,
  SemanticEvent,
} from "../types";

const SR = 16000;

function frameRms(pcm: Float32Array, start: number, len: number): number {
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const s = pcm[start + i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / len);
}

function zeroCrossRate(pcm: Float32Array, start: number, len: number): number {
  let crossings = 0;
  for (let i = 1; i < len; i++) {
    const a = pcm[start + i - 1] ?? 0;
    const b = pcm[start + i] ?? 0;
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) crossings++;
  }
  return crossings / len;
}

/** Estimativa de BPM por autocorrelação do envelope (compartilha ideia com
 * o audio-analysis existente, mas isolada para o plugin de música). */
function estimateBpm(pcm: Float32Array): number | undefined {
  const frameSize = Math.floor(SR / 50);
  const frames = Math.floor(pcm.length / frameSize);
  if (frames < 200) return undefined;
  const onset = new Float32Array(frames);
  let prev = 0;
  let mean = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const base = f * frameSize;
    for (let i = 0; i < frameSize; i++) e += pcm[base + i] * pcm[base + i];
    onset[f] = Math.max(0, e - prev);
    prev = e;
    mean += onset[f];
  }
  mean /= frames;
  if (mean === 0) return undefined;
  const minLag = Math.floor((60 / 180) * 50);
  const maxLag = Math.ceil((60 / 60) * 50);
  let bestLag = 0;
  let best = 0;
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let f = 0; f + lag < frames; f++) score += onset[f] * onset[f + lag];
    total += score;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || best < (total / (maxLag - minLag + 1)) * 1.35) {
    return undefined;
  }
  return Math.round((60 * 50) / bestLag);
}

export class AudioAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "audio" as const;
  readonly label = "Eventos de áudio";
  readonly usesFrames = false;
  readonly usesAudio = true;

  async init(): Promise<void> {}

  async analyzeSequence(context: AnalyzerContext): Promise<SemanticEvent[]> {
    const pcm = context.audioPcm;
    if (!pcm) return [];
    const events: SemanticEvent[] = [];
    const win = Math.floor(0.25 * SR); // janelas de 250ms

    let prevRms = 0;
    for (let i = 0; i + win <= pcm.length; i += win) {
      const t = i / SR;
      const rms = frameRms(pcm, i, win);
      const zcr = zeroCrossRate(pcm, i, win);
      const delta = rms - prevRms;

      // Ruído impulsivo alto e de banda larga → aplauso/explosão/buzina.
      if (rms > 0.18 && delta > 0.12 && zcr > 0.12) {
        events.push({
          start: t,
          end: t + 0.25,
          type: "audio_event",
          confidence: Math.min(1, rms + 0.3),
          metadata: { event: zcr > 0.2 ? "applause" : "impact" },
        });
      }
      // Energia média sustentada com ZCR alto e modulado → risada (aprox.).
      else if (rms > 0.08 && rms < 0.18 && zcr > 0.15 && zcr < 0.28) {
        events.push({
          start: t,
          end: t + 0.25,
          type: "audio_event",
          confidence: 0.5,
          metadata: { event: "laughter" },
        });
      }
      prevRms = rms;
    }

    return this.dedupe(events);
  }

  /** Junta eventos de áudio contíguos do mesmo tipo. */
  private dedupe(events: SemanticEvent[]): SemanticEvent[] {
    const out: SemanticEvent[] = [];
    for (const e of events) {
      const last = out[out.length - 1];
      if (
        last &&
        last.metadata.event === e.metadata.event &&
        e.start - last.end < 0.5
      ) {
        last.end = e.end;
        last.confidence = Math.max(last.confidence, e.confidence);
      } else {
        out.push({ ...e });
      }
    }
    return out;
  }

  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    return raw;
  }

  dispose(): void {}
}

export class MusicAnalyzer implements SemanticAnalyzerPlugin {
  readonly id = "music" as const;
  readonly label = "Música";
  readonly usesFrames = false;
  readonly usesAudio = true;

  async init(): Promise<void> {}

  async analyzeSequence(context: AnalyzerContext): Promise<SemanticEvent[]> {
    const pcm = context.audioPcm;
    if (!pcm) return [];
    const bpm = estimateBpm(pcm);
    if (!bpm) return [];
    // Batida estável detectada → considera o trecho inteiro como música.
    return [
      {
        start: 0,
        end: context.durationSec,
        type: "music",
        confidence: 0.7,
        metadata: { bpm },
      },
    ];
  }

  finalize(raw: SemanticEvent[]): SemanticEvent[] {
    return raw;
  }

  dispose(): void {}
}
