/**
 * Seeded Production Vault templates.
 *
 * Two high-converting frameworks ship with the studio so the Production House
 * can be exercised immediately, plus one luxury/commercial template. They are
 * generated deterministically from a cut ladder + retention ratios rather than
 * hand-typed timestamps, so the JSON stays human-readable and editable.
 */

import {
  AspectRatio,
  DEFAULT_WATERMARK,
  FrameworkDna,
  Grade,
  MotionType,
  PILLAR_META,
  PILLAR_ORDER,
  PillarId,
  SfxEvent,
  Shot,
  TransitionType,
} from "./types";
import { buildBeatGrid, mulberry32, seedFromString } from "./scaler";

interface TemplateSpec {
  id: string;
  name: string;
  description: string;
  tags: string[];
  duration: number;
  bpm: number;
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: number;
  sourceLabel: string;
  /** Reference cut ladder, cycled to fill the duration. */
  ladder: number[];
  ratios: { hook: number; pain: number; trigger: number; comment: number; outro: number };
  motions: MotionType[];
  transitions: TransitionType[];
  grade: Grade;
  palette: string[];
  lufs: number;
  sfx: SfxEvent[];
  zoomBias: number;
}

const TEMPLATES: TemplateSpec[] = [
  {
    id: "fw_hormozi_fast",
    name: "Fast Hormozi Style",
    description:
      "Sub-second cut ladder, punch-in on every claim, whoosh-driven transitions. Built for paid social hooks and VSL openers.",
    tags: ["fast", "talking-head", "direct-response", "9:16"],
    duration: 30,
    bpm: 128,
    aspect: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    sourceLabel: "template:fast-hormozi-reference.mp4",
    ladder: [0.46, 0.72, 0.38, 1.05, 0.55, 0.62, 0.34, 0.91, 0.48, 0.7],
    ratios: { hook: 0.12, pain: 0.2, trigger: 0.45, comment: 0.13, outro: 0.1 },
    motions: ["zoom_in", "zoom_in", "shake", "static", "zoom_out", "pan_right", "zoom_in", "handheld"],
    transitions: ["cut", "whip", "cut", "flash", "cut", "cut", "glitch", "cut"],
    grade: { brightness: 0.04, contrast: 1.18, saturation: 1.06, vignette: 0.22, temperature: -0.05 },
    palette: ["#0D0F12", "#1E2430", "#C9D1D9", "#E6EDF3", "#4A5568"],
    lufs: -13.5,
    sfx: [
      { t: 0.46, type: "whoosh", gain: -11 },
      { t: 1.74, type: "hit", gain: -9 },
      { t: 4.2, type: "whoosh", gain: -12 },
      { t: 9.4, type: "riser", gain: -15 },
      { t: 18.1, type: "glitch", gain: -13 },
      { t: 26.9, type: "whoosh", gain: -11 },
    ],
    zoomBias: 0.55,
  },
  {
    id: "fw_dark_cinematic",
    name: "Dark Cinematic Doc",
    description:
      "Longer holds, slow push-ins and crushed blacks. For brand documentaries, founder stories and premium case-study edits.",
    tags: ["cinematic", "documentary", "slow-burn", "16:9"],
    duration: 45,
    bpm: 92,
    aspect: "16:9",
    width: 1920,
    height: 1080,
    fps: 24,
    sourceLabel: "template:dark-cinematic-reference.mp4",
    ladder: [2.4, 1.8, 3.1, 1.35, 2.05, 2.8, 1.6, 2.25],
    ratios: { hook: 0.1, pain: 0.24, trigger: 0.38, comment: 0.16, outro: 0.12 },
    motions: ["zoom_in", "static", "pan_left", "zoom_in", "static", "pan_right", "zoom_out"],
    transitions: ["cut", "fade", "cut", "cut", "fade", "cut"],
    grade: { brightness: -0.08, contrast: 1.26, saturation: 0.78, vignette: 0.46, temperature: -0.14 },
    palette: ["#0D0F12", "#161B22", "#21262D", "#8B949E", "#E6EDF3"],
    lufs: -15.5,
    sfx: [
      { t: 4.3, type: "riser", gain: -18 },
      { t: 12.8, type: "hit", gain: -14 },
      { t: 27.5, type: "riser", gain: -17 },
      { t: 39.2, type: "hit", gain: -15 },
    ],
    zoomBias: 0.22,
  },
  {
    id: "fw_luxury_apparel",
    name: "Luxury Apparel Cut",
    description:
      "Fashion-film cadence: 0.8s beats, snap pans, desaturated silver grade, hard cuts on the downbeat. Watermark locked top-left.",
    tags: ["luxury", "fashion", "product", "9:16"],
    duration: 24,
    bpm: 104,
    aspect: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    sourceLabel: "template:luxury-apparel-reference.mp4",
    ladder: [0.78, 0.84, 0.52, 0.92, 0.68, 0.74, 0.46, 0.8],
    ratios: { hook: 0.14, pain: 0.14, trigger: 0.42, comment: 0.14, outro: 0.16 },
    motions: ["pan_right", "zoom_out", "pan_left", "zoom_in", "static", "pan_right"],
    transitions: ["cut", "cut", "whip", "cut", "fade", "cut"],
    grade: { brightness: 0.02, contrast: 1.1, saturation: 0.62, vignette: 0.38, temperature: -0.22 },
    palette: ["#0D0F12", "#21262D", "#8B949E", "#C9D1D9", "#E6EDF3"],
    lufs: -14.0,
    sfx: [
      { t: 3.6, type: "whoosh", gain: -13 },
      { t: 8.9, type: "click", gain: -16 },
      { t: 15.2, type: "whoosh", gain: -12 },
      { t: 20.4, type: "hit", gain: -14 },
    ],
    zoomBias: 0.34,
  },
];

