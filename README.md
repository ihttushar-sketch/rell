# NEXUS FRAME

**Automated video framework extraction & replication engine — a virtual production house.**
Observe any edited video → serialise its cut rhythm, stems, grade and retention map into a portable **Framework DNA** → replicate that framework against new footage at *any* requested duration.

```
 reference video ──▶ OBSERVE ──▶ Framework DNA (.json + stems)
                                      │
 new raw clips ────▶ REPLICATE ◀───────┘
                        │
                        └──▶ watermarked MP4 / WebM  (target duration: 15s · 45s · 02:00 …)
```

Built as a monorepo: a **Next.js 15 studio** (high-contrast dark UI) and a **FastAPI production node** (FFmpeg + OpenCV + PySceneDetect + Demucs + librosa). The studio also ships a server-less engine, so the whole workflow is testable in a browser without installing anything.

---

## বাংলা সারাংশ (quick summary)

এই রিপোজিটরিতে সম্পূর্ণ **NEXUS FRAME** সিস্টেম তৈরি করা হয়েছে — একটি ডার্ক-মোড প্রোডাকশন হাউস ড্যাশবোর্ড এবং একটি Python রেন্ডার ইঞ্জিন।

- **Framework Extractor:** যেকোনো রেফারেন্স ভিডিও (ফাইল বা URL) দিলে কাট টাইমস্ট্যাম্প, শট মোশন, কালার গ্রেড, BPM/বিট গ্রিড, ট্রানজিশন SFX এবং ৫-পিলার রিটেনশন ম্যাপ বের করে। নাম দিয়ে ভল্টে সেভ করতে হয়।
- **Production House:** সেভ করা ফ্রেমওয়ার্ক বেছে নিয়ে নতুন ক্লিপ দিন, শুধু **টার্গেট ডিউরেশন** লিখুন (যেমন `30`, `45s`, `02:00`) — ইঞ্জিন কাট সংখ্যা বাড়ায় কিন্তু শটের দৈর্ঘ্য টেনে লম্বা করে না; প্রতিটি কাট মিউজিক বিটের সাথে ±40ms এ স্ন্যাপ করে। উপরের-বাম কোণে (24:24) ওয়াটারমার্ক বাধ্যতামূলকভাবে বসে।
- **Vault:** ফ্রেমওয়ার্ক `.json` হিসেবে এক্সপোর্ট/ইমপোর্ট করা যায় — একই র-ফুটেজ থেকে অসংখ্য ভিন্ন স্টাইলের ভিডিও।
- চালাতে: `./scripts/setup.sh && ./scripts/dev.sh` → স্টুডিও `http://localhost:3000`, API ডকুমেন্টেশন `http://localhost:8000/docs`।

---

## Quick start

```bash
# 1. install (creates backend/.venv, installs Node deps, ffmpeg comes via PyPI)
./scripts/setup.sh                 # add --ml for Demucs + librosa (large download)

# 2. run both services
./scripts/dev.sh
#   studio  → http://localhost:3000
#   node    → http://localhost:8000/docs

# 3. verify
./scripts/test.sh                  # TypeScript engine + Python node + cross-engine parity
```

Docker:

```bash
docker compose up --build          # studio :3000, node :8000
# optional heavy stack (Demucs/librosa, 1080p ceiling): docker compose --profile ml up --build
```

First run needs no media: three frameworks (`Fast Hormozi Style`, `Dark Cinematic Doc`, `Luxury Apparel Cut`) are pre-seeded so the Production House can be exercised immediately.

---

## The two engines

The studio always works; capability is negotiated at boot via `GET /api/health`.

| Capability | Production node (Python/FFmpeg) | Studio Lite (browser) |
| --- | --- | --- |
| Reference ingest | file upload **+ yt-dlp URLs** (YouTube/Reels/TikTok) | local file only |
| Scene cuts | PySceneDetect `AdaptiveDetector` → ffmpeg `scdet` → histogram fallback | histogram distance + adaptive threshold |
| Motion classification | Farneback optical flow + radial divergence | centre/border frame differencing |
| Beats / BPM | librosa → numpy spectral-flux autocorrelation | WebAudio FFT onset envelope + autocorrelation |
| Audio stems | **Demucs htdemucs** → vocals / harmonic bed / transient SFX | reference mix (flagged `preview_only`) |
| Reframe | OpenCV Haar face tracking → per-shot focus offsets | centre crop |
| Dead-air trim | ffmpeg `silencedetect` on every raw clip | — |
| Render | deterministic FFmpeg filtergraph, 720×1280+, x264/NVENC | realtime canvas capture → WebM |
| Output | MP4 (H.264/AAC, −14 LUFS) | WebM (VP8/VP9 + Opus) |

Every optional dependency degrades explicitly: `GET /api/health` lists what is installed, the UI surfaces it, and analysis logs say which detector actually ran.

---

## The six upgrades, implemented

