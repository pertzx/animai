/**
 * Semantic Analyzer Lab (prompt.txt) — área do admin para testar e configurar
 * o Semantic Media Analyzer: upload de vídeo, análise em tempo real, preview
 * com overlays (bounding boxes, landmarks, skeleton, textos), feed de eventos
 * ao vivo, timeline semântica e configuração de performance/precisão/features.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, Square, Upload, X } from "lucide-react";
import { analyzeMedia } from "../../services/semantic/orchestrator";
import { detectBestBackend } from "../../services/semantic/plugins/mediapipe";
import { decodeBlobAudio } from "../../services/semantic/audio-decode";
import { drawOverlay } from "./overlay-draw";
import {
  ALL_ANALYZERS,
  getAnalyzerConfig,
  saveAnalyzerConfig,
} from "../../services/semantic/config";
import type {
  AnalyzerConfig,
  AnalyzerId,
  DetectorStatus,
  SemanticEvent,
  SemanticTimeline,
} from "../../services/semantic/types";

const ANALYZER_LABELS: Record<AnalyzerId, string> = {
  speech: "Fala (STT)",
  ocr: "Texto na tela (OCR)",
  scene: "Cenas",
  object: "Objetos",
  tracker: "Rastreamento (IDs)",
  face: "Rosto",
  expression: "Expressões",
  pose: "Pose",
  hands: "Mãos e gestos",
  audio: "Eventos de áudio",
  music: "Música",
  environment: "Ambiente",
};

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
}

/** Descrição curta de um evento para o readout do frame. */
function describeFrameEvent(e: SemanticEvent): string {
  const m = e.metadata;
  if (e.type === "object" || e.type === "object_raw")
    return `${m.label ?? m.rawLabel ?? "objeto"}${m.trackId ? ` #${m.trackId}` : ""}`;
  if (e.type.startsWith("face_"))
    return e.type.replace("face_", "").replace("_", " ");
  if (e.type === "face_raw" || e.type === "face") return "rosto";
  if (e.type === "pose_raw" || e.type === "pose") return `pose: ${m.pose}`;
  if (e.type === "gesture") return `gesto: ${m.gesture}`;
  if (e.type === "onscreen_text_raw" || e.type === "onscreen_text")
    return `texto: "${String(m.text ?? "").slice(0, 24)}"`;
  if (e.type === "scene_cut") return "corte de cena";
  if (e.type === "scene_fade") return "fade";
  if (
    e.type === "environment_raw" ||
    e.type === "environment" ||
    e.type === "environment_frame"
  )
    return `ambiente: ${m.scene}${m.openOrClosed ? ` (${m.openOrClosed})` : ""}`;
  return e.type;
}

