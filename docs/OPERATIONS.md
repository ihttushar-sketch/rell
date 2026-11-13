# Operations

## Install matrix

| Goal | Command |
| --- | --- |
| Try the studio + node locally | `./scripts/setup.sh && ./scripts/dev.sh` |
| Add Demucs stems / librosa beats | `./scripts/setup.sh --ml` |
| Docker, CPU | `docker compose up --build` |
| Docker + ML, 1080p ceiling | `docker compose --profile ml up --build` |
| Verify everything | `./scripts/test.sh` |

Requirements: Python 3.11+, Node 20+, ~2 GB disk (core) or ~8 GB with torch. FFmpeg comes from the `imageio-ffmpeg` wheel, so no system install is required; a system `ffmpeg`/`ffprobe` is preferred automatically when present.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXUS_DATA_DIR` | `backend/data` | uploads, stems, renders, SQLite |
| `NEXUS_DB` | `<data>/nexus.db` | vault database path |
| `NEXUS_RENDER_MAX_DIM` | `1280` | output ceiling (1920 → 1080×1920) |
| `NEXUS_RENDER_FPS` | `30` | output frame rate |
| `NEXUS_RENDER_CRF` / `NEXUS_RENDER_PRESET` | `20` / `veryfast` | x264 quality/speed |
| `NEXUS_HWACCEL` | `auto` | `auto` probes nvenc/videotoolbox/qsv with a trial encode; `off` forces CPU |
| `NEXUS_MAX_UPLOAD_MB` | `512` | upload ceiling |
| `NEXUS_MAX_TARGET_SEC` | `1800` | target duration ceiling |
| `NEXUS_MAX_ANALYZE_SEC` | `300` | reserved for oversized reference guards |
| `NEXUS_YTDLP` | `on` | set `off` to disable remote ingestion |
| `NEXUS_FFMPEG` / `NEXUS_FFPROBE` | unset | explicit binary paths |
| `NEXUS_WATERMARK_FONT` | auto | `.ttf` for the drawtext mark (DejaVu/Arial auto-detected) |
| `NEXUS_VISION_PROVIDER` | `off` | `gemini` or `openai` |
| `NEXUS_VISION_API_KEY` | unset | enables the qualitative pass |
| `NEXUS_VISION_MODEL` | `gemini-2.5-pro` / `gpt-4o-mini` | model override |
| `NEXUS_BACKEND_URL` | `http://127.0.0.1:8000` | studio → node proxy target |
| `NEXUS_API_PORT` / `NEXUS_STUDIO_PORT` | `8000` / `3000` | dev ports |

Copy `.env.example` to `.env` for compose.

## GPU / performance

- **Hardware detection is honest**: `h264_nvenc` being *listed* by ffmpeg does not mean it works. The node performs a two-frame trial encode before reporting `hardware_accel`.
- CPU guidance (4 cores): a 30 s 720×1280 render with ~30 slots takes roughly 25–60 s. `zoompan` is the expensive filter; `NEXUS_RENDER_MAX_DIM=960` and `NEXUS_RENDER_PRESET=ultrafast` are good knobs for drafts.
- Browser capture runs in realtime: a 45 s edit takes ≈45 s. Keep the tab focused — background throttling stutters MediaRecorder.
- Demucs on CPU is the slowest step (≈1–3× realtime). Prefer the `ml` profile on a GPU host, or keep stems as a batch/offline step.

## Demo walkthrough (5 minutes)

1. Open the studio → **Framework Extractor**.
2. Drop a reference short (or leave it empty to inspect the seeded templates).
3. Press **Deconstruct reference**. With the node online you get PySceneDetect cuts, Demucs stems and a vision pass (if configured); with the node offline the browser engine runs its own DSP.
4. Name it → **Save framework to vault**.
5. Go to **Production House**, pick the framework, drop 1–4 raw clips.
6. Type `30` or `01:30`, keep `Framework BG`, leave `Preserve original framework transition SFX` checked.
7. Press **Produce video**. Watch the compiled timeline (cuts, beat grid, pillar bands) and the render log. Download MP4 (node) or WebM (studio).
8. Visit **Framework Vault** → inspect any blueprint → export JSON.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Studio badge says “Studio lite — in-browser DSP” although the node runs | Backend not reachable through the Next rewrite. Check `NEXUS_BACKEND_URL` and `curl localhost:3000/api/health` |
| `503 ffmpeg is not installed on this node` | Install system ffmpeg or `pip install imageio-ffmpeg` inside the venv |
| Render fails with `Unrecognized option 'filter_complex_script'` | FFmpeg ≥ 8 renamed the flag; the node detects `-/filter_complex` automatically — this means an older/newer exotic build; check `filter_script_flag()` |
| `Unrecognized option` / parse errors in the filtergraph | Upgrade to FFmpeg ≥ 4.4; the node writes chains with `;` separators (newlines alone are not separators) |
| Watermark missing in a custom build | drawtext needs libfreetype. Set `NEXUS_WATERMARK_FONT` to an existing TTF; without drawtext the node raises instead of silently shipping unbranded video |
| Demucs step is “skipped” | torch/demucs absent. Install `requirements-ml.txt`; frameworks stay `preview_only` until stems exist |
| URL ingestion fails | yt-dlp blocked, `NEXUS_YTDLP=off`, or the platform needs cookies. Download the file and upload it instead |
| Browser render is silent on templates | Templates ship without copyrighted music. The studio synthesises a licence-free preview bed; upload a custom BGM for client work |
| `413` on upload | Raise `NEXUS_MAX_UPLOAD_MB` or trim the clip |
| Video preview will not seek | The proxy must pass Range requests; the node already answers `206`. Check any intermediary proxy |

## Publishing a preview

Both services bind `0.0.0.0`. The studio is origin-relative and the Next config permits proxied dev origins (`allowedDevOrigins`), so it can be exposed behind a preview proxy as-is. The node has no auth: keep it private or front it with authenticated reverse-proxy rules, and never expose `NEXUS_VISION_API_KEY` to the browser.

## Backup / housekeeping

- Vault: `backend/data/nexus.db` (SQLite, WAL). Copy the `.db`, `-wal`, `-shm` files together or use `sqlite3 … ".backup"`.
- Blueprints are portable JSON; exporting them is the cheapest backup.
- `backend/data/uploads/` and `renders/` grow quickly. There is no automatic retention policy — add a cron job (`find … -mtime +14 -delete`) or clean via the node's storage path. Deleting uploads does not break existing frameworks (unless the blueprint is re-rendered with its own stems).
