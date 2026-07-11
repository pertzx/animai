import type { Timeline } from "./timeline";
import type { TextClip } from "../text/types";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly mediaLibrary: MediaLibrary;
  readonly timeline: Timeline;
  readonly textClips?: TextClip[];
  readonly shapeClips?: ShapeClip[];
  readonly svgClips?: SVGClip[];
  readonly stickerClips?: StickerClip[];
  /** Local speech-to-text transcripts per media item (AnimAI, prd.txt §3.2) */
  readonly transcripts?: MediaTranscript[];
  /** Local media analysis (audio profile + on-screen text OCR) per media item (AnimAI) */
  readonly mediaInsights?: MediaInsight[];
}

/** Locally-computed understanding of a media item beyond speech. */
export interface MediaInsight {
  readonly mediaId: string;
  readonly generatedAt: number;
  readonly audio?: AudioInsight;
  readonly onScreenText?: OnScreenTextSegment[];
}

export interface AudioInsight {
  readonly durationSec: number;
  /** Estimated tempo, when a stable beat is detected. */
  readonly bpm?: number;
  /** 0..1 — fraction of the audio that is (near) silence. */
  readonly silenceRatio: number;
  /** Coarse energy timeline, merged into segments. */
  readonly segments: AudioEnergySegment[];
}

export interface AudioEnergySegment {
  readonly start: number;
  readonly end: number;
  readonly level: "silence" | "low" | "medium" | "high";
}

/** Text visible on video frames (burned-in captions, titles, signs). */
export interface OnScreenTextSegment {
  readonly time: number;
  readonly text: string;
}

/** Transcript of a media item's audio, produced by the local STT engine */
export interface MediaTranscript {
  readonly mediaId: string;
  readonly language?: string;
  readonly generatedAt: number;
  readonly segments: MediaTranscriptSegment[];
}

export interface MediaTranscriptSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface MediaLibrary {
  readonly items: MediaItem[];
}

export interface MediaItem {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio" | "image";
  readonly fileHandle: FileSystemFileHandle | null;
  readonly blob: Blob | null;
  readonly metadata: MediaMetadata;
  readonly thumbnailUrl: string | null;
  readonly waveformData: Float32Array | null;
  readonly filmstripThumbnails?: FilmstripThumbnail[];
  readonly isPlaceholder?: boolean;
  readonly originalUrl?: string;
  /** File hint stored in JSON for cross-session/cross-machine asset matching */
  readonly sourceFile?: { name: string; size: number; lastModified: number; folder?: string };
  /** True while a background KieAI generation task is in progress */
  readonly isPending?: boolean;
  /** True when polling exhausted all retries — shows manual retry button */
  readonly kieaiError?: boolean;
  /** KieAI task ID used to poll for completion */
  readonly kieaiTaskId?: string;
}

/** Thumbnail for filmstrip display in timeline */
export interface FilmstripThumbnail {
  readonly timestamp: number;
  readonly url: string;
}

export interface MediaMetadata {
  readonly duration: number; // In seconds
  readonly width: number; // For video/image
  readonly height: number; // For video/image
  readonly frameRate: number; // For video
  readonly codec: string;
  readonly sampleRate: number; // For audio
  readonly channels: number; // For audio
  readonly fileSize: number;
  /** Number of audio tracks in the file (may be > 1 for multi-track video/audio files) */
  readonly audioTrackCount?: number;
}
