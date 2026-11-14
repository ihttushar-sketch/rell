/**
 * Studio Lite Renderer (browser).
 *
 * A real replication pass: every RenderSlot from the scaler is played back from
 * the user's raw clips through a pre-seeked deck pipeline (so fast cuts do not
 * stutter), composited with zoom/pan, grade, vignette, motion-graphic cues and
 * the mandatory TOP-LEFT watermark, then captured to WebM via MediaRecorder.
 *
 * The Python node renders the identical plan through an FFmpeg filtergraph at
 * full resolution with Demucs stems, sidechain ducking and LUFS limiting
 * (backend/app/renderer.py).
 */

import { ASPECT_PRESETS, AspectRatio, RenderPlan, RenderSlot } from "./types";

export interface SourceClip {
  file: File;
  name: string;
}

export interface BrowserRenderOptions {
  plan: RenderPlan;
  sources: SourceClip[];
  canvas: HTMLCanvasElement;
  /** Framework BGM / reference mix. Looped to the target duration. */
  bgAudio?: File | null;
  record?: boolean;
  width?: number;
  height?: number;
  onProgress?: (progress: number, label: string) => void;
  signal?: AbortSignal;
}

export interface BrowserRenderResult {
  url: string | null;
  blob: Blob | null;
  posterDataUrl: string;
  durationSec: number;
  width: number;
  height: number;
  framesDrawn: number;
  heldFrames: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export function outputSize(aspect: AspectRatio, maxDim = 960): { width: number; height: number } {
  const preset = ASPECT_PRESETS[aspect] ?? ASPECT_PRESETS["9:16"];
  const scale = Math.min(1, maxDim / Math.max(preset.width, preset.height));
  return {
    width: Math.round((preset.width * scale) / 2) * 2,
    height: Math.round((preset.height * scale) / 2) * 2,
  };
}

function pickMime(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp9", "video/webm"];
  if (typeof MediaRecorder === "undefined") return "video/webm";
  for (const mime of candidates) if (MediaRecorder.isTypeSupported(mime)) return mime;
  return "video/webm";
}

function waitFor(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener(event, finish);
      resolve();
    };
    el.addEventListener(event, finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

class Deck {
  readonly video: HTMLVideoElement;
  readonly srcIndex: number;
  ready = false;
  private readonly objectUrl: string;
  private pending: Promise<void> | null = null;
  private pendingOffset = -1;

  constructor(file: File, srcIndex: number) {
    this.srcIndex = srcIndex;
    this.objectUrl = URL.createObjectURL(file);
    this.video = document.createElement("video");
    this.video.src = this.objectUrl;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = "auto";
    this.video.crossOrigin = "anonymous";
  }

  async metadata(): Promise<void> {
    if (this.video.readyState >= 1) return;
    await waitFor(this.video, "loadedmetadata", 8000);
    if (this.video.readyState < 1) throw new Error("Clip could not be decoded");
  }

  get duration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  /** Seek ahead of the cut; concurrent calls collapse into the latest target. */
  seekTo(offset: number): Promise<void> {
    this.ready = false;
    this.pendingOffset = offset;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      while (this.pendingOffset >= 0) {
        const target = this.pendingOffset;
        this.pendingOffset = -1;
        this.video.pause();
        const clamped = clamp(target, 0, Math.max(0, this.duration - 0.08));
        if (Math.abs(this.video.currentTime - clamped) > 0.02) {
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              this.video.removeEventListener("seeked", finish);
              resolve();
            };
            this.video.addEventListener("seeked", finish, { once: true });
            setTimeout(finish, 900);
            this.video.currentTime = clamped;
          });
        }
        this.ready = this.video.readyState >= 2;
      }
      this.pending = null;
    })();
    return this.pending;
  }

  async play(): Promise<void> {
    try {
      await this.video.play();
    } catch {
      /* autoplay policy: unlocked by the user's Produce click */
    }
  }

  pause(): void {
    this.video.pause();
  }

  dispose(): void {
    this.video.pause();
    this.video.removeAttribute("src");
    URL.revokeObjectURL(this.objectUrl);
  }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  cw: number,
  ch: number,
  zoom: number,
  panX: number,
  panY: number,
  shakeX = 0,
  shakeY = 0,
): boolean {
  if (video.readyState < 2 || !video.videoWidth) return false;
  const base = Math.max(cw / video.videoWidth, ch / video.videoHeight);
  const w = video.videoWidth * base * zoom;
  const h = video.videoHeight * base * zoom;
  const overflowX = Math.max(0, w - cw);
  const overflowY = Math.max(0, h - ch);
  ctx.drawImage(video, -(overflowX / 2) + panX * overflowX + shakeX, -(overflowY / 2) + panY * overflowY + shakeY, w, h);
  return true;
}

