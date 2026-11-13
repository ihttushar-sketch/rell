/**
 * Beat-Elastic Dynamic Time-Scaling.
 *
 * The framework's rhythm is preserved instead of lazily stretching clips:
 *   1. slot count grows with the requested duration (cut density is invariant),
 *   2. the five retention pillars keep their relative time share,
 *   3. every internal cut is magnetically snapped to a music beat (±40 ms),
 *   4. slot durations cycle through the reference's real cut ladder, so the
 *      fast/slow/fast texture of the source survives re-timing.
 *
 * Deterministic in (dna, options). The Python engine mirrors this exactly —
 * same constants, same rounding, same seeded PRNG (backend/app/scaler.py).
 */

import {
  FrameworkDna,
  Grade,
  MotionType,
  OverlayCue,
  PILLAR_META,
  PILLAR_ORDER,
  PillarBlock,
  PillarId,
  ProduceOptions,
  RenderPlan,
  RenderSlot,
  SfxEvent,
  TransitionType,
} from "./types";

export const SCALER_CONSTANTS = {
  MIN_SLOT_SEC: 0.18,
  MIN_TARGET_SEC: 2,
  MAX_TARGET_SEC: 1800,
  MAX_SLOTS: 600,
  BEAT_SNAP_WINDOW_SEC: 0.04,
  MIN_PILLAR_SLOTS: 5,
  DEFAULT_PHASE_RATIOS: { hook: 0.12, pain: 0.2, trigger: 0.45, comment: 0.13, outro: 0.1 },
} as const;

const PHASE_KEYS = ["hook", "pain", "trigger", "comment", "outro"] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 4) => Number(v.toFixed(digits));

/** Deterministic 32-bit PRNG (mulberry32) — identical implementation in Python. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Accepts `45`, `45s`, `01:30`, `1:02:03`, `2 min`. */
export function parseTargetDuration(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const positive = (amount: number) => (Number.isFinite(amount) && amount > 0 ? amount : null);
  if (/^\d+(\.\d+)?$/.test(value)) return positive(Number(value));
  const parts = value.replace(/\s+/g, "").split(":");
  if (parts.length === 2 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    return positive(Number(parts[0]) * 60 + Number(parts[1]));
  }
  if (parts.length === 3 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    return positive(Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]));
  }
  const shorthand = value.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)$/);
  if (shorthand) {
    const amount = Number(shorthand[1]);
    return positive(/^m/.test(shorthand[2]) ? amount * 60 : amount);
  }
  return null;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (m === 0) return `${s.toFixed(1)}s`;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function formatClock(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function normalizeRatios(dna: FrameworkDna): number[] {
  const raw = PHASE_KEYS.map((k) =>
    Number(dna.rhythm?.phase_ratios?.[k] ?? SCALER_CONSTANTS.DEFAULT_PHASE_RATIOS[k]),
  );
  const safe = raw.map((v) => (Number.isFinite(v) && v > 0 ? v : 0.0001));
  const total = safe.reduce((a, b) => a + b, 0);
  return safe.map((v) => v / total);
}

/**
 * Slot allocation across pillars. Above 5 slots this is a largest-remainder
 * apportionment; below 5 slots the hook is served first (never starve pillar 1).
 */
export function allocateSlots(ratios: number[], slotCount: number): number[] {
  if (slotCount <= 0) return [0, 0, 0, 0, 0];
  if (slotCount < PILLAR_ORDER.length) {
    // Too few slots for all pillars: serve them in retention priority order.
    const priority = [0, 2, 1, 3, 4];
    const short = [0, 0, 0, 0, 0];
    for (let i = 0; i < slotCount; i += 1) short[priority[i % priority.length]] += 1;
    return short;
  }
  const total = ratios.reduce((a, b) => a + b, 0) || 1;
  const exact = ratios.map((r) => (r / total) * slotCount);
  const counts = exact.map((v) => Math.floor(v));
  let remaining = slotCount - counts.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let c = 0; remaining > 0; c += 1) {
    counts[order[c % order.length].i] += 1;
    remaining -= 1;
  }
  // Every pillar gets at least one slot when there is room for all five.
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] !== 0) continue;
    // Donate from the richest pillar that can spare a slot — never from the hook
    // just because it happens to be first in the array.
    let donor = -1;
    for (let j = 0; j < counts.length; j += 1) {
      if (j !== i && counts[j] > 1 && (donor === -1 || counts[j] > counts[donor])) donor = j;
    }
    if (donor >= 0) {
      counts[donor] -= 1;
      counts[i] += 1;
    }
  }
  return counts;
}

