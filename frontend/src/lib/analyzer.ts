/**
 * Studio Lite Analyzer (browser).
 *
 * Real deconstruction without a server: frames are sampled through a <video>
 * element into an offscreen canvas, then histogram deltas, region motion and
 * Laplacian variance drive scene-cut detection, motion classification and
 * grade estimation. Audio is decoded with WebAudio and run through spectral
 * flux → autocorrelation tempo tracking (see lib/audio.ts).
 *
 * The Python node produces the heavier artefacts (Demucs stems, per-frame
 * optical flow, AI vision tagging). Both emit the same Framework DNA contract,
 * so a browser-observed framework is fully portable.
 */

import { analyzePcm } from "./audio";
import {
  DEFAULT_WATERMARK,
  FrameworkDna,
  Grade,
  MotionType,
  PILLAR_META,
  PILLAR_ORDER,
  PillarId,
  Shot,
  SfxEvent,
  TransitionType,
} from "./types";

export interface AnalyzeProgress {
  step: "probe" | "frames" | "audio" | "build" | "done";
  progress: number;
  detail?: string;
}

export interface AnalyzeOptions {
  frameworkName?: string;
  sourceLabel?: string;
  /** Frame samples per second of source video. */
  sampleHz?: number;
  maxSamples?: number;
  onProgress?: (p: AnalyzeProgress) => void;
  /** Receives the normalised loudness envelope for the waveform strip. */
  onEnvelope?: (envelope: number[]) => void;
  signal?: AbortSignal;
}

interface FrameSample {
  t: number;
  luma: number;
  contrast: number;
  saturation: number;
  colorfulness: number;
  sharpness: number;
  motion: number;
  centerMotion: number;
  borderMotion: number;
  leftMotion: number;
  rightMotion: number;
  vignette: number;
  hist: Float32Array;
  rgb: [number, number, number];
  signature: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 3) => Number(v.toFixed(digits));

function hex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function waitForEvent(el: HTMLVideoElement, event: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const onError = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("The video could not be decoded by this browser."));
    };
    function cleanup() {
      el.removeEventListener(event, onEvent);
      el.removeEventListener("error", onError);
    }
    el.addEventListener(event, onEvent, { once: true });
    el.addEventListener("error", onError, { once: true });
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish, { once: true });
    // Some browsers coalesce seeks; the timeout keeps analysis moving.
    setTimeout(finish, 400);
    video.currentTime = Math.min(Math.max(0, t), Math.max(0, (video.duration || 0) - 0.02));
  });
}

function readFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  prev: ImageData | null,
  t: number,
): { sample: FrameSample; image: ImageData } {
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  const count = width * height;
  const lumaArr = new Float32Array(count);
  const hist = new Float32Array(16);
  let sumLuma = 0;
  let sumSat = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let centerSum = 0;
  let borderSum = 0;
  let leftSum = 0;
  let rightSum = 0;
  let centerCount = 0;
  let borderCount = 0;
  let leftCount = 0;
  let rightCount = 0;
  const cx0 = Math.floor(width * 0.3);
  const cx1 = Math.floor(width * 0.7);
  const cy0 = Math.floor(height * 0.3);
  const cy1 = Math.floor(height * 0.7);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      lumaArr[y * width + x] = luma;
      sumLuma += luma;
      sumSat += sat;
      sumR += r;
      sumG += g;
      sumB += b;
      hist[Math.min(15, Math.floor(luma * 16))] += 1;
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        centerSum += luma;
        centerCount += 1;
      } else {
        borderSum += luma;
        borderCount += 1;
      }
      if (x < width * 0.4) {
        leftSum += luma;
        leftCount += 1;
      } else if (x > width * 0.6) {
        rightSum += luma;
        rightCount += 1;
      }
    }
  }

  const meanLuma = sumLuma / count;
  let variance = 0;
  for (let i = 0; i < count; i += 1) variance += (lumaArr[i] - meanLuma) ** 2;
  variance /= count;

  // 3x3 Laplacian variance as a sharpness proxy.
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const lap =
        4 * lumaArr[idx] -
        lumaArr[idx - 1] -
        lumaArr[idx + 1] -
        lumaArr[idx - width] -
        lumaArr[idx + width];
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount += 1;
    }
  }
  const lapMean = lapSum / Math.max(1, lapCount);
  const lapVar = Math.max(0, lapSqSum / Math.max(1, lapCount) - lapMean * lapMean);

  let motion = 0;
  let centerMotion = 0;
  let borderMotion = 0;
  let leftMotion = 0;
  let rightMotion = 0;
  if (prev) {
    const prevPixels = prev.data;
    let diffSum = 0;
    let cDiff = 0;
    let cCount = 0;
    let bDiff = 0;
    let bCount = 0;
    let lDiff = 0;
    let lCount = 0;
    let rDiff = 0;
    let rCount = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const prevLuma = (0.2126 * prevPixels[i] + 0.7152 * prevPixels[i + 1] + 0.0722 * prevPixels[i + 2]) / 255;
        const diff = Math.abs(lumaArr[y * width + x] - prevLuma);
        diffSum += diff;
        const inCenter = x >= cx0 && x < cx1 && y >= cy0 && y < cy1;
        if (inCenter) {
          cDiff += diff;
          cCount += 1;
        } else {
          bDiff += diff;
          bCount += 1;
        }
        if (x < width * 0.4) {
          lDiff += diff;
          lCount += 1;
        } else if (x > width * 0.6) {
          rDiff += diff;
          rCount += 1;
        }
      }
    }
    const sampled = Math.ceil(height / 2) * Math.ceil(width / 2);
    motion = diffSum / Math.max(1, sampled);
    centerMotion = cDiff / Math.max(1, cCount);
    borderMotion = bDiff / Math.max(1, bCount);
    leftMotion = lDiff / Math.max(1, lCount);
    rightMotion = rDiff / Math.max(1, rCount);
  }

  const normHist = new Float32Array(16);
  for (let i = 0; i < 16; i += 1) normHist[i] = hist[i] / count;

  const rgb: [number, number, number] = [sumR / count, sumG / count, sumB / count];
  const colorfulness = Math.sqrt(variance) * 2 + sumSat / count;

  return {
    sample: {
      t,
      luma: meanLuma,
      contrast: Math.sqrt(variance),
      saturation: sumSat / count,
      colorfulness,
      sharpness: Math.min(1, lapVar * 900),
      motion: Math.min(1, motion * 12),
      centerMotion: Math.min(1, centerMotion * 12),
      borderMotion: Math.min(1, borderMotion * 12),
      leftMotion: Math.min(1, leftMotion * 12),
      rightMotion: Math.min(1, rightMotion * 12),
      vignette: clamp(((centerSum / Math.max(1, centerCount)) - (borderSum / Math.max(1, borderCount))) * 1.8, 0, 1),
      hist: normHist,
      rgb,
      signature: `${rgb.map((c) => Math.round(c / 16)).join("-")}`,
    },
    image,
  };
}

function histDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / 2;
}

function classifyMotion(shot: FrameSample[]): { motion: MotionType; energy: number } {
  if (!shot.length) return { motion: "static", energy: 0 };
  const avg = (pick: (s: FrameSample) => number) => shot.reduce((a, s) => a + pick(s), 0) / shot.length;
  const energy = avg((s) => s.motion);
  const center = avg((s) => s.centerMotion);
  const border = avg((s) => s.borderMotion);
  const left = avg((s) => s.leftMotion);
  const right = avg((s) => s.rightMotion);
  if (energy < 0.035) return { motion: "static", energy };
  if (center > border * 1.35 && energy > 0.05) return { motion: "zoom_in", energy };
  if (border > center * 1.5) return { motion: "zoom_out", energy };
  if (Math.abs(left - right) > 0.012) return { motion: right > left ? "pan_left" : "pan_right", energy };
  if (energy > 0.16) return { motion: "shake", energy };
  return { motion: "handheld", energy };
}

