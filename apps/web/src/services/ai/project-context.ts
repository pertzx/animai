/**
 * Global project JSON for the AI agent (prd.txt §3.1).
 *
 * Builds a compact, fully serializable snapshot of the edited video from the
 * project store. This is the context the AI receives on every call: it strips
 * heavy/binary fields (blobs, waveforms, thumbnails) and keeps everything the
 * model needs to reason about the timeline — clips, effects, transitions,
 * texts, subtitles and the local speech-to-text transcripts.
 */

import type {
  Project,
  Track,
  Clip,
  Transition,
  MediaTranscript,
  MediaInsight,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useSemanticStore } from "../semantic/store";
import { useUIStore } from "../../stores/ui-store";

export const AI_CONTEXT_SCHEMA_VERSION = 1;

export interface AiProjectContext {
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    settings: {
      width: number;
      height: number;
      frameRate: number;
    };
    durationSec: number;
  };
  media: Array<{
    id: string;
    name: string;
    type: "video" | "audio" | "image";
    durationSec: number;
    /** Metadados do arquivo (resolução/fps/codec quando aplicável). */
    file?: {
      width?: number;
      height?: number;
      fps?: number;
      codec?: string;
      sizeMB?: number;
    };
    hasTranscript: boolean;
    /** Análise local embutida: perfil de áudio e texto na tela (OCR). */
    insights?: {
      audio?: {
        bpm?: number;
        silenceRatio: number;
        /** Segmentos de energia mesclados (compactados p/ economizar tokens). */
        energy: Array<{ start: number; end: number; level: string }>;
      };
      onScreenText?: Array<{ time: number; text: string }>;
    };
    /** Timeline semântica disponível (get_semantic_timeline/find_moments). */
    semanticTimeline?: {
      available: boolean;
      counts: Record<string, number>;
    };
  }>;
  tracks: Array<{
    id: string;
    type: Track["type"];
    name: string;
    muted: boolean;
    hidden: boolean;
    clips: AiClipSummary[];
    transitions: Array<{
      id: string;
      type: string;
      durationSec: number;
      clipAId: string;
      clipBId: string;
    }>;
  }>;
  textClips: Array<{
    id: string;
    text: string;
    startSec: number;
    endSec: number;
    animation?: string;
  }>;
  subtitles: Array<{
    id: string;
    text: string;
    startSec: number;
    endSec: number;
  }>;
  transcripts: Array<{
    mediaId: string;
    mediaName: string;
    language?: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }>;
  /**
   * O que o usuário está fazendo AGORA no editor (prompt.txt item 1):
   * seleção, playhead (o que está visível) e últimas ações.
   */
  editorState: {
    playheadSec: number;
    /** Clipes sob o playhead — o frame que o usuário está vendo. */
    clipsAtPlayhead: Array<{ clipId: string; trackId: string; mediaName: string }>;
    selectedClips: AiClipSummary[];
    /** Últimas ações do usuário/IA no projeto, mais recente primeiro. */
    recentActions: Array<{ type: string; target?: string; secondsAgo: number }>;
  };
}

