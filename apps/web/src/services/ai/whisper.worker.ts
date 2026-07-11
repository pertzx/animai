/**
 * Local speech-to-text worker (prd.txt §3.2).
 *
 * Runs Whisper (ONNX via transformers.js) fully in the browser inside a
 * Web Worker so transcription never blocks the UI and no audio ever leaves
 * the user's machine. Input: 16 kHz mono Float32Array PCM.
 */

/// <reference lib="webworker" />

import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

// Models are fetched from the HuggingFace hub and cached by the browser.
env.allowLocalModels = false;

const MODEL_ID = "onnx-community/whisper-tiny";

export interface WhisperRequest {
  id: string;
  /** 16 kHz mono PCM */
  audio: Float32Array;
  language?: string;
}

export type WhisperResponse =
  | { id: string; type: "progress"; status: string; progress?: number }
  | {
      id: string;
      type: "result";
      segments: Array<{ start: number; end: number; text: string }>;
      language?: string;
    }
  | { id: string; type: "error"; message: string };

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null =
  null;

function getTranscriber(
  onProgress: (status: string, progress?: number) => void,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: "q8",
      progress_callback: (info: unknown) => {
        const p = info as { status?: string; progress?: number };
        if (p.status) onProgress(p.status, p.progress);
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  return transcriberPromise;
}

self.onmessage = async (event: MessageEvent<WhisperRequest>) => {
  const { id, audio, language } = event.data;
  const post = (msg: WhisperResponse) => self.postMessage(msg);

  try {
    const transcriber = await getTranscriber((status, progress) =>
      post({ id, type: "progress", status, progress }),
    );

    post({ id, type: "progress", status: "transcribing" });

    const output = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      ...(language ? { language } : {}),
      task: "transcribe",
    });

    const result = Array.isArray(output) ? output[0] : output;
    const chunks =
      (result as {
        chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
      }).chunks ?? [];

    const segments = chunks
      .map((c) => ({
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? c.timestamp[0] ?? 0,
        text: c.text.trim(),
      }))
      .filter((s) => s.text.length > 0);

    // Fallback: no chunk timestamps, use full text as one segment.
    if (segments.length === 0 && result.text?.trim()) {
      segments.push({
        start: 0,
        end: audio.length / 16000,
        text: result.text.trim(),
      });
    }

    post({ id, type: "result", segments, language });
  } catch (err) {
    post({
      id,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