function drawWatermark(ctx: CanvasRenderingContext2D, plan: RenderPlan, cw: number): void {
  const spec = plan.watermark;
  // The mark is contractually anchored at 24:24 of the output frame.
  const scale = clamp(cw / 540, 0.7, 2.2);
  const x = spec.x;
  const y = spec.y;
  const fontPx = clamp(14 * scale, 11, 30);
  const text = spec.text.toUpperCase();
  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  const width = ctx.measureText(text).width;
  const padX = 8 * scale;
  const padY = 6 * scale;
  const boxW = width + padX * 2;
  const boxH = fontPx + padY * 2;
  const bx = x - padX;
  const by = y - padY;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#0D0F12";
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.globalAlpha = clamp(spec.opacity + 0.2, 0, 1);
  ctx.fillStyle = spec.color;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = clamp(spec.opacity * 0.85, 0, 1);
  ctx.fillRect(bx, by + boxH, boxW, Math.max(1, 1.2 * scale));
  ctx.restore();
}

function drawCues(ctx: CanvasRenderingContext2D, slot: RenderSlot, localT: number, cw: number, ch: number): void {
  const scale = clamp(cw / 540, 0.7, 2.2);
  for (const cue of slot.overlays) {
    const end = cue.at + cue.duration;
    if (localT < cue.at || localT > end) continue;
    const life = clamp((localT - cue.at) / Math.max(0.001, cue.duration), 0, 1);
    const appear = easeInOut(clamp(life * 6, 0, 1));
    const alpha = Math.min(appear, clamp((1 - life) * 5, 0, 1));
    if (cue.kind === "zoom_punch") continue;
    ctx.save();
    ctx.globalAlpha = alpha * 0.92;
    if (cue.kind === "highlight") {
      const w = cw * 0.3;
      const h = Math.max(3, ch * 0.009);
      ctx.fillStyle = "#E6EDF3";
      ctx.fillRect(cw * 0.5 - w / 2, ch * 0.74, w * easeInOut(life), h);
    } else if (cue.kind === "arrow") {
      const cx = cw * 0.5;
      const cy = ch * 0.7;
      const len = cw * 0.15 * easeInOut(appear);
      ctx.strokeStyle = "#E6EDF3";
      ctx.lineWidth = Math.max(2, 2.2 * scale);
      ctx.beginPath();
      ctx.moveTo(cx - len / 2, cy);
      ctx.lineTo(cx + len / 2, cy);
      ctx.lineTo(cx + len / 2 - 9 * scale, cy - 9 * scale);
      ctx.moveTo(cx + len / 2, cy);
      ctx.lineTo(cx + len / 2 - 9 * scale, cy + 9 * scale);
      ctx.stroke();
    } else if (cue.kind === "text" && cue.text) {
      const fontPx = 16 * scale;
      ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      const text = cue.text.toUpperCase();
      const padX = 11 * scale;
      const boxW = ctx.measureText(text).width + padX * 2;
      const boxH = fontPx + 12 * scale;
      const bx = cw / 2 - boxW / 2;
      const by = ch * 0.8 - boxH + (1 - appear) * 6 * scale;
      ctx.fillStyle = "rgba(13,15,18,0.82)";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = "rgba(230,237,243,0.55)";
      ctx.lineWidth = Math.max(1, scale);
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.fillStyle = "#E6EDF3";
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + padX, by + boxH / 2);
    }
    ctx.restore();
  }
}

