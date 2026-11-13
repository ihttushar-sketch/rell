/**
 * NEXUS FRAME — shared domain model.
 *
 * A "Framework DNA" is the portable, serializable fingerprint of an edited
 * reference video: its cut rhythm, shot motion, grade, audio beat grid and
 * retained transition SFX. The same JSON contract is used by
 *   - the browser Studio (this file's consumers),
 *   - the Python production engine (backend/app/schemas.py),
 *   - exported `.json` blueprints in the Production Vault.
 * Keep the two definitions in lock-step.
 */

export const SCHEMA_VERSION = "1.0" as const;

export type MotionType = "static" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "shake" | "handheld";
export type TransitionType = "cut" | "fade" | "whip" | "flash" | "glitch";
export type SfxType = "whoosh" | "riser" | "hit" | "glitch" | "click";
export type PillarId = 1 | 2 | 3 | 4 | 5;
export type EngineMode = "browser" | "server";
export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5";

export interface Grade {
  brightness: number; // -1..1 (0 = untouched)
  contrast: number; // 0..2 (1 = untouched)
  saturation: number; // 0..2 (1 = untouched)
  vignette: number; // 0..1
  temperature: number; // -1..1 (negative = cool/silver)
}

export interface Shot {
  index: number;
  start: number;
  end: number;
  duration: number;
  motion: MotionType;
  motion_energy: number; // 0..1
  sharpness: number; // 0..1
  transition: TransitionType;
  effects: string[];
  pillar: PillarId;
  grade: Grade;
  palette: string[]; // hex
  /** Face/subject centre detected by the vision node (auto-reframe). */
  focus?: { x: number; y: number; detected?: boolean };
}

export interface PillarBlock {
  pillar: PillarId;
  name: string;
  start: number;
  end: number;
  shot_count: number;
}

export interface AudioDna {
  bpm: number;
  beat_timestamps: number[];
  downbeats: number[];
  lufs: number;
  stems: {
    vocals: string | null;
    bgm: string | null;
    sfx: string | null;
  };
  /** true when stems were approximated (browser-lite analysis, no Demucs). */
  preview_only: boolean;
}

export interface SfxEvent {
  t: number;
  type: SfxType;
  gain: number; // dB
}

export interface FrameworkDna {
  schema_version: typeof SCHEMA_VERSION;
  id: string;
  framework_name: string;
  description?: string;
  tags: string[];
  created_at: string;
  origin: "server" | "browser" | "import";
  source: {
    kind: "upload" | "url" | "template";
    label: string;
    width: number;
    height: number;
    fps: number;
    aspect: AspectRatio;
  };
  duration_sec: number;
  audio: AudioDna;
  shots: Shot[];
  pillars: PillarBlock[];
  rhythm: {
    avg_shot_sec: number;
    cut_density: number; // cuts per second
    phase_ratios: Record<"hook" | "pain" | "trigger" | "comment" | "outro", number>;
  };
  grade: Grade;
  sfx_events: SfxEvent[];
  watermark: WatermarkSpec;
  stats: {
    cuts: number;
    avg_clip_duration: number;
    zoom_ratio: number;
    motion_energy: number;
  };
}

export interface WatermarkSpec {
  text: string;
  position: "top-left";
  x: number;
  y: number;
  color: string;
  opacity: number;
}

export interface OverlayCue {
  kind: "text" | "arrow" | "highlight" | "zoom_punch" | "shake";
  text?: string;
  at: number; // seconds into slot
  duration: number;
}

export interface RenderSlot {
  index: number;
  pillar: PillarId;
  start: number;
  end: number;
  duration: number;
  src_shot: number;
  motion: MotionType;
  zoom_from: number;
  zoom_to: number;
  pan: { x: number; y: number };
  grade: Grade;
  transition: TransitionType;
  /** Active-speaker reframe offset, normalised to half-frame (-1..1). */
  focus: { x: number; y: number };
  overlays: OverlayCue[];
  sfx: SfxEvent[];
}