1. **3-stem audio surgery** — Demucs 4-stem output is recombined into `vocals`, `bgm` (bass + other) and `sfx` (drums). SFX events stay glued to cut behaviour when the BGM is swapped (`preserve_sfx`).
2. **Semantic shot & optical-flow matching** — Farneback flow classifies every shot (`zoom_in/out`, `pan_left/right`, `shake`, `handheld`, `static`); sharpness (Laplacian variance), motion energy and face focus are stored per shot and drive clip selection.
3. **Beat-elastic time scaling** — slot count grows with duration (`cut density` constant), pillar ratios preserved, every internal cut snapped to the nearest beat within ±40 ms, durations cycled from the reference's real cut ladder.
4. **5-pillar retention mapping** — `Viral Hook 12% / Pain Point 20% / Sales Trigger 45% / Intent to Comment 13% / Motion Cues 10%` (per-framework overridable). Motion-graphic cues (zoom punch, highlight, arrow, comment prompt) are emitted as timed overlay events.
5. **Auto-reframe to 9:16 / 16:9 / 1:1 / 4:5** — cover-crop plus detected focus offsets; browser and FFmpeg renderers honour the same `focus` vector.
6. **Zero-silence pre-trim (VAD)** — `silencedetect` on each supplied clip produces speech windows; the matcher only draws from those windows (dead air is excluded from the pool and reported in the render log). Toggleable per render (`trim_silence`) from the studio.

Plus the brand layer: watermark locked **top-left at 24:24** in both renderers, per-shot grade (`eq` / `colorbalance` / `vignette`), and loudness normalisation to −14 LUFS.

---

## Repository layout

```
frontend/                       Next.js 15 studio (App Router, Tailwind, Zustand)
  src/app/                      shell + page
  src/components/               ExtractorTab · ProduceTab · VaultTab · TimelineView · modals
  src/lib/
    types.ts                    Framework DNA + render plan contract
    scaler.ts                   beat-elastic scaler (mirrors backend/app/scaler.py)
    analyzer.ts                 in-browser deconstruction (frames + DSP)
    audio.ts                    WebAudio FFT, tempo, beat tracking
    renderEngine.ts             canvas compositor + MediaRecorder export
    demoAudio.ts                licence-free preview bed synthesis
    api.ts / store.ts           node client + vault state
    scaler.test.ts              engine invariants (node:test via tsx)
backend/
  app/main.py                   FastAPI routes (analyze, produce, vault, jobs, media)
  app/analyzer.py               deconstruction pipeline
  app/scaler.py                 beat-elastic scaler (parity-tested against TS)
  app/renderer.py               deterministic FFmpeg filtergraph builder
  app/clips.py                  VAD speech windows
  app/vision.py                 optional Gemini/OpenAI tagging
  app/jobs.py                   threaded job engine with steps/logs
  app/ffmpeg.py                 probing, progress parsing, drawtext watermark
  app/store.py                  SQLite production vault
  tests/                        pytest: scaler, parity, renderer, API, VAD (+ real render)
docs/                           ARCHITECTURE · FRAMEWORK_DNA · API · OPERATIONS
scripts/                        setup · dev · test
docker-compose.yml              studio + node (+ optional ML profile)
```

---

## API in one screen

```bash
GET  /api/health                     # capabilities, ffmpeg/demucs/vision status
GET  /api/frameworks                 # production vault
POST /api/frameworks                 # upsert a Framework DNA
POST /api/analyze   (multipart)      # file | url  -> job
POST /api/produce   (multipart)      # plan + clips (+ bgm) -> job
GET  /api/jobs/{id}                  # status, steps, logs, result
GET  /api/files/{path}               # Range-enabled media streaming
```

```bash
# observe
curl -X POST localhost:8000/api/analyze -F file=@reference.mp4 -F framework_name="Fast Hook v2"
# produce (plan comes from POST /api/frameworks/{id} + the scaler, or from the studio)
curl -X POST localhost:8000/api/produce \
  -F plan=@plan.json -F clips=@raw-1.mp4 -F clips=@raw-2.mp4 -F bg_audio=@bgm.wav
```

Full reference: [`docs/API.md`](docs/API.md).

---

## Testing

```bash
./scripts/test.sh
```

- **TypeScript (11 tests)** — duration parsing, exact totals, monotonic cuts, minimum slot length, all five pillars present, beat snapping, determinism, SFX preservation, hook starvation guard, template integrity.
- **Python (53 tests)** — the same invariants, plus **cross-engine parity** against committed fixtures (`npm run fixtures` regenerates them), FFmpeg filtergraph structure, watermark anchor at `24:24`, range streaming, traversal hardening, VAD windows, API contract, and a real 4-second render that is probed for duration/resolution.

---

## Honest limitations

- **Demucs is optional and heavy** (~2 GB with torch). Without it the node keeps the reference mix and flags the framework `preview_only: true`; the studio can synthesise a licence-free preview bed so renders stay audible.
- **Studio Lite cannot isolate stems** — separation is a model task, not a DSP trick. It analyses/renders, then hands off to the node for client-grade stems.
- **Browser export is realtime** (a 45 s edit takes ≈45 s to capture) and produces WebM. Use the node for MP4/FFmpeg renders.
- **The hosted vision pass is optional** and off by default; numeric analysis never depends on it.
- Remote URL ingestion requires network access from the *node* (yt-dlp + the platform itself), which may be blocked in restricted sandboxes.

---

## Licence & provenance

Original implementation written for this repository. Reference videos are processed locally; the node stores uploads/stems/renders under `backend/data/` (git-ignored). Only use the tool on footage you have the rights to replicate.

Stack: Next.js 15 · React 19 · Tailwind 3 · Zustand · Lucide · FastAPI · OpenCV · PySceneDetect · Demucs · librosa · FFmpeg.