/** Priority fill used when the target duration cannot afford five pillars. */
function allocateShort(ratios: number[], slotCount: number): number[] {
  return allocateSlots(ratios, slotCount);
}

function nearestBeat(beats: number[], t: number, window: number): number | null {
  if (!beats.length) return null;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid - 1;
  }
  let best: number | null = null;
  let bestDist = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx < 0 || idx >= beats.length) continue;
    const dist = Math.abs(beats[idx] - t);
    if (dist < bestDist) {
      bestDist = dist;
      best = beats[idx];
    }
  }
  return best !== null && bestDist <= window ? best : null;
}

export function buildBeatGrid(bpm: number, duration: number): number[] {
  if (!Number.isFinite(bpm) || bpm <= 0) return [];
  const step = 60 / bpm;
  const beats: number[] = [];
  for (let i = 0; i * step <= duration + 1e-9; i += 1) beats.push(round(i * step, 4));
  return beats;
}

function motionKeys(motion: MotionType): { from: number; to: number; pan: { x: number; y: number } } {
  switch (motion) {
    case "zoom_in":
      return { from: 1.0, to: 1.14, pan: { x: 0, y: 0 } };
    case "zoom_out":
      return { from: 1.14, to: 1.0, pan: { x: 0, y: 0 } };
    case "pan_left":
      return { from: 1.08, to: 1.08, pan: { x: -0.045, y: 0 } };
    case "pan_right":
      return { from: 1.08, to: 1.08, pan: { x: 0.045, y: 0 } };
    case "shake":
      return { from: 1.06, to: 1.1, pan: { x: 0.012, y: -0.008 } };
    case "handheld":
      return { from: 1.03, to: 1.05, pan: { x: 0.008, y: 0.006 } };
    default:
      return { from: 1.0, to: 1.0, pan: { x: 0, y: 0 } };
  }
}

function overlaysFor(pillar: PillarId, slotIndex: number, duration: number): OverlayCue[] {
  if (pillar === 4) {
    return [
      {
        kind: "text",
        text: "Tell me in the comments",
        at: round(duration * 0.22, 3),
        duration: round(Math.min(1.6, duration * 0.7), 3),
      },
    ];
  }
  if (pillar === 5) {
    return [
      { kind: "zoom_punch", at: 0, duration: round(Math.min(0.3, duration * 0.3), 3) },
      slotIndex % 2 === 0
        ? { kind: "highlight", at: round(duration * 0.35, 3), duration: round(Math.min(0.9, duration * 0.55), 3) }
        : { kind: "arrow", at: round(duration * 0.4, 3), duration: round(Math.min(0.8, duration * 0.5), 3) },
    ];
  }
  if (pillar === 1 && slotIndex % 3 === 0) {
    return [{ kind: "zoom_punch", at: 0, duration: round(Math.min(0.4, duration * 0.5), 3) }];
  }
  return [];
}

interface SlotDraft {
  pillar: PillarId;
  srcIndex: number;
  grade: Grade;
  motion: MotionType;
  transition: TransitionType;
  focus: { x: number; y: number };
  start: number;
  end: number;
}