function pillarAtRatio(t: number, duration: number, ratios: TemplateSpec["ratios"]): PillarId {
  const bounds = [] as number[];
  let acc = 0;
  for (const key of ["hook", "pain", "trigger", "comment", "outro"] as const) {
    acc += ratios[key];
    bounds.push((acc / 1) * duration);
  }
  for (let i = 0; i < bounds.length; i += 1) if (t < bounds[i]) return PILLAR_ORDER[i];
  return 5;
}

function buildFramework(spec: TemplateSpec): FrameworkDna {
  const rng = mulberry32(seedFromString(spec.id));
  const shots: Shot[] = [];
  let t = 0;
  let i = 0;
  while (t < spec.duration - 0.05) {
    const base = spec.ladder[i % spec.ladder.length];
    const jitter = 1 + (rng() - 0.5) * 0.12;
    const duration = Math.min(spec.duration - t, Math.max(0.2, base * jitter));
    const motion = spec.motions[i % spec.motions.length];
    const transition = spec.transitions[i % spec.transitions.length];
    const brightnessShift = (rng() - 0.5) * 0.04;
    shots.push({
      index: i,
      start: Number(t.toFixed(3)),
      end: Number((t + duration).toFixed(3)),
      duration: Number(duration.toFixed(3)),
      motion,
      motion_energy: Number((0.35 + rng() * 0.6).toFixed(2)),
      sharpness: Number((0.62 + rng() * 0.35).toFixed(2)),
      transition,
      effects: [
        motion === "shake" ? "impact_shake" : null,
        transition === "flash" ? "flash_frame" : null,
        rng() > spec.zoomBias ? "punch_in" : null,
        spec.grade.saturation < 0.8 ? "silver_grade" : null,
      ].filter(Boolean) as string[],
      pillar: pillarAtRatio(t, spec.duration, spec.ratios),
      grade: { ...spec.grade, brightness: Number((spec.grade.brightness + brightnessShift).toFixed(3)) },
      palette: spec.palette.slice(0, 3),
    });
    t += duration;
    i += 1;
  }
  if (shots.length) shots[shots.length - 1].end = spec.duration;

  const pillarsInDna = PILLAR_ORDER.map((p) => {
    const inPillar = shots.filter((s) => s.pillar === p);
    return {
      pillar: p,
      name: PILLAR_META[p].name,
      start: inPillar.length ? inPillar[0].start : 0,
      end: inPillar.length ? inPillar[inPillar.length - 1].end : 0,
      shot_count: inPillar.length,
    };
  });

  const beats = buildBeatGrid(spec.bpm, spec.duration + 0.001);
  const totalDur = shots.reduce((a, s) => a + s.duration, 0);
  return {
    schema_version: "1.0",
    id: spec.id,
    framework_name: spec.name,
    description: spec.description,
    tags: spec.tags,
    created_at: "2026-01-12T09:00:00.000Z",
    origin: "server",
    source: {
      kind: "template",
      label: spec.sourceLabel,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      aspect: spec.aspect,
    },
    duration_sec: spec.duration,
    audio: {
      bpm: spec.bpm,
      beat_timestamps: beats,
      downbeats: beats.filter((_, idx) => idx % 4 === 0),
      lufs: spec.lufs,
      stems: { vocals: null, bgm: null, sfx: null },
      preview_only: true,
    },
    shots,
    pillars: pillarsInDna,
    rhythm: {
      avg_shot_sec: Number((totalDur / shots.length).toFixed(3)),
      cut_density: Number((shots.length / spec.duration).toFixed(3)),
      phase_ratios: spec.ratios,
    },
    grade: spec.grade,
    sfx_events: spec.sfx,
    watermark: { ...DEFAULT_WATERMARK },
    stats: {
      cuts: shots.length,
      avg_clip_duration: Number((totalDur / shots.length).toFixed(3)),
      zoom_ratio: Number(
        (shots.filter((s) => s.motion === "zoom_in" || s.motion === "zoom_out").length / shots.length).toFixed(2),
      ),
      motion_energy: Number((shots.reduce((a, s) => a + s.motion_energy, 0) / shots.length).toFixed(2)),
    },
  };
}

export const SAMPLE_FRAMEWORKS: FrameworkDna[] = TEMPLATES.map(buildFramework);

export function cloneFramework(dna: FrameworkDna): FrameworkDna {
  return JSON.parse(JSON.stringify(dna)) as FrameworkDna;
}

export { buildFramework };
export type { TemplateSpec };