export interface AiClipSummary {
  id: string;
  mediaId: string;
  mediaName: string;
  startSec: number;
  endSec: number;
  inPointSec: number;
  outPointSec: number;
  volume: number;
  speed?: number;
  fade?: { fadeIn: number; fadeOut: number };
  effects: Array<{ id: string; type: string; enabled?: boolean }>;
  keyframeCount: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

const MAX_ENERGY_SEGMENTS = 30;
const MAX_ONSCREEN_TEXTS = 20;

/**
 * Compacta a análise local para viver dentro do contexto sem estourar tokens:
 * limita segmentos de energia (mesclando os mais curtos) e textos de tela.
 */
function summarizeInsight(insight: MediaInsight) {
  let energy =
    insight.audio?.segments.map((s) => ({
      start: round(s.start),
      end: round(s.end),
      level: s.level as string,
    })) ?? [];
  while (energy.length > MAX_ENERGY_SEGMENTS) {
    // Funde o segmento mais curto no vizinho anterior (ou seguinte).
    let shortest = 0;
    for (let i = 1; i < energy.length; i++) {
      if (energy[i].end - energy[i].start < energy[shortest].end - energy[shortest].start) {
        shortest = i;
      }
    }
    if (shortest > 0) {
      energy[shortest - 1] = { ...energy[shortest - 1], end: energy[shortest].end };
    } else {
      energy[1] = { ...energy[1], start: energy[0].start };
    }
    energy = energy.filter((_, i) => i !== shortest);
  }

  const onScreenText = (insight.onScreenText ?? [])
    .slice(0, MAX_ONSCREEN_TEXTS)
    .map((t) => ({ time: round(t.time), text: t.text.slice(0, 120) }));

  return {
    ...(insight.audio
      ? {
          audio: {
            ...(insight.audio.bpm ? { bpm: insight.audio.bpm } : {}),
            silenceRatio: insight.audio.silenceRatio,
            energy,
          },
        }
      : {}),
    ...(onScreenText.length > 0 ? { onScreenText } : {}),
  };
}

function summarizeClip(clip: Clip, mediaName: string): AiClipSummary {
  return {
    id: clip.id,
    mediaId: clip.mediaId,
    mediaName,
    startSec: round(clip.startTime),
    endSec: round(clip.startTime + clip.duration),
    inPointSec: round(clip.inPoint),
    outPointSec: round(clip.outPoint),
    volume: clip.volume,
    ...(clip.speed !== undefined && clip.speed !== 1
      ? { speed: clip.speed }
      : {}),
    ...(clip.fade ? { fade: clip.fade } : {}),
    effects: [...clip.effects, ...clip.audioEffects].map((e) => ({
      id: e.id,
      type: e.type,
      enabled: e.enabled,
    })),
    keyframeCount: clip.keyframes.length,
  };
}

function summarizeTransition(t: Transition) {
  return {
    id: t.id,
    type: t.type as string,
    durationSec: round(t.duration),
    clipAId: t.clipAId,
    clipBId: t.clipBId,
  };
}

export function buildProjectContext(project: Project): AiProjectContext {
  const mediaNameById = new Map<string, string>(
    project.mediaLibrary.items.map((m) => [m.id, m.name]),
  );
  const transcripts = project.transcripts ?? [];
  const transcribedIds = new Set(transcripts.map((t) => t.mediaId));
  const insightById = new Map(
    (project.mediaInsights ?? []).map((i) => [i.mediaId, i]),
  );
  // Timelines semânticas em cache na sessão (contagens por tipo, compacto).
  const semanticTimelines = useSemanticStore.getState().timelines;
  const semanticIds = new Map(
    Object.entries(semanticTimelines).map(([id, t]) => [id, t.counts]),
  );

  return {
    schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
    project: {
      id: project.id,
      name: project.name,
      settings: {
        width: project.settings.width,
        height: project.settings.height,
        frameRate: project.settings.frameRate,
      },
      durationSec: round(project.timeline.duration),
    },
    media: project.mediaLibrary.items.map((m) => {
      const insight = insightById.get(m.id);
      const semantic = semanticIds.get(m.id);
      return {
        id: m.id,
        name: m.name,
        type: m.type,
        durationSec: round(m.metadata.duration),
        file: {
          ...(m.metadata.width ? { width: m.metadata.width } : {}),
          ...(m.metadata.height ? { height: m.metadata.height } : {}),
          ...(m.metadata.frameRate ? { fps: round(m.metadata.frameRate) } : {}),
          ...(m.metadata.codec ? { codec: m.metadata.codec } : {}),
          ...(m.metadata.fileSize
            ? { sizeMB: Math.round(m.metadata.fileSize / 1048576) }
            : {}),
        },
        hasTranscript: transcribedIds.has(m.id),
        ...(insight ? { insights: summarizeInsight(insight) } : {}),
        // Timeline semântica disponível? (objetos, rostos, poses, cenas…)
        ...(semantic
          ? { semanticTimeline: { available: true, counts: semantic } }
          : {}),
      };
    }),
    tracks: project.timeline.tracks.map((track) => ({
      id: track.id,
      type: track.type,
      name: track.name,
      muted: track.muted,
      hidden: track.hidden,
      clips: track.clips.map((c) =>
        summarizeClip(c, mediaNameById.get(c.mediaId) ?? "unknown"),
      ),
      transitions: track.transitions.map(summarizeTransition),
    })),
    textClips: (project.textClips ?? []).map((t) => ({
      id: t.id,
      text: t.text,
      startSec: round(t.startTime),
      endSec: round(t.startTime + t.duration),
      animation: t.animation?.preset,
    })),
    subtitles: project.timeline.subtitles.map((s) => ({
      id: s.id,
      text: s.text,
      startSec: round(s.startTime),
      endSec: round(s.endTime),
    })),
    transcripts: transcripts.map((t) => ({
      mediaId: t.mediaId,
      mediaName: mediaNameById.get(t.mediaId) ?? "unknown",
      language: t.language,
      segments: t.segments.map((s) => ({
        start: round(s.start),
        end: round(s.end),
        text: s.text,
      })),
    })),
    editorState: buildEditorState(project, mediaNameById),
  };
}

function buildEditorState(
  project: Project,
  mediaNameById: Map<string, string>,
): AiProjectContext["editorState"] {
  const playheadSec = useTimelineStore.getState().playheadPosition;
  const selectedIds = new Set(useUIStore.getState().getSelectedClipIds());
  const now = Date.now();

  const clipsAtPlayhead: AiProjectContext["editorState"]["clipsAtPlayhead"] =
    [];
  const selectedClips: AiClipSummary[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (
        playheadSec >= clip.startTime &&
        playheadSec < clip.startTime + clip.duration
      ) {
        clipsAtPlayhead.push({
          clipId: clip.id,
          trackId: track.id,
          mediaName: mediaNameById.get(clip.mediaId) ?? "unknown",
        });
      }
      if (selectedIds.has(clip.id)) {
        selectedClips.push(
          summarizeClip(clip, mediaNameById.get(clip.mediaId) ?? "unknown"),
        );
      }
    }
  }