export const SemanticLab: React.FC = () => {
  const [config, setConfig] = useState<AnalyzerConfig>(() => getAnalyzerConfig());
  const [detectedBackend] = useState(() => detectBestBackend());
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [isImage, setIsImage] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [liveEvents, setLiveEvents] = useState<SemanticEvent[]>([]);
  const [timeline, setTimeline] = useState<SemanticTimeline | null>(null);
  const [detectorStatus, setDetectorStatus] = useState<DetectorStatus[]>([]);
  const [frameEvents, setFrameEvents] = useState<SemanticEvent[]>([]);
  const [frameTime, setFrameTime] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<SemanticEvent[]>([]);

  const patchConfig = (patch: Partial<AnalyzerConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveAnalyzerConfig(next);
  };

  const toggleAnalyzer = (id: AnalyzerId) => {
    patchConfig({ enabled: { ...config.enabled, [id]: !config.enabled[id] } });
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setBlob(file);
    setIsImage(file.type.startsWith("image/"));
    setVideoUrl(URL.createObjectURL(file));
    setTimeline(null);
    setLiveEvents([]);
    setDetectorStatus([]);
    setFrameEvents([]);
  };

  const run = useCallback(async () => {
    if (!blob) return;
    const video = videoRef.current;
    // Imagem: duração fictícia de 1s (a mesma lógica de frame vale — 1 frame).
    const duration = isImage
      ? 1
      : video?.duration && Number.isFinite(video.duration)
        ? video.duration
        : 0;
    if (!duration) return;

    setRunning(true);
    setProgress(0);
    setLiveEvents([]);
    setDetectorStatus([]);
    setFrameEvents([]);
    feedRef.current = [];
    const controller = new AbortController();
    abortRef.current = controller;

    setStage(isImage ? "Preparando" : "Decodificando áudio");
    const audioPcm = isImage ? null : await decodeBlobAudio(blob);

    try {
      const result = await analyzeMedia({
        blob,
        durationSec: duration,
        config,
        audioPcm,
        signal: controller.signal,
        onProgress: (f, s) => {
          setProgress(f);
          setStage(s);
        },
        onDetectorStatus: (statuses) => setDetectorStatus(statuses),
        onFrame: (frame, events) => {
          // Sincroniza o preview (vídeo) com o frame analisado.
          if (!isImage && video) video.currentTime = frame.time;
          setFrameTime(frame.time);
          setFrameEvents(events);
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) drawOverlay(ctx, canvas.width, canvas.height, events);
          }
        },
        onEvents: (events) => {
          feedRef.current = [...feedRef.current, ...events].slice(-200);
          setLiveEvents(feedRef.current);
        },
      });
      setTimeline(result);
    } catch {
      /* abortado */
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [blob, config, isImage]);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
      {/* Coluna principal: preview + timeline */}
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-lg border border-border bg-black">
          {videoUrl && isImage ? (
            <>
              <img
                ref={imgRef}
                src={videoUrl}
                alt="teste"
                className="w-full"
                onLoad={() => {
                  const im = imgRef.current;
                  const c = canvasRef.current;
                  if (im && c) {
                    c.width = im.naturalWidth;
                    c.height = im.naturalHeight;
                  }
                }}
              />
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </>
          ) : videoUrl ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                muted
                playsInline
                className="w-full"
                onLoadedMetadata={() => {
                  const v = videoRef.current;
                  const c = canvasRef.current;
                  if (v && c) {
                    c.width = v.videoWidth;
                    c.height = v.videoHeight;
                  }
                }}
              />
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </>
          ) : (
            <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 text-fg-muted">
              <Upload size={28} />
              <span className="text-sm">Envie um vídeo ou imagem de teste</span>
              <input
                type="file"
                accept="video/*,image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
          )}
        </div>

        {/* Readout do frame atual (o que está sendo detectado agora) */}
        {(running || frameEvents.length > 0) && (
          <div className="rounded-lg border border-border bg-bg-1 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-xs font-medium text-fg">
                Detecções no frame {fmt(frameTime)}
              </h4>
              <span className="text-[10px] text-fg-muted">
                {frameEvents.length} detecções
              </span>
            </div>
            {frameEvents.length === 0 ? (
              <p className="text-[11px] text-fg-muted">
                Nada detectado neste frame.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {frameEvents.map((e, i) => (
                  <span
                    key={i}
                    className="rounded bg-bg-2 px-1.5 py-0.5 text-[11px] text-fg-2"
                    title={JSON.stringify(e.metadata)}
                  >
                    {describeFrameEvent(e)}{" "}
                    <span className="text-fg-muted">
                      {Math.round(e.confidence * 100)}%
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          {videoUrl && (
            <label className="flex cursor-pointer items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-fg-2 hover:border-accent">
              <Upload size={13} /> Trocar mídia
              <input
                type="file"
                accept="video/*,image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
          )}
          {running ? (
            <button
              className="flex items-center gap-1.5 rounded bg-status-error/20 px-4 py-1.5 text-sm text-status-error"
              onClick={stop}
            >
              <Square size={14} /> Parar
            </button>
          ) : (
            <button
              className="flex items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-sm text-accent-fg disabled:opacity-40"
              disabled={!blob}
              onClick={() => void run()}
            >
              <Play size={14} /> Analisar
            </button>
          )}
          {running && (
            <span className="flex items-center gap-2 text-xs text-fg-muted">
              <Loader2 size={12} className="animate-spin" />
              {stage} — {Math.round(progress * 100)}%
            </span>
          )}
        </div>

        {running && (
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {/* Timeline semântica */}
        {timeline && (
          <div className="rounded-lg border border-border bg-bg-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-medium text-fg">
                Timeline Semântica — {timeline.events.length} eventos
              </h4>
              <button
                className="text-xs text-accent hover:underline"
                onClick={() => {
                  const json = JSON.stringify(
                    { events: timeline.events },
                    null,
                    2,
                  );
                  void navigator.clipboard.writeText(json);
                }}
              >
                Copiar JSON
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {Object.entries(timeline.counts).map(([type, n]) => (
                <span
                  key={type}
                  className="rounded-full bg-bg-3 px-2 py-0.5 text-[10px] text-fg-2"
                >
                  {type}: {n}
                </span>
              ))}
            </div>
            <div className="max-h-52 space-y-0.5 overflow-y-auto text-xs">
              {timeline.summary.map((line, i) => (
                <div key={i} className="flex gap-2 text-fg-2">
                  <span className="shrink-0 font-mono text-fg-muted">
                    {line.text.slice(0, 5)}
                  </span>
                  <span>{line.text.slice(6)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Coluna lateral: status + feed ao vivo + config */}
      <div className="space-y-4">
        {/* Status dos detectores — mostra o que carregou e o que falhou */}
        {detectorStatus.length > 0 && (
          <div className="rounded-lg border border-border bg-bg-1 p-3">
            <h4 className="mb-2 text-xs font-medium text-fg">
              Status dos detectores
            </h4>
            <div className="space-y-1">
              {detectorStatus.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-1.5 text-[11px]"
                  title={s.error}
                >
                  {s.ok ? (
                    <Check size={11} className="text-status-success" />
                  ) : (
                    <X size={11} className="text-status-error" />
                  )}
                  <span className="text-fg-2">{s.label}</span>
                  {!s.ok && (
                    <span className="truncate text-fg-muted">
                      — {s.error?.slice(0, 40)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-bg-1 p-3">
          <h4 className="mb-2 text-xs font-medium text-fg">Eventos ao vivo</h4>
          <div className="h-40 space-y-0.5 overflow-y-auto text-[11px]">
            {liveEvents
              .slice()
              .reverse()
              .slice(0, 60)
              .map((e, i) => (
                <div key={i} className="flex items-center gap-1.5 text-fg-2">
                  <span className="font-mono text-fg-muted">{fmt(e.start)}</span>
                  <span className="text-accent">{e.type}</span>
                  {typeof e.metadata.label === "string" && (
                    <span>{e.metadata.label}</span>
                  )}
                  {typeof e.metadata.text === "string" && (
                    <span className="truncate">
                      "{(e.metadata.text as string).slice(0, 20)}"
                    </span>
                  )}
                </div>
              ))}
            {liveEvents.length === 0 && (
              <p className="text-fg-muted">Nenhum evento ainda.</p>
            )}
          </div>
        </div>

        {/* Detectores */}
        <div className="rounded-lg border border-border bg-bg-1 p-3">
          <h4 className="mb-2 text-xs font-medium text-fg">Detectores</h4>
          <div className="space-y-1">
            {ALL_ANALYZERS.map((id) => (
              <label
                key={id}
                className="flex items-center gap-2 text-xs text-fg-2"
              >
                <input
                  type="checkbox"
                  checked={config.enabled[id]}
                  onChange={() => toggleAnalyzer(id)}
                />
                {ANALYZER_LABELS[id]}
              </label>
            ))}
          </div>
        </div>

        {/* Performance */}
        <div className="space-y-2 rounded-lg border border-border bg-bg-1 p-3">
          <h4 className="text-xs font-medium text-fg">Performance</h4>
          <label className="block text-[11px] text-fg-2">
            FPS de análise: {config.performance.analysisFps}
            <input
              type="range"
              min={0.25}
              max={5}
              step={0.25}
              value={config.performance.analysisFps}
              className="w-full"
              onChange={(e) =>
                patchConfig({
                  performance: {
                    ...config.performance,
                    analysisFps: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="block text-[11px] text-fg-2">
            Resolução: {config.performance.analysisResolution}px
            <input
              type="range"
              min={240}
              max={960}
              step={80}
              value={config.performance.analysisResolution}
              className="w-full"
              onChange={(e) =>
                patchConfig({
                  performance: {
                    ...config.performance,
                    analysisResolution: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="block text-[11px] text-fg-2">
            Máx. objetos/frame: {config.performance.maxObjects}
            <input
              type="range"
              min={1}
              max={40}
              value={config.performance.maxObjects}
              className="w-full"
              onChange={(e) =>
                patchConfig({
                  performance: {
                    ...config.performance,
                    maxObjects: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <p className="text-[10px] text-fg-muted">
            Backend:{" "}
            <span className="text-fg-2">
              {detectedBackend === "GPU"
                ? "GPU (WebGL2) — detectado automaticamente"
                : "CPU/WASM — detectado automaticamente"}
            </span>
          </p>
        </div>

        {/* Precisão */}
        <div className="rounded-lg border border-border bg-bg-1 p-3">
          <h4 className="mb-1 text-xs font-medium text-fg">Precisão</h4>
          <label className="block text-[11px] text-fg-2">
            Confiança mínima:{" "}
            {Math.round(config.precision.minConfidence * 100)}%
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={config.precision.minConfidence}
              className="w-full"
              onChange={(e) =>
                patchConfig({
                  precision: { minConfidence: Number(e.target.value) },
                })
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
};
