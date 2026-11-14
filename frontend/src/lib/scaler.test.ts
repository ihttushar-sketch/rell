/**
 * Scaler invariants — the contract the renderer and the Python engine rely on.
 * Run with: npm test  (tsx --test)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_FRAMEWORKS, buildFramework } from "./samples";
import {
  SCALER_CONSTANTS,
  allocateSlots,
  buildBeatGrid,
  formatClock,
  mulberry32,
  parseTargetDuration,
  scaleFramework,
  seedFromString,
} from "./scaler";
import { FrameworkDna, PILLAR_ORDER, PillarId } from "./types";

const TARGETS = [2, 5, 8, 15, 30, 45, 60, 120, 600];

function plan(framework: FrameworkDna, target: number) {
  return scaleFramework(framework, {
    target_duration_sec: target,
    bg_mode: "framework",
    preserve_sfx: true,
  });
}

test("seeded vault ships at least two high-converting templates", () => {
  assert.ok(SAMPLE_FRAMEWORKS.length >= 2);
  for (const framework of SAMPLE_FRAMEWORKS) {
    assert.ok(framework.shots.length > 3, `${framework.framework_name} has shots`);
    assert.ok(framework.audio.bpm > 50 && framework.audio.bpm < 200);
    assert.equal(framework.watermark.position, "top-left");
    assert.equal(framework.watermark.x, 24);
    assert.equal(framework.watermark.y, 24);
  }
});

test("duration parsing accepts seconds, clock time and shorthand", () => {
  assert.equal(parseTargetDuration("30"), 30);
  assert.equal(parseTargetDuration(" 45s "), 45);
  assert.equal(parseTargetDuration("01:30"), 90);
  assert.equal(parseTargetDuration("1:02:03"), 3723);
  assert.equal(parseTargetDuration("2 min"), 120);
  assert.equal(parseTargetDuration("0"), null);
  assert.equal(parseTargetDuration("nope"), null);
  assert.equal(formatClock(90), "01:30");
});

test("every target keeps exact duration, monotonic cuts and minimum slot length", () => {
  for (const framework of SAMPLE_FRAMEWORKS) {
    for (const target of TARGETS) {
      const result = plan(framework, target);
      const sum = result.slots.reduce((total, slot) => total + slot.duration, 0);
      assert.ok(Math.abs(sum - target) < 0.001, `${framework.id}@${target}s sums to ${sum}`);
      assert.equal(result.slots[result.slots.length - 1].end, Number(target.toFixed(4)));
      for (let index = 1; index < result.slots.length; index += 1) {
        assert.ok(
          result.slots[index].start >= result.slots[index - 1].end - 1e-6,
          `${framework.id}@${target}s slot ${index} overlaps`,
        );
      }
      for (const slot of result.slots) {
        assert.ok(slot.duration >= SCALER_CONSTANTS.MIN_SLOT_SEC - 1e-3, `${framework.id}@${target}s short slot`);
      }
    }
  }
});

test("density is preserved instead of stretching clips", () => {
  const framework = SAMPLE_FRAMEWORKS[0];
  const short = plan(framework, 15);
  const long = plan(framework, 60);
  assert.ok(Math.abs(short.stats.avg_clip_duration - long.stats.avg_clip_duration) < 0.12);
  assert.ok(long.stats.cuts > short.stats.cuts * 3.5);
  // A 4x longer brief must not yield 4x longer shots.
  assert.ok(long.stats.avg_clip_duration < framework.duration_sec * 0.25);
});

test("all five retention pillars survive on realistic durations", () => {
  for (const framework of SAMPLE_FRAMEWORKS) {
    for (const target of [15, 30, 60]) {
      const result = plan(framework, target);
      const present = new Set(result.slots.map((slot) => slot.pillar));
      for (const pillar of PILLAR_ORDER) {
        assert.ok(present.has(pillar as PillarId), `${framework.id}@${target}s missing pillar ${pillar}`);
      }
      assert.equal(result.pillars.length, 5);
      for (const block of result.pillars) assert.ok(block.shot_count > 0);
    }
  }
});

test("cuts magnetically snap to the beat grid within ±40ms", () => {
  const framework = SAMPLE_FRAMEWORKS[0];
  const result = plan(framework, 45);
  const beats = buildBeatGrid(framework.audio.bpm, 45);
  let snapped = 0;
  for (const slot of result.slots.slice(1)) {
    const nearest = beats.reduce((best, beat) => (Math.abs(beat - slot.start) < Math.abs(best - slot.start) ? beat : best), Infinity);
    if (Math.abs(nearest - slot.start) <= SCALER_CONSTANTS.BEAT_SNAP_WINDOW_SEC + 1e-6) snapped += 1;
  }
  assert.ok(snapped > 0, "at least one cut is beat-locked");
  assert.equal(result.stats.snapped_cuts, snapped);
});

test("scaling is deterministic for identical inputs", () => {
  for (const framework of SAMPLE_FRAMEWORKS) {
    const a = JSON.stringify(plan(framework, 30));
    const b = JSON.stringify(plan(framework, 30));
    assert.equal(a, b);
  }
  const rngA = mulberry32(seedFromString("nexus"));
  const rngB = mulberry32(seedFromString("nexus"));
  for (let i = 0; i < 5; i += 1) assert.equal(rngA(), rngB());
});

test("preserve_sfx glues transition stings to cut behaviour", () => {
  const framework = SAMPLE_FRAMEWORKS[0];
  const withSfx = plan(framework, 30);
  const withoutSfx = scaleFramework(framework, {
    target_duration_sec: 30,
    bg_mode: "custom",
    preserve_sfx: false,
  });
  const count = (slots: typeof withSfx.slots) => slots.reduce((total, slot) => total + slot.sfx.length, 0);
  assert.ok(count(withSfx.slots) > 0);
  assert.equal(count(withoutSfx.slots), 0);
  assert.equal(withoutSfx.audio.preserve_sfx, false);
  assert.equal(withoutSfx.audio.mode, "custom");
});

test("slot allocation never starves the hook on short targets", () => {
  const counts = allocateSlots([0.12, 0.2, 0.45, 0.13, 0.1], 3);
  assert.ok(counts[0] >= 1, "hook receives a slot");
  assert.equal(counts.reduce((a, b) => a + b, 0), 3);
  const full = allocateSlots([0.12, 0.2, 0.45, 0.13, 0.1], 37);
  assert.equal(full.reduce((a, b) => a + b, 0), 37);
  assert.ok(full.every((value) => value >= 1));
});

test("extreme targets are clamped, never crash", () => {
  const framework = SAMPLE_FRAMEWORKS[1];
  assert.ok(plan(framework, 0.2).target_duration_sec >= SCALER_CONSTANTS.MIN_TARGET_SEC);
  const huge = plan(framework, 99999);
  assert.equal(huge.target_duration_sec, SCALER_CONSTANTS.MAX_TARGET_SEC);
  assert.ok(huge.slots.length <= SCALER_CONSTANTS.MAX_SLOTS);
});

test("template builder produces contiguous, non-overlapping shots", () => {
  const framework = buildFramework({
    id: "fw_test",
    name: "Test Ladder",
    description: "",
    tags: [],
    duration: 12,
    bpm: 120,
    aspect: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    sourceLabel: "test",
    ladder: [0.4, 0.6, 0.5],
    ratios: { hook: 0.12, pain: 0.2, trigger: 0.45, comment: 0.13, outro: 0.1 },
    motions: ["zoom_in", "static"],
    transitions: ["cut", "whip"],
    grade: { brightness: 0, contrast: 1, saturation: 1, vignette: 0.2, temperature: 0 },
    palette: ["#000000", "#FFFFFF"],
    lufs: -14,
    sfx: [],
    zoomBias: 0.4,
  });
  for (let i = 1; i < framework.shots.length; i += 1) {
    assert.ok(Math.abs(framework.shots[i].start - framework.shots[i - 1].end) < 0.011);
  }
  assert.ok(framework.shots[framework.shots.length - 1].end <= framework.duration_sec + 0.01);
});
