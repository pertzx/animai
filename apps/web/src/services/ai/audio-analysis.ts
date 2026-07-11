/**
 * Análise local de áudio (sem IA, zero tokens): perfil de energia por trecho,
 * proporção de silêncio e estimativa de BPM por autocorrelação do envelope de
 * onsets. Dá contexto ao agente mesmo quando não há fala para transcrever
 * (música, ruído ambiente, trechos parados).
 */

import type { AudioEnergySegment, AudioInsight } from "@openreel/core";

// Igual a ANALYSIS_SAMPLE_RATE de decode-audio.ts; duplicado para manter este
// módulo puro (sem dependência de stores), o que permite testá-lo isolado.
const ANALYSIS_SAMPLE_RATE = 16000;

const WINDOW_SEC = 0.5;
const SILENCE_RMS = 0.008;
const LOW_RMS = 0.04;
const HIGH_RMS = 0.15;

function levelFor(rms: number): AudioEnergySegment["level"] {
  if (rms < SILENCE_RMS) return "silence";
  if (rms < LOW_RMS) return "low";
  if (rms < HIGH_RMS) return "medium";
  return "high";
}

/** RMS por janela de 0,5s, depois mescla janelas vizinhas do mesmo nível. */
function energySegments(pcm: Float32Array): {
  segments: AudioEnergySegment[];
  silenceRatio: number;
} {
  const windowSize = Math.floor(WINDOW_SEC * ANALYSIS_SAMPLE_RATE);
  const windows = Math.max(1, Math.floor(pcm.length / windowSize));
  const levels: AudioEnergySegment["level"][] = [];
  let silentWindows = 0;

  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const startIndex = w * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const sample = pcm[startIndex + i] ?? 0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / windowSize);
    const level = levelFor(rms);
    if (level === "silence") silentWindows++;
    levels.push(level);
  }

  const segments: AudioEnergySegment[] = [];
  for (let w = 0; w < levels.length; w++) {
    const last = segments[segments.length - 1];
    const end = Math.round((w + 1) * WINDOW_SEC * 10) / 10;
    if (last && last.level === levels[w]) {
      segments[segments.length - 1] = { ...last, end };
    } else {
      segments.push({
        start: Math.round(w * WINDOW_SEC * 10) / 10,
        end,
        level: levels[w],
      });
    }
  }

  return { segments, silenceRatio: silentWindows / windows };
}

/**
 * BPM por autocorrelação do fluxo de energia (60–180 BPM). Retorna undefined
 * quando não há batida estável (fala pura, ambiente).
 */
function estimateBpm(pcm: Float32Array): number | undefined {
  // Envelope de onsets a 50 Hz: diferença positiva de energia entre frames.
  const frameSize = Math.floor(ANALYSIS_SAMPLE_RATE / 50);
  const frames = Math.floor(pcm.length / frameSize);
  if (frames < 200) return undefined; // < ~4s de áudio

  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * frameSize;
    for (let i = 0; i < frameSize; i++) sum += pcm[base + i] * pcm[base + i];
    energy[f] = sum;
  }
  const onset = new Float32Array(frames);
  let onsetMean = 0;
  for (let f = 1; f < frames; f++) {
    onset[f] = Math.max(0, energy[f] - energy[f - 1]);
    onsetMean += onset[f];
  }
  onsetMean /= frames;
  if (onsetMean === 0) return undefined;

  // Autocorrelação nos lags correspondentes a 180→60 BPM (50 fps → lag em frames).
  const minLag = Math.floor((60 / 180) * 50);
  const maxLag = Math.ceil((60 / 60) * 50);
  let bestLag = 0;
  let bestScore = 0;
  let totalScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let f = 0; f + lag < frames; f++) score += onset[f] * onset[f + lag];
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return undefined;
  // Exige um pico razoavelmente dominante para não inventar BPM em fala.
  const average = totalScore / (maxLag - minLag + 1);
  if (bestScore < average * 1.35) return undefined;

  return Math.round((60 * 50) / bestLag);
}

export function analyzeAudio(pcm: Float32Array): AudioInsight {
  const { segments, silenceRatio } = energySegments(pcm);
  const bpm = estimateBpm(pcm);
  return {
    durationSec: Math.round((pcm.length / ANALYSIS_SAMPLE_RATE) * 10) / 10,
    ...(bpm ? { bpm } : {}),
    silenceRatio: Math.round(silenceRatio * 100) / 100,
    segments,
  };
}