export interface RenderPlan {
  framework_id: string;
  framework_name: string;
  target_duration_sec: number;
  bpm: number;
  /** Beat grid for the produced duration, in seconds. */
  beat_grid: number[];
  /** Where the BGM loop must crossfade, in seconds. */
  crossfade_points: number[];
  slots: RenderSlot[];
  pillars: PillarBlock[];
  stats: {
    cuts: number;
    effective_bpm: number;
    avg_clip_duration: number;
    density: number;
    snapped_cuts: number;
    loop_count: number;
  };
  audio: {
    mode: "framework" | "custom" | "mute";
    preserve_sfx: boolean;
    lufs: number;
  };
  watermark: WatermarkSpec;
  aspect: AspectRatio;
}

export interface ProduceOptions {
  target_duration_sec: number;
  bg_mode: "framework" | "custom";
  preserve_sfx: boolean;
  aspect?: AspectRatio;
  /** Drop silence-only stretches of raw clips before the smart matcher runs. */
  trim_silence?: boolean;
  /** SFX-only overlay when the user swaps the BGM. */
  watermark_text?: string;
}

export interface Capabilities {
  engine: "server";
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp: boolean;
  opencv: boolean;
  scenedetect: boolean;
  demucs: boolean;
  librosa: boolean;
  hardware_accel: string | null;
  /** Hosted vision provider when configured (gemini/openai). */
  vision?: string | null;
  version: string;
  notes: string[];
}

export interface JobStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  progress: number;
  detail?: string;
}

export interface Job {
  id: string;
  kind: "analyze" | "produce";
  status: "queued" | "running" | "done" | "error";
  progress: number;
  steps: JobStep[];
  logs: string[];
  result?: unknown;
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: "video" | "audio";
  bytes: number;
  duration_sec?: number;
  url: string;
}

export interface ProduceResult {
  job_id: string;
  video_url: string;
  poster_url?: string;
  duration_sec: number;
  width: number;
  height: number;
  bytes: number;
  plan: RenderPlan;
  engine: "ffmpeg" | "browser";
  timeline_preview?: string;
}

export const PILLAR_META: Record<PillarId, { name: string; short: string; blurb: string }> = {
  1: { name: "Viral Hook", short: "HOOK", blurb: "0–3s · ultra-fast cuts, punch-in, visual shock" },
  2: { name: "Real Pain Point", short: "PAIN", blurb: "Problem framing · medium pacing, dark contrast" },
  3: { name: "Interest & Sales Trigger", short: "TRIGGER", blurb: "Value velocity · B-roll rhythm, proof beats" },
  4: { name: "Intent to Comment", short: "COMMENT", blurb: "Engagement cue · hold + question overlay" },
  5: { name: "Motion Graphic Cues", short: "MOTION", blurb: "Text pops, arrows, highlights, zoom punches" },
};

export const PILLAR_ORDER: PillarId[] = [1, 2, 3, 4, 5];

export const NEUTRAL_GRADE: Grade = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  vignette: 0,
  temperature: 0,
};

export const DEFAULT_WATERMARK: WatermarkSpec = {
  text: "NEXUS FRAME",
  position: "top-left",
  x: 24,
  y: 24,
  color: "#E6EDF3",
  opacity: 0.72,
};

export interface AspectPreset {
  label: string;
  width: number;
  height: number;
}

export const ASPECT_PRESETS: Record<AspectRatio, AspectPreset> = {
  "9:16": { label: "Reels / Shorts 9:16", width: 1080, height: 1920 },
  "16:9": { label: "YouTube 16:9", width: 1920, height: 1080 },
  "1:1": { label: "Feed 1:1", width: 1080, height: 1080 },
  "4:5": { label: "Portrait 4:5", width: 1080, height: 1350 },
};