function classifyTransition(prevShot: FrameSample[], nextShot: FrameSample[], histJump: number): TransitionType {
  if (histJump > 0.62 && prevShot.length && nextShot.length) {
    const lumaJump = Math.abs(prevShot[prevShot.length - 1].luma - nextShot[0].luma);
    if (lumaJump > 0.22) return "flash";
    const motion = nextShot.slice(0, 3).reduce((a, s) => a + s.motion, 0) / Math.max(1, Math.min(3, nextShot.length));
    if (motion > 0.12) return "whip";
    return "glitch";
  }
  return "cut";
}

function buildGrade(samples: FrameSample[]): Grade {
  if (!samples.length) return { brightness: 0, contrast: 1, saturation: 1, vignette: 0, temperature: 0 };
  const luma = samples.reduce((a, s) => a + s.luma, 0) / samples.length;
  const contrast = samples.reduce((a, s) => a + s.contrast, 0) / samples.length;
  const saturation = samples.reduce((a, s) => a + s.saturation, 0) / samples.length;
  const vignette = samples.reduce((a, s) => a + s.vignette, 0) / samples.length;
  const warmth = samples.reduce((a, s) => a + (s.rgb[0] - s.rgb[2]) / 255, 0) / samples.length;
  return {
    brightness: round(clamp((luma - 0.46) * 1.5, -0.4, 0.4)),
    contrast: round(clamp(0.82 + contrast * 2.2, 0.85, 1.45)),
    saturation: round(clamp(0.6 + saturation * 1.6, 0.5, 1.5)),
    vignette: round(clamp(vignette, 0, 0.65)),
    temperature: round(clamp(warmth * 2.2, -0.5, 0.5)),
  };
}