function paintFrame(options: {
  ctx: CanvasRenderingContext2D;
  plan: RenderPlan;
  slot: RenderSlot;
  localT: number;
  progress: number;
  primary: HTMLVideoElement;
  blendWith: HTMLVideoElement | null;
  blend: number;
  cw: number;
  ch: number;
}): boolean {
  const { ctx, plan, slot, localT, progress, primary, blendWith, blend, cw, ch } = options;
  const scale = clamp(cw / 540, 0.7, 2.2);
  const eased = easeInOut(clamp(progress, 0, 1));
  const punch = slot.overlays.find((c) => c.kind === "zoom_punch");
  const punchBoost =
    punch && localT <= punch.at + punch.duration
      ? 1 + 0.05 * (1 - clamp((localT - punch.at) / Math.max(0.001, punch.duration), 0, 1))
      : 1;
  const zoom = lerp(slot.zoom_from, slot.zoom_to, eased) * punchBoost;
  const shake = slot.motion === "shake" ? 2.2 * scale : 0;
  const shakeX = shake ? Math.sin(localT * 61.7) * shake : 0;
  const shakeY = shake ? Math.cos(localT * 48.3) * shake : 0;

  const grade = slot.grade;
  ctx.save();
  ctx.fillStyle = "#0D0F12";
  ctx.fillRect(0, 0, cw, ch);
  ctx.filter = `brightness(${clamp(1 + grade.brightness * 0.5, 0.3, 1.9)}) contrast(${clamp(grade.contrast, 0.4, 2)}) saturate(${clamp(
    grade.saturation,
    0,
    2,
  )})`;
  const focusX = (slot.focus?.x ?? 0) * 0.5;
  const focusY = (slot.focus?.y ?? 0) * 0.5;
  const panX = slot.pan.x * eased + focusX;
  const panY = slot.pan.y * eased + focusY;
  const drawn = drawCover(ctx, primary, cw, ch, zoom, panX, panY, shakeX, shakeY);
  if (blendWith && blend > 0) {
    ctx.globalAlpha = clamp(blend, 0, 1);
    drawCover(ctx, blendWith, cw, ch, zoom, panX, panY);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.filter = "none";

  if (Math.abs(grade.temperature) > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = clamp(Math.abs(grade.temperature) * 0.35, 0, 0.2);
    ctx.fillStyle = grade.temperature > 0 ? "#FFB066" : "#7FA6D9";
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
  if (grade.vignette > 0.01) {
    const gradient = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, `rgba(0,0,0,${clamp(grade.vignette * 0.8, 0, 0.75)})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  drawCues(ctx, slot, localT, cw, ch);
  drawWatermark(ctx, plan, cw);
  return drawn;
}

export class BrowserProducer {
  private readonly plan: RenderPlan;
  private readonly sources: SourceClip[];
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly abort = new AbortController();
  private readonly cw: number;
  private readonly ch: number;
  private decks: Deck[] = [];
  private audioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private audioUrl: string | null = null;
  private recorderDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private rafId = 0;
  private activeIdx = 0;
  private paintedDeck: Deck | null = null;
  private framesDrawn = 0;
  private heldFrames = 0;
  private poster = "";
  private stopped = false;

  constructor(private readonly options: BrowserRenderOptions) {
    this.plan = options.plan;
    this.sources = options.sources;
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d", { alpha: false, willReadFrequently: false });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    const size =
      options.width && options.height ? { width: options.width, height: options.height } : outputSize(this.plan.aspect);
    this.cw = size.width;
    this.ch = size.height;
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    if (options.signal) {
      if (options.signal.aborted) this.abort.abort();
      options.signal.addEventListener("abort", () => this.abort.abort(), { once: true });
    }
  }

  private report(progress: number, label: string) {
    this.options.onProgress?.(clamp(progress, 0, 1), label);
  }

  private slotDeck(index: number): { deck: Deck; offset: number } {
    const slot = this.plan.slots[index];
    const deck = this.decks[index % this.decks.length];
    const usable = Math.max(0, deck.duration - slot.duration - 0.08);
    // Golden-ratio walk through each clip so repeated slots never reuse a frame.
    const ratio = ((index * 0.6180339887 + (slot.src_shot % 7) / 7) % 1);
    return { deck, offset: ratio * usable };
  }

  async prepare(): Promise<void> {
    if (!this.sources.length) throw new Error("Add at least one raw clip to produce a video.");
    const pool: Deck[] = [];
    this.sources.forEach((source, index) => {
      pool.push(new Deck(source.file, index));
      if (this.sources.length === 1) pool.push(new Deck(source.file, index));
    });
    await Promise.all(pool.map((deck) => deck.metadata().catch(() => undefined)));
    this.decks = pool.filter((deck) => deck.duration > 0.05);
    if (!this.decks.length) throw new Error("None of the selected clips could be decoded by this browser.");
    this.report(0.03, `${this.decks.length} deck${this.decks.length > 1 ? "s" : ""} armed`);
  }

  private async setupAudio(): Promise<void> {
    const file = this.options.bgAudio;
    if (!file) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      this.audioCtx = ctx;
      this.recorderDest = ctx.createMediaStreamDestination();
      this.audioUrl = URL.createObjectURL(file);
      const el = document.createElement("audio");
      el.src = this.audioUrl;
      el.loop = true;
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      this.audioEl = el;
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      source.connect(gain);
      gain.connect(this.recorderDest);
      if (this.options.record !== false) gain.connect(ctx.destination);
      await ctx.resume();
    } catch {
      this.audioEl = null;
    }
  }

  async run(): Promise<BrowserRenderResult> {
    const { plan, onProgress } = this.options;
    await this.prepare();
    await this.setupAudio();

    const slots = plan.slots;
    if (!slots.length) throw new Error("The scaler produced an empty timeline.");

    const first = this.slotDeck(0);
    await first.deck.seekTo(first.offset);
    await first.deck.play();
    this.activeIdx = 0;
    this.paintedDeck = first.deck;
    if (slots.length > 1) {
      const next = this.slotDeck(1);
      next.deck.seekTo(next.offset).catch(() => undefined);
    }

    const chunks: Blob[] = [];
    if (this.options.record !== false && typeof MediaRecorder !== "undefined") {
      const stream = this.canvas.captureStream(30);
      if (this.recorderDest) stream.addTrack(this.recorderDest.stream.getAudioTracks()[0]);
      this.recorder = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 5_000_000 });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      this.recorder.start(200);
    }

    await this.audioEl?.play().catch(() => undefined);
    const startedAt = performance.now();
    this.report(0.05, "Rolling timeline");

    return new Promise<BrowserRenderResult>((resolve, reject) => {
      const cleanup = () => {
        cancelAnimationFrame(this.rafId);
        this.decks.forEach((deck) => deck.pause());
        this.audioEl?.pause();
        if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;
        void this.audioCtx?.close().catch(() => undefined);
        this.audioCtx = null;
      };

      const finalise = () => {
        this.stopped = true;
        cleanup();
        const blob = chunks.length ? new Blob(chunks, { type: "video/webm" }) : null;
        resolve({
          url: blob ? URL.createObjectURL(blob) : null,
          blob,
          posterDataUrl: this.poster || this.canvas.toDataURL("image/jpeg", 0.7),
          durationSec: plan.target_duration_sec,
          width: this.cw,
          height: this.ch,
          framesDrawn: this.framesDrawn,
          heldFrames: this.heldFrames,
        });
      };

      const onRecorderStop = () => finalise();
      if (this.recorder) this.recorder.onstop = onRecorderStop;

      const activate = (index: number) => {
        const { deck, offset } = this.slotDeck(index);
        if (deck !== this.paintedDeck) {
          if (deck.ready) void deck.play();
          else void deck.seekTo(offset).then(() => deck.play());
        }
        const nextIndex = index + 1;
        if (nextIndex < slots.length) {
          const next = this.slotDeck(nextIndex);
          if (next.deck !== deck) next.deck.seekTo(next.offset).catch(() => undefined);
        }
        this.activeIdx = index;
      };

      const tick = () => {
        if (this.abort.signal.aborted) {
          cleanup();
          reject(new Error("Render cancelled"));
          return;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        const t = Math.min(elapsed, plan.target_duration_sec);
        let index = this.activeIdx;
        while (index < slots.length - 1 && t >= slots[index].end) index += 1;
        if (index !== this.activeIdx) activate(index);

        const slot = slots[index];
        if (slot) {
          const { deck } = this.slotDeck(index);
          const localT = Math.max(0, t - slot.start);
          const progress = clamp(localT / Math.max(0.001, slot.duration), 0, 1);
          const prev = index > 0 ? this.slotDeck(index - 1).deck : null;
          const fadeWindow = Math.min(0.22, slot.duration * 0.35);
          const blend = slot.transition === "fade" && prev && prev !== deck ? clamp(1 - localT / fadeWindow, 0, 1) : 0;
          const primary = deck.ready ? deck : this.paintedDeck ?? deck;
          if (primary !== deck) this.heldFrames += 1;
          const drew = paintFrame({
            ctx: this.ctx,
            plan,
            slot,
            localT,
            progress,
            primary: primary.video,
            blendWith: blend > 0 && prev ? prev.video : null,
            blend,
            cw: this.cw,
            ch: this.ch,
          });
          if (drew) this.paintedDeck = primary;
          this.framesDrawn += 1;
          if (!this.poster && t > 1.1) this.poster = this.canvas.toDataURL("image/jpeg", 0.72);
          onProgress?.(clamp(t / plan.target_duration_sec, 0, 1), `Rendering ${t.toFixed(1)}s / ${plan.target_duration_sec.toFixed(1)}s`);
        }

        if (t >= plan.target_duration_sec - 0.02) {
          if (this.recorder && this.recorder.state !== "inactive") {
            this.recorder.stop();
          } else {
            finalise();
          }
          return;
        }
        this.rafId = requestAnimationFrame(tick);
      };

      this.rafId = requestAnimationFrame(tick);
    });
  }

  dispose(): void {
    this.abort.abort();
    cancelAnimationFrame(this.rafId);
    this.decks.forEach((deck) => deck.dispose());
    this.audioEl?.pause();
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
  }
}

export { pickMime };
