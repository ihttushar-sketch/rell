/**
 * Audio DSP used by the browser Studio: PCM decoding, onset envelope,
 * tempo (BPM) estimation, beat tracking and a cheap "BGM/official mix" stem
 * approximation. The Python engine upgrades this to Demucs 3-stem separation;
 * the browser keeps the same JSON shape so a framework is portable either way.
 */

export interface AudioFingerprint {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats: number[];
  onsets: number[];
  rms: number;
  peak: number;
  lufs: number;
  envelope: number[]; // 0..1, ~60 samples/sec for the waveform strip
  envelopeHz: number;
}

/** Radix-2 in-place FFT (split-radix style iterative Cooley–Tukey). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function downsampleToMono(buffer: AudioBuffer, targetRate = 11025): { data: Float32Array; rate: number } {
  const rate = Math.min(targetRate, buffer.sampleRate);
  const step = buffer.sampleRate / rate;
  const length = Math.floor(buffer.length / step);
  const out = new Float32Array(length);
  const channels = Math.min(2, buffer.numberOfChannels);
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) chans.push(buffer.getChannelData(c));
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(i * step);
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += chans[c][idx] ?? 0;
    out[i] = sum / channels;
  }
  return { data: out, rate };
}

/** Spectral-flux onset envelope at ~86 fps (hop 128 @ 11 kHz). */
function onsetEnvelope(data: Float32Array, rate: number): { env: Float32Array; fps: number } {
  const frameSize = 1024;
  const hop = 128;
  const frames = Math.max(1, Math.floor((data.length - frameSize) / hop));
  const env = new Float32Array(frames);
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  let prevMag = new Float32Array(frameSize / 2);
  for (let f = 0; f < frames; f += 1) {
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i += 1) re[i] = (data[f * hop + i] ?? 0) * window[i];
    fft(re, im);
    let flux = 0;
    const mag = new Float32Array(frameSize / 2);
    for (let k = 1; k < frameSize / 2; k += 1) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      const diff = m - prevMag[k];
      if (diff > 0) flux += diff;
    }
    env[f] = flux;
    prevMag = mag;
  }
  // Normalise by local mean (adaptive) and clamp to 0..1.
  const fps = rate / hop;
  const smoothed = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const lo = Math.max(0, i - 12);
    const hi = Math.min(frames, i + 13);
    let mean = 0;
    for (let j = lo; j < hi; j += 1) mean += env[j];
    mean /= hi - lo || 1;
    smoothed[i] = Math.max(0, env[i] - mean);
  }
  let max = 0;
  for (let i = 0; i < frames; i += 1) max = Math.max(max, smoothed[i]);
  if (max > 0) for (let i = 0; i < frames; i += 1) smoothed[i] /= max;
  return { env: smoothed, fps };
}

function estimateTempo(env: Float32Array, fps: number): { bpm: number; phase: number } {
  // Autocorrelation over a 60–200 BPM search window.
  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 60) * fps);
  let bestLag = minLag;
  let bestScore = -Infinity;
  const scores: number[] = [];
  for (let lag = minLag; lag <= Math.min(maxLag, env.length - 1); lag += 1) {
    let score = 0;
    for (let i = 0; i + lag < env.length; i += 1) score += env[i] * env[i + lag];
    score /= env.length - lag;
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Prefer a tempo in the 90–150 pocket when the correlation is close.
  for (let lag = minLag; lag <= Math.min(maxLag, env.length - 1); lag += 1) {
    if (!scores[lag]) continue;
    const bpm = (60 * fps) / lag;
    if (bpm >= 90 && bpm <= 150 && scores[lag] > bestScore * 0.86) {
      bestLag = lag;
      bestScore = scores[lag];
      break;
    }
  }
  const bpm = Math.max(60, Math.min(200, (60 * fps) / bestLag));
  // Phase = offset of the strongest envelope peak modulo one beat.
  const beatFrames = Math.round((60 / bpm) * fps);
  let phaseFrame = 0;
  let bestPeak = -1;
  for (let i = 0; i < Math.min(env.length, beatFrames); i += 1) {
    if (env[i] > bestPeak) {
      bestPeak = env[i];
      phaseFrame = i;
    }
  }
  return { bpm: Number(bpm.toFixed(1)), phase: phaseFrame / fps };
}

function pickPeaks(env: Float32Array, fps: number, minGapSec: number): number[] {
  const out: number[] = [];
  const minGap = Math.round(minGapSec * fps);
  let last = -minGap;
  for (let i = 1; i < env.length - 1; i += 1) {
    if (env[i] > 0.18 && env[i] >= env[i - 1] && env[i] >= env[i + 1] && i - last >= minGap) {
      out.push(Number((i / fps).toFixed(3)));
      last = i;
    }
  }
  return out;
}

function buildBeats(bpm: number, phase: number, duration: number, env: Float32Array, fps: number): number[] {
  const period = 60 / bpm;
  const beats: number[] = [];
  // Anchor with the strongest peaks, then fill missed beats.
  const peaks = pickPeaks(env, fps, period * 0.35);
  let t = phase;
  while (t < duration) {
    const near = peaks.find((p) => Math.abs(p - t) <= 0.055);
    beats.push(Number((near ?? t).toFixed(3)));
    if (near) t = near + period;
    else t += period;
  }
  return beats;
}

export function analyzePcm(buffer: AudioBuffer): AudioFingerprint {
  const duration = buffer.duration;
  const { data, rate } = downsampleToMono(buffer);
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) {
    sumSquares += data[i] * data[i];
    peak = Math.max(peak, Math.abs(data[i]));
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, data.length));
  const lufs = rms > 0 ? Number((20 * Math.log10(rms) - 3.2).toFixed(1)) : -70;

  const { env, fps } = onsetEnvelope(data, rate);
  const { bpm, phase } = estimateTempo(env, fps);
  const beats = buildBeats(bpm, phase, duration, env, fps);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const onsets = pickPeaks(env, fps, 0.12);

  // Waveform strip: ~60 samples/sec from the raw signal for a stable visual.
  const envelopeHz = 60;
  const buckets = Math.max(1, Math.floor(duration * envelopeHz));
  const step = Math.max(1, Math.floor(data.length / buckets));
  const envelope: number[] = [];
  let envMax = 1e-9;
  for (let b = 0; b < buckets; b += 1) {
    let localPeak = 0;
    for (let i = b * step; i < Math.min(data.length, (b + 1) * step); i += 1) {
      localPeak = Math.max(localPeak, Math.abs(data[i]));
    }
    envelope.push(localPeak);
    envMax = Math.max(envMax, localPeak);
  }
  return {
    duration,
    bpm,
    beats,
    downbeats,
    onsets,
    rms,
    peak,
    lufs,
    envelope: envelope.map((v) => Number((v / envMax).toFixed(3))),
    envelopeHz,
  };
}

/** Decode any browser-supported audio/video container into an AudioBuffer. */
export async function decodeAudioFromBlob(blob: Blob): Promise<AudioBuffer> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }
}