export function scaleFramework(dna: FrameworkDna, options: ProduceOptions): RenderPlan {
  const C = SCALER_CONSTANTS;
  const requested = Number(options.target_duration_sec);
  const target = clamp(Number.isFinite(requested) ? requested : 0, C.MIN_TARGET_SEC, C.MAX_TARGET_SEC);

  const shots = (dna.shots ?? []).filter((s) => s && s.duration > 0);
  const sourceDuration = Math.max(0.2, Number(dna.duration_sec) || 0.2);
  const totalShotTime = shots.reduce((a, s) => a + s.duration, 0) || 1;
  const avgShot = clamp(
    Number(dna.rhythm?.avg_shot_sec) || (shots.length ? totalShotTime / shots.length : 0.8),
    C.MIN_SLOT_SEC,
    8,
  );

  // 1) Density-preserving slot count.
  let slotCount = clamp(Math.round(target / avgShot), 1, C.MAX_SLOTS);
  slotCount = Math.max(slotCount, Math.min(C.MIN_PILLAR_SLOTS, Math.floor(target / C.MIN_SLOT_SEC)));
  slotCount = Math.min(slotCount, Math.floor(target / C.MIN_SLOT_SEC) || 1, C.MAX_SLOTS);

  // 2) Pillar windows + slot counts.
  const ratios = normalizeRatios(dna);
  const counts = slotCount >= C.MIN_PILLAR_SLOTS ? allocateSlots(ratios, slotCount) : allocateShort(ratios, slotCount);

  // 3) Cut ladder: durations are drawn from the reference shots of that pillar
  //    (cycled), scaled into the pillar's time window.
  const rng = mulberry32(seedFromString(`${dna.id}|${target.toFixed(3)}`));
  const drafts: SlotDraft[] = [];
  const boundaries: number[] = [0];
  let cursor = 0;

  for (let p = 0; p < PILLAR_ORDER.length; p += 1) {
    const k = counts[p];
    if (!k) continue;
    const window = ratios[p] * target;
    const pillarShots = shots.filter((s) => s.pillar === PILLAR_ORDER[p]);
    const ladder = pillarShots.length ? pillarShots : shots;
    const ladderTotal = ladder.reduce((a, s) => a + s.duration, 0) || 1;

    const weights: number[] = [];
    for (let j = 0; j < k; j += 1) {
      const src = ladder.length ? ladder[(j + p) % ladder.length] : null;
      const base = src ? src.duration / ladderTotal : 1 / k;
      const jitter = 1 + (rng() - 0.5) * 0.22;
      weights.push(Math.max(1e-4, base * jitter));
    }
    const weightSum = weights.reduce((a, b) => a + b, 0);

    for (let j = 0; j < k; j += 1) {
      const duration = (weights[j] / weightSum) * window;
      const src = ladder.length ? ladder[(j + p) % ladder.length] : null;
      drafts.push({
        pillar: PILLAR_ORDER[p],
        srcIndex: src ? src.index : 0,
        grade: src?.grade ?? dna.grade,
        motion: src?.motion ?? "static",
        transition: src?.transition ?? "cut",
        focus: src?.focus ?? { x: 0, y: 0 },
        start: cursor,
        end: cursor + duration,
      });
      cursor += duration;
      boundaries.push(cursor);
    }
  }

  // Exact total: the final cut is always the requested duration.
  if (drafts.length) {
    drafts[drafts.length - 1].end = target;
    boundaries[boundaries.length - 1] = target;
  }

  // 4) Beat snapping (±40 ms), sequential so minimum slot length is respected.
  const bpm = Number(dna.audio?.bpm) || 0;
  const beatGrid = buildBeatGrid(bpm, target);
  const finalStarts: number[] = [0];
  let snappedCuts = 0;
  for (let i = 1; i < drafts.length; i += 1) {
    const prev = finalStarts[i - 1];
    const raw = drafts[i].start;
    const beat = nearestBeat(beatGrid, raw, C.BEAT_SNAP_WINDOW_SEC);
    let cut = raw;
    if (beat !== null && beat - prev >= C.MIN_SLOT_SEC && drafts[i].end - beat >= C.MIN_SLOT_SEC) {
      cut = beat;
      snappedCuts += 1;
    }
    cut = Math.max(cut, prev + C.MIN_SLOT_SEC);
    cut = Math.min(cut, drafts[i].end - Math.min(C.MIN_SLOT_SEC, (drafts[i].end - prev) / 2));
    finalStarts.push(round(cut, 4));
  }

  // 5) Materialise render slots.
  const slots: RenderSlot[] = [];
  for (let i = 0; i < drafts.length; i += 1) {
    const start = finalStarts[i];
    const end = i === drafts.length - 1 ? round(target, 4) : finalStarts[i + 1];
    const duration = round(end - start, 4);
    if (duration <= 0.001) continue;
    const draft = drafts[i];
    const keys = motionKeys(draft.motion);
    const sfx: SfxEvent[] = [];
    if (options.preserve_sfx) {
      if (draft.transition === "whip") sfx.push({ t: start, type: "whoosh", gain: -11 });
      else if (draft.transition === "flash") sfx.push({ t: start, type: "hit", gain: -9 });
      else if (draft.transition === "glitch") sfx.push({ t: start, type: "glitch", gain: -13 });
      if (draft.pillar === 3 && i % 8 === 0) sfx.push({ t: start, type: "riser", gain: -15 });
    }
    slots.push({
      index: slots.length,
      pillar: draft.pillar,
      start: round(start, 4),
      end,
      duration,
      src_shot: draft.srcIndex,
      motion: draft.motion,
      zoom_from: keys.from,
      zoom_to: keys.to,
      pan: keys.pan,
      grade: { ...draft.grade },
      transition: draft.transition,
      focus: { ...draft.focus },
      overlays: overlaysFor(draft.pillar, i, duration),
      sfx,
    });
  }

  // 6) Pillar blocks in output time (from the ratios, then reconciled to slots).
  const pillarBlocks: PillarBlock[] = PILLAR_ORDER.map((p, idx) => {
    const start = round(ratios.slice(0, idx).reduce((a, b) => a + b, 0) * target, 3);
    const end = idx === 4 ? round(target, 3) : round(start + ratios[idx] * target, 3);
    const inPillar = slots.filter((s) => s.pillar === p);
    return {
      pillar: p,
      name: PILLAR_META[p].name,
      start: inPillar.length ? inPillar[0].start : start,
      end: inPillar.length ? inPillar[inPillar.length - 1].end : end,
      shot_count: inPillar.length,
    };
  });

  const loopCount = Math.max(1, Math.ceil(target / sourceDuration));
  const crossfadePoints: number[] = [];
  for (let i = 1; i < loopCount; i += 1) {
    const approx = (i * sourceDuration) % target;
    const beat = nearestBeat(beatGrid, approx, 0.25);
    crossfadePoints.push(round(beat ?? approx, 3));
  }

  return {
    framework_id: dna.id,
    framework_name: dna.framework_name,
    target_duration_sec: round(target, 3),
    bpm,
    beat_grid: beatGrid,
    crossfade_points: crossfadePoints,
    slots,
    pillars: pillarBlocks,
    stats: {
      cuts: slots.length,
      effective_bpm: round((slots.length / target) * 60, 2),
      avg_clip_duration: round(target / Math.max(1, slots.length), 3),
      density: round(slots.length / target, 3),
      snapped_cuts: snappedCuts,
      loop_count: loopCount,
    },
    audio: {
      mode: options.bg_mode,
      preserve_sfx: options.preserve_sfx,
      lufs: dna.audio?.lufs ?? -14,
    },
    watermark: {
      ...(dna.watermark ?? { text: "NEXUS FRAME", position: "top-left" as const, x: 24, y: 24, color: "#E6EDF3", opacity: 0.72 }),
      position: "top-left" as const,
    },
    aspect: options.aspect ?? dna.source.aspect ?? "9:16",
  };
}
