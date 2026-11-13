/**
 * Deterministic preview audio bed.
 *
 * Template frameworks ship without copyrighted stems, so the studio can
 * synthesise a neutral, license-free percussion/bass bed at the framework's BPM
 * for preview renders. Real client work uses the Demucs-isolated BGM instead.
 */

export interface DemoTrack {
  file: File;
  url: string;
  bpm: number;
  durationSec: number;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

export function synthesizePreviewBed(bpm: number, bars = 8, variant: "dark" | "bright" = "dark"): DemoTrack {
  const sampleRate = 44100;
  const beat = 60 / Math.max(60, Math.min(200, bpm || 120));
  const barLength = beat * 4;
  const duration = barLength * bars;
  const total = Math.floor(duration * sampleRate);
  const samples = new Float32Array(total);
  const rng = (() => {
    let seed = 1337;
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  })();

  const bassPattern = variant === "dark" ? [55, 55, 73.42, 49] : [65.41, 65.41, 82.41, 58.27];

  for (let bar = 0; bar < bars; bar += 1) {
    const barStart = bar * barLength;
    for (let b = 0; b < 4; b += 1) {
      const kickAt = barStart + b * beat;
      // Kick: pitch-swept sine with fast decay.
      const kickSamples = Math.floor(0.3 * sampleRate);
      for (let i = 0; i < kickSamples; i += 1) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 16);
        const freq = 118 * Math.exp(-t * 26) + 42;
        const idx = Math.floor((kickAt + t) * sampleRate);
        if (idx >= total) break;
        samples[idx] += Math.sin(2 * Math.PI * freq * t) * env * 0.62;
      }
      // Off-beat hat.
      const hatAt = kickAt + beat / 2;
      const hatSamples = Math.floor(0.045 * sampleRate);
      for (let i = 0; i < hatSamples; i += 1) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 90);
        const idx = Math.floor((hatAt + t) * sampleRate);
        if (idx >= total) break;
        samples[idx] += (rng() * 2 - 1) * env * 0.11;
      }
    }
    // Bass: one note per bar, ducked under the kick.
    const note = bassPattern[bar % bassPattern.length];
    const startSample = Math.floor(barStart * sampleRate);
    const endSample = Math.min(total, Math.floor((barStart + barLength) * sampleRate));
    for (let i = startSample; i < endSample; i += 1) {
      const t = (i - startSample) / sampleRate;
      const local = (t % beat) / beat;
      const duck = 0.45 + 0.55 * Math.min(1, Math.abs(local - 0.15) * 4);
      const env = Math.min(1, t * 12) * Math.exp(-t * 0.7);
      samples[i] += Math.sin(2 * Math.PI * note * t) * env * 0.22 * duck;
    }
  }

  // Soft clip + normalise to roughly −14 LUFS territory.
  let peak = 0;
  for (let i = 0; i < total; i += 1) {
    samples[i] = Math.tanh(samples[i] * 1.15);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const gain = peak > 0 ? 0.72 / peak : 1;
  for (let i = 0; i < total; i += 1) samples[i] *= gain;

  const blob = encodeWav(samples, sampleRate);
  const file = new File([blob], `nexus-preview-${Math.round(bpm || 120)}bpm.wav`, { type: "audio/wav" });
  return { file, url: URL.createObjectURL(blob), bpm: bpm || 120, durationSec: duration };
}
