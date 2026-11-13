# Production node API

Base URL: `http://localhost:8000` (studio proxies `/api/*` to it). Interactive docs: `/docs`.

All media URLs returned are **relative** (`/api/files/...`); resolve them against the studio origin so they work through any proxy.

## `GET /api/health`

```json
{
  "engine": "server",
  "version": "1.0.0",
  "ffmpeg": true,
  "ffmpeg_path": "/usr/bin/ffmpeg",
  "ffprobe": true,
  "ytdlp": true,
  "opencv": true,
  "scenedetect": true,
  "demucs": false,
  "librosa": false,
  "hardware_accel": null,
  "vision": null,
  "vault_count": 3,
  "max_target_sec": 1800,
  "notes": ["Demucs missing: 3-stem separation is skipped…"]
}
```

The studio calls this on boot: a non-200 or unreachable node switches the UI to Studio Lite and disables URL ingestion and node rendering.

## Vault

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/api/frameworks` | — | `{frameworks: FrameworkDna[]}` |
| POST | `/api/frameworks` | FrameworkDna | `201` + stored DNA (upsert by `id`) |
| GET | `/api/frameworks/{id}` | — | DNA or `404` |
| DELETE | `/api/frameworks/{id}` | — | `{ok:true,id}` or `404` |
| POST | `/api/frameworks/import` | `{frameworks:[…]}` or a single DNA | `{frameworks, errors}` |

Validation errors return `422` with a Pydantic message. A framework with no shots or a blank name is rejected.

## `POST /api/analyze`

`multipart/form-data`:

| Field | Type | Notes |
| --- | --- | --- |
| `file` | video file | optional if `url` present |
| `url` | string | yt-dlp compatible; requires `ytdlp: true` |
| `framework_name` | string | defaults to the filename stem |

Returns a **job** immediately:

```json
{
  "id": "9e2efb762c21",
  "kind": "analyze",
  "status": "queued",
  "progress": 0,
  "steps": [
    {"key": "ingest", "label": "Ingest & probe", "status": "pending", "progress": 0, "detail": ""},
    {"key": "scene",  "label": "Scene cut detection", "status": "pending", "progress": 0, "detail": ""},
    {"key": "visuals","label": "Motion, grade & effect extraction", "...": "..."},
    {"key": "audio",  "label": "Audio fingerprint & beat grid", "...": "..."},
    {"key": "stems",  "label": "3-stem audio isolation", "...": "..."},
    {"key": "build",  "label": "Five-pillar retention mapping", "...": "..."}
  ],
  "logs": [],
  "result": null
}
```

On completion `result` is:

```json
{
  "framework": { "…Framework DNA…": true },
  "stems": {"vocals": "/api/files/stems/…-vocals.wav", "bgm": "…", "sfx": "…"},
  "method": {"scene": "PySceneDetect/AdaptiveDetector", "beats": "librosa"}
}
```

The framework is persisted to the vault automatically.

## `POST /api/produce`

`multipart/form-data`:

| Field | Type | Notes |
| --- | --- | --- |
| `plan` | JSON string | RenderPlan (from the scaler) |
| `clips` | file[] | repeat the field, up to 12 |
| `clip_urls` | JSON array string | alternative to files, requires yt-dlp |
| `bg_audio` | file | framework BGM or custom track |
| `sfx_audio` | file | optional SFX stem |
| `voice_audio` | file | optional voiceover → sidechain-ducked music |
| `options` | JSON string | `{quality: "draft|standard|high", trim_silence: true}` — dead-air trimming is on by default |

`result` on success:

```json
{
  "video_url": "/api/files/renders/nexus-abc123.mp4",
  "poster_url": "/api/files/renders/nexus-abc123.jpg",
  "duration_sec": 8.0,
  "width": 720,
  "height": 1280,
  "bytes": 4937525,
  "engine": "ffmpeg",
  "hardware_accel": null,
  "plan": { "…echo of the plan…" }
}
```

Output size follows the plan aspect with a 1280 px ceiling by default (`NEXUS_RENDER_MAX_DIM`). The MP4 is H.264/AAC, `+faststart`, audio normalised to −14 LUFS, watermark burned in at `24:24`.

## `GET /api/jobs/{id}`

Job snapshot. `status ∈ queued | running | done | error`. `steps[].status ∈ pending | running | done | skipped | error`. `logs` is the tail (≤120 lines). Poll every ~0.5–1 s.

## `GET /api/files/{path}`

Range-enabled static media. `206` with `Content-Range` for partial requests (video seeking depends on this). Paths are confined to the data directory; traversal returns `404`.

## Errors

```json
{ "detail": "Invalid render plan: 1 validation error …" }
```

| Code | Meaning |
| --- | --- |
| 400 | empty upload |
| 413 | upload above `NEXUS_MAX_UPLOAD_MB` |
| 422 | bad form field / invalid DNA / invalid plan / no clips |
| 503 | node has no ffmpeg binary |

## Timeouts & limits

- Analyze: 2 worker threads; one reference at a time per worker.
- Render: `timeout = max(600 s, target × 30)`; GPU/NVENC is used automatically when a trial encode succeeds.
- Target duration ceiling: `NEXUS_MAX_TARGET_SEC` (default 1800 s) — the scaler also clamps.