function paletteOf(samples: FrameSample[], count = 4): string[] {
  const buckets = new Map<string, { weight: number; rgb: [number, number, number] }>();
  for (const s of samples) {
    const key = s.signature;
    const weight = 0.4 + s.colorfulness;
    const existing = buckets.get(key);
    if (existing) {
      existing.weight += weight;
      existing.rgb = [
        (existing.rgb[0] + s.rgb[0]) / 2,
        (existing.rgb[1] + s.rgb[1]) / 2,
        (existing.rgb[2] + s.rgb[2]) / 2,
      ];
    } else {
      buckets.set(key, { weight, rgb: [...s.rgb] as [number, number, number] });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count)
    .map((b) => hex(b.rgb));
}

function pillarForTime(t: number, duration: number, ratios: FrameworkDna["rhythm"]["phase_ratios"]): PillarId {
  const order: Array<keyof typeof ratios> = ["hook", "pain", "trigger", "comment", "outro"];
  const total = order.reduce((a, k) => a + ratios[k], 0) || 1;
  let acc = 0;
  for (let i = 0; i < order.length; i += 1) {
    acc += ratios[order[i]] / total;
    if (t / duration <= acc) return PILLAR_ORDER[i];
  }
  return 5;
}

export async function analyzeVideoFile(file: File, options: AnalyzeOptions = {}): Promise<FrameworkDna> {
  const { onProgress, signal } = options;
  const report = (step: AnalyzeProgress["step"], progress: number, detail?: string) => onProgress?.({ step, progress, detail });
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error("Analysis cancelled");
  };

  report("probe", 0.03, "Reading container metadata");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  video.crossOrigin = "anonymous";

  try {
    await waitForEvent(video, "loadedmetadata");
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || duration <= 0.1) throw new Error("This file has no readable video track.");
    const width = video.videoWidth || 1080;
    const height = video.videoHeight || 1920;
    const aspect = width >= height * 1.2 ? "16:9" : Math.abs(width - height) < width * 0.08 ? "1:1" : height > width * 1.4 ? "9:16" : "4:5";

    report("probe", 0.08, `${duration.toFixed(1)}s · ${width}×${height}`);

    const sampleHz = options.sampleHz ?? 7;
    const maxSamples = options.maxSamples ?? 420;
    const sampleCount = clamp(Math.round(duration * sampleHz), 24, maxSamples);
    const canvas = document.createElement("canvas");
    const fw = 160;
    const fh = Math.max(48, Math.round((fw * height) / width));
    canvas.width = fw;
    canvas.height = fh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    const samples: FrameSample[] = [];
    let prevImage: ImageData | null = null;
    for (let i = 0; i < sampleCount; i += 1) {
      throwIfAborted();
      const t = (i / sampleCount) * duration;
      await seek(video, t);
      ctx.drawImage(video, 0, 0, fw, fh);
      const { sample, image } = readFrame(ctx, fw, fh, prevImage, t);
      samples.push(sample);
      prevImage = image;
      if (i % 4 === 0) {
        report("frames", 0.08 + (i / sampleCount) * 0.6, `${i + 1}/${sampleCount} frames sampled`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    video.pause();

    // ---- Cut detection on histogram distance + adaptive threshold ----
    const diffs = samples.map((s, i) => (i === 0 ? 0 : histDistance(samples[i - 1].hist, s.hist)));
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
    const variance = diffs.reduce((a, b) => a + (b - meanDiff) ** 2, 0) / Math.max(1, diffs.length);
    const threshold = Math.max(0.24, meanDiff + Math.sqrt(variance) * 1.9);
    const sampleInterval = duration / sampleCount;
    const cutIndices = [0];
    for (let i = 1; i < diffs.length; i += 1) {
      const bigLumaJump = Math.abs(samples[i].luma - samples[i - 1].luma) > 0.28;
      if (diffs[i] > threshold || bigLumaJump) {
        if ((i - cutIndices[cutIndices.length - 1]) * sampleInterval >= 0.16) cutIndices.push(i);
      }
    }
    cutIndices.push(samples.length);

    report("frames", 0.72, `${cutIndices.length - 1} shots detected`);

    // ---- Audio: decode, tempo, beats, cut-aligned SFX ----
    report("audio", 0.74, "Decoding reference audio");
    let fingerprint: Awaited<ReturnType<typeof analyzePcm>> | null = null;
    try {
      const { decodeAudioFromBlob } = await import("./audio");
      const buffer = await decodeAudioFromBlob(file);
      fingerprint = analyzePcm(buffer);
      options.onEnvelope?.(fingerprint.envelope);
    } catch {
      fingerprint = null;
    }
    const bpm = fingerprint?.bpm ?? 120;
    const beats = fingerprint?.beats ?? Array.from({ length: Math.ceil(duration / 0.5) }, (_, i) => i * 0.5);
    report("audio", 0.85, fingerprint ? `Tempo locked · ${bpm} BPM · ${beats.length} beats` : "No decodable audio — neutral beat grid applied");

    // ---- Shots & DNA assembly ----
    report("build", 0.88, "Compiling framework DNA");
    const ratios = { hook: 0.12, pain: 0.2, trigger: 0.45, comment: 0.13, outro: 0.1 };
    const shots: Shot[] = [];
    for (let i = 0; i < cutIndices.length - 1; i += 1) {
      const from = cutIndices[i];
      const to = cutIndices[i + 1];
      const start = from === 0 ? 0 : samples[from]?.t ?? (from / sampleCount) * duration;
      const end = to >= samples.length ? duration : samples[to]?.t ?? (to / sampleCount) * duration;
      if (end - start < 0.1) continue;
      const frameSet = samples.slice(from, Math.max(from + 1, to));
      const { motion, energy } = classifyMotion(frameSet);
      const histJump = diffs[from] || 0;
      const transition = classifyTransition(samples.slice(0, from), samples.slice(from), histJump);
      const avgSharp = frameSet.reduce((a, s) => a + s.sharpness, 0) / Math.max(1, frameSet.length);
      const effects = frameSet.some((s) => s.motion > 0.35) ? ["high_motion"] : [];
      if (transition === "flash") effects.push("flash_frame");
      if (motion === "shake") effects.push("impact_shake");
      if (avgSharp < 0.3) effects.push("soft_focus");
      shots.push({
        index: shots.length,
        start: round(start),
        end: round(end),
        duration: round(end - start),
        motion,
        motion_energy: round(clamp(energy * 1.6, 0, 1), 2),
        sharpness: round(clamp(avgSharp, 0, 1), 2),
        transition,
        effects,
        pillar: pillarForTime(start, duration, ratios as FrameworkDna["rhythm"]["phase_ratios"]),
        grade: buildGrade(frameSet),
        palette: paletteOf(frameSet, 3),
      });
    }

    // SFX hints: onsets that land on a detected cut keep the framework's
    // transition punctuation when the BGM is swapped later.
    const sfxEvents: SfxEvent[] = [];
    const cutTimes = shots.map((s) => s.start).filter((t) => t > 0.2);
    for (const onset of fingerprint?.onsets ?? []) {
      const hit = cutTimes.find((t) => Math.abs(t - onset) < 0.07);
      if (!hit) continue;
      const shot = shots.find((s) => Math.abs(s.start - hit) < 1e-6);
      const type = shot?.transition === "whip" ? "whoosh" : shot?.transition === "flash" ? "hit" : shot?.transition === "glitch" ? "glitch" : "click";
      sfxEvents.push({ t: round(onset, 3), type, gain: -12 });
    }

    const totalDur = shots.reduce((a, s) => a + s.duration, 0) || duration;
    const grade = buildGrade(samples);
    const palette = paletteOf(samples, 5);
    const pillars = PILLAR_ORDER.map((p) => {
      const inPillar = shots.filter((s) => s.pillar === p);
      return {
        pillar: p,
        name: PILLAR_META[p].name,
        start: inPillar.length ? inPillar[0].start : 0,
        end: inPillar.length ? inPillar[inPillar.length - 1].end : 0,
        shot_count: inPillar.length,
      };
    });

    const dna: FrameworkDna = {
      schema_version: "1.0",
      id: `fw_lite_${Date.now().toString(36)}`,
      framework_name: options.frameworkName ?? file.name.replace(/\.[^.]+$/, ""),
      description: "Observed in the Studio Lite analyzer (browser frame/audio DSP).",
      tags: ["observed", aspect],
      created_at: new Date().toISOString(),
      origin: "browser",
      source: {
        kind: "upload",
        label: options.sourceLabel ?? file.name,
        width,
        height,
        fps: 30,
        aspect,
      },
      duration_sec: round(duration),
      audio: {
        bpm,
        beat_timestamps: beats,
        downbeats: fingerprint?.downbeats ?? beats.filter((_, i) => i % 4 === 0),
        lufs: fingerprint?.lufs ?? -14,
        stems: { vocals: null, bgm: null, sfx: null },
        preview_only: true,
      },
      shots,
      pillars,
      rhythm: {
        avg_shot_sec: round(totalDur / Math.max(1, shots.length)),
        cut_density: round(shots.length / Math.max(0.1, duration)),
        phase_ratios: ratios,
      },
      grade,
      sfx_events: sfxEvents.slice(0, 40),
      watermark: { ...DEFAULT_WATERMARK },
      stats: {
        cuts: shots.length,
        avg_clip_duration: round(totalDur / Math.max(1, shots.length)),
        zoom_ratio: round(shots.filter((s) => s.motion.startsWith("zoom")).length / Math.max(1, shots.length), 2),
        motion_energy: round(shots.reduce((a, s) => a + s.motion_energy, 0) / Math.max(1, shots.length), 2),
      },
    };

    report("done", 1, `${shots.length} shots · ${bpm} BPM · ${palette.length} colour anchors`);
    return dna;
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}