  const history = useProjectStore.getState().actionHistory.getHistory();
  const recentActions = history
    .slice(-10)
    .reverse()
    .map((action) => ({
      type: action.type,
      target:
        (action.params?.clipId as string | undefined) ??
        (action.params?.trackId as string | undefined) ??
        (action.params?.mediaId as string | undefined),
      secondsAgo: Math.round((now - action.timestamp) / 1000),
    }));

  return { playheadSec: round(playheadSec), clipsAtPlayhead, selectedClips, recentActions };
}

/** Snapshot of the current project as the AI context JSON. */
export function getCurrentProjectContext(): AiProjectContext {
  return buildProjectContext(useProjectStore.getState().project);
}

/**
 * Store a media transcript inside the project (global JSON), replacing any
 * previous transcript for the same media. Auto-save persists it with the
 * rest of the project.
 */
/**
 * Store locally-computed media insights (audio profile + on-screen text)
 * inside the project's global JSON.
 */
export function setProjectInsight(insight: MediaInsight): void {
  useProjectStore.setState((state) => ({
    project: {
      ...state.project,
      modifiedAt: Date.now(),
      mediaInsights: [
        ...(state.project.mediaInsights ?? []).filter(
          (i) => i.mediaId !== insight.mediaId,
        ),
        insight,
      ],
    },
  }));
}

export function setProjectTranscript(transcript: MediaTranscript): void {
  useProjectStore.setState((state) => ({
    project: {
      ...state.project,
      modifiedAt: Date.now(),
      transcripts: [
        ...(state.project.transcripts ?? []).filter(
          (t) => t.mediaId !== transcript.mediaId,
        ),
        transcript,
      ],
    },
  }));
}
