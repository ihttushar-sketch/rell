# Architecture

## Runtime topology

```
┌───────────────────────────── browser ─────────────────────────────┐
│  Next.js 15 studio (App Router, client-heavy)                      │
│                                                                    │
│  ExtractorTab ──┐        ProduceTab ─────────┐     VaultTab        │
│                 │                            │                     │
│  analyzeVideoFile (Studio Lite DSP)          │  Scale + plan       │
│  audio.ts (FFT/BPM)                          │  renderEngine.ts    │
│                                              │  (dual decks,       │
│                                              │   canvas capture)   │
└──────────────────┼───────────────────────────┼─────────────────────┘
                   │ POST /api/analyze         │ POST /api/produce
                   │ GET  /api/jobs/:id        │ GET  /api/files/*
                   ▼                           ▼
      ┌──────────────────────────────────────────────────────────┐
      │ Next server rewrite  /api/*  →  NEXUS_BACKEND_URL        │
      └──────────────────────────┬───────────────────────────────┘
                                 ▼
      ┌──────────────────────────────────────────────────────────┐
      │ FastAPI production node                                  │
      │                                                          │
      │  main.py ── jobs.py (2 worker threads) ── progress/steps │
      │     │                                                    │
      │     ├─ analyzer.py → ffmpeg.py · clips.py · vision.py    │
      │     ├─ scaler.py  (parity with frontend/src/lib/scaler)  │
      │     ├─ renderer.py → ffmpeg.py (filtergraph)             │
      │     └─ store.py → SQLite vault                           │
      │                                                          │
      │  data/ uploads · stems · renders · nexus.db               │
      └──────────────────────────────────────────────────────────┘
```

The studio never calls `localhost` for the node: all browser traffic is origin-relative `/api/*` and proxied server-side by the Next rewrite, so the same build works behind any host/preview proxy.

## Analysis pipeline (`backend/app/analyzer.py`)

| Step | Key | What actually runs |
| --- | --- | --- |
| 1 | `ingest` | `probe()` → ffprobe JSON, or ffmpeg banner parsing (duration, WxH, fps, audio) |
| 2 | `scene` | ffmpeg rawvideo pipe → 160×90 frames; PySceneDetect `AdaptiveDetector(min_scene_len=8)` → ffmpeg `scdet` → histogram fallback |
| 3 | `visuals` | per shot: Farneback flow (magnitude, radial divergence for zoom, lateral mean for pans), Laplacian sharpness, luma/saturation/warmth → grade estimate, Haar face focus, transition guess (histogram + luma jump) |
| 4 | `audio` | ffmpeg 22.05 kHz mono WAV · librosa `beat_track` or numpy spectral-flux autocorrelation · EBU R128 loudness via `loudnorm=print_format=json` |
| 5 | `stems` | Demucs `htdemucs` → `vocals`, `drums` (SFX), `bass+other` mixed (BGM). Skipped cleanly if torch/demucs is absent |
| 6 | `build` | 5-pillar assignment by phase ratio, SFX events from onsets within ±70 ms of a cut, palette anchors, stats, portable JSON |

Optional hosted vision (`vision.py`) samples four keyframes and asks Gemini/OpenAI for style/tagging text; it is additive metadata and failures are logged, never fatal.

## Scaling (`scaler.ts` ⇄ `scaler.py`)

Deterministic, dependency-free, identical in both languages:

1. `slotCount = clamp(round(target / avgShot), 1, 600)` — density is a property of the reference, not the target.
2. Pillar time windows = normalised phase ratios × target. Slot counts apportioned by largest remainder; below five slots, allocation follows retention priority (`hook → trigger → pain → comment → outro`) so the hook is never starved.
3. Each pillar's slot durations cycle through that pillar's real reference cut ladder, with seeded jitter (mulberry32) to keep human texture.
4. Cut boundaries are snapped to the nearest beat inside a ±40 ms window, sequentially, respecting a 0.18 s minimum slot; the final cut is pinned to the exact target.
5. Slots carry motion keys (zoom from/to, pan), grade, transition, focus, overlay cues and SFX stings.

Parity is enforced by committed fixtures (`frontend/scripts/emit-fixtures.ts` → `backend/tests/fixtures/`) and `tests/test_parity.py`, which compares every slot's start/end/pillar/motion/transition/overlay/SFX/grade plus stats, beat grid and crossfade points.

## Rendering (`backend/app/renderer.py`)

- **Inputs**: each clip is opened once with `-stream_loop -1`; slots index into those inputs round-robin.
- **Per slot**: `trim` (VAD-bounded offset) → `setpts` → `fps` → cover `scale`+`crop` → `zoompan` (zoom/pan/focus/shake) → `eq` + `colorbalance` + `vignette` → per-cut fade accents → `format=yuv420p`.
- **Timeline**: single `concat` — exact durations, no drift. Fades are per-segment rather than overlapping `xfade` so a 30.000 s brief stays 30.000 s.
- **Brand**: `drawtext` watermark anchored at exactly `x=24:y=24`.
- **Audio**: BGM (and optional SFX / voiceover) → `sidechaincompress` ducking when voiceover is supplied → `amix` → `loudnorm I=-14`.
- **Encode**: `h264_nvenc`/`videotoolbox` when a **trial encode** proves the hardware path works, else `libx264`; AAC 192 kbps; `+faststart`.
- Graph is written to a file and passed with the version-appropriate flag (`-/filter_complex` on FFmpeg ≥ 8, `-filter_complex_script` on older builds).

## Job model

`jobs.py` runs work on a two-thread pool. Each job exposes `steps[]` (`pending|running|done|skipped|error`), a capped log tail and a `result`. The studio polls `GET /api/jobs/{id}` every ~700 ms and mirrors step progress into the pipeline panel. Requests return in milliseconds; renders never block the UI.

## Storage

| Path | Contents |
| --- | --- |
| `backend/data/uploads/` | reference + raw clips + BGM |
| `backend/data/stems/` | Demucs stems (vocals / bgm / sfx) |
| `backend/data/renders/` | MP4 outputs + posters + transient graph files |
| `backend/data/nexus.db` | SQLite vault (`frameworks` table, WAL) |

Everything is git-ignored. The browser keeps a localStorage mirror of the vault so the studio still works without a node.

## Security notes

- Media serving resolves paths under `DATA_DIR` and rejects traversal (tested).
- Uploads are size-capped (`NEXUS_MAX_UPLOAD_MB`) and streamed to disk.
- The node is intended for local/private networks; it has no authentication layer. Put it behind a reverse proxy with auth before exposing it publicly, and keep `NEXUS_YTDLP=off` if remote fetches are not wanted.
