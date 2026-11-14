# Framework DNA — schema 1.0

A Framework DNA is the portable asset: one `.json` blueprint (+ optional audio stems) that fully describes an edit's rhythm, motion language, grade, audio grid and brand layer. It is the only input the Production House needs besides raw footage and a target duration.

Types live in two places that must stay in sync:

- `frontend/src/lib/types.ts` (TypeScript contract)
- `backend/app/schemas.py` (Pydantic validation)

## Top level

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `"1.0"` | bump on breaking changes |
| `id` | string | `fw_…`, unique vault key |
| `framework_name` | string | required, ≤120 chars — the vault key |
| `description` | string? | human note |
| `tags` | string[] | ≤8 slugs |
| `created_at` | ISO string | |
| `origin` | `server \| browser \| import` | which engine observed it |
| `source` | object | `{kind, label, width, height, fps, aspect}` |
| `duration_sec` | number | reference length |
| `audio` | object | see below |
| `shots[]` | Shot[] | the cut ladder |
| `pillars[]` | block[] | 5 retention windows |
| `rhythm` | object | `avg_shot_sec`, `cut_density`, `phase_ratios` |
| `grade` | Grade | average grade of the reference |
| `sfx_events[]` | event[] | cut-aligned stings (`t`, `type`, `gain`) |
| `watermark` | object | `{text, position:"top-left", x:24, y:24, color, opacity}` |
| `stats` | object | `cuts`, `avg_clip_duration`, `zoom_ratio`, `motion_energy` |

### `audio`

```json
{
  "bpm": 127.6,
  "beat_timestamps": [0.0, 0.47, 0.94, 1.411],
  "downbeats": [0.0, 1.881],
  "lufs": -23.3,
  "stems": { "vocals": "/api/files/stems/x-vocals.wav",
             "bgm":    "/api/files/stems/x-bgm.wav",
             "sfx":    "/api/files/stems/x-sfx.wav" },
  "preview_only": false
}
```

`preview_only: true` means stems were not isolated (browser analysis, or Demucs unavailable) and `stems` are null — the renderer then falls back to a synthesised/licensed bed.

### `shots[]`

```json
{
  "index": 3,
  "start": 2.56, "end": 3.85, "duration": 1.291,
  "motion": "zoom_in",
  "motion_energy": 0.62,
  "sharpness": 0.74,
  "transition": "flash",
  "effects": ["flash_frame", "high_motion"],
  "pillar": 3,
  "grade": { "brightness": 0.03, "contrast": 1.45,
             "saturation": 1.3, "vignette": 0.36, "temperature": -0.05 },
  "palette": ["#2C2D2D", "#656965"],
  "focus": { "x": 0.18, "y": -0.1, "detected": true }
}
```

- `motion`: `static | zoom_in | zoom_out | pan_left | pan_right | shake | handheld`
- `transition`: `cut | fade | whip | flash | glitch`
- `pillar`: `1…5`
- `focus`: active-speaker reframe offset normalised to the half-frame (−1…1); optional.

### `pillars[]`

```json
{ "pillar": 1, "name": "Viral Hook", "start": 0, "end": 3.6, "shot_count": 8 }
```

Default phase ratios: `hook 0.12 · pain 0.20 · trigger 0.45 · comment 0.13 · outro 0.10`. Override per framework to model different formats (e.g. a 60-second VSL).

## Render plan (derived, never stored)

`scaleFramework(dna, {target_duration_sec, bg_mode, preserve_sfx, aspect})` returns:

```json
{
  "framework_id": "fw_hormozi_fast",
  "target_duration_sec": 45,
  "bpm": 128,
  "beat_grid": [0, 0.469, 0.938],
  "crossfade_points": [30.0],
  "slots": [{
    "index": 0, "pillar": 1, "start": 0, "end": 0.72, "duration": 0.72,
    "src_shot": 0, "motion": "zoom_in",
    "zoom_from": 1.0, "zoom_to": 1.14, "pan": {"x": 0, "y": 0},
    "focus": {"x": 0, "y": 0},
    "grade": { "...": 0 },
    "transition": "cut",
    "overlays": [{"kind": "zoom_punch", "at": 0, "duration": 0.36}],
    "sfx": [{"t": 0.72, "type": "whoosh", "gain": -11}]
  }],
  "stats": { "cuts": 72, "effective_bpm": 96.0, "avg_clip_duration": 0.625,
             "density": 1.6, "snapped_cuts": 61, "loop_count": 2 },
  "audio": { "mode": "framework", "preserve_sfx": true, "lufs": -13.5 },
  "watermark": { "text": "NEXUS FRAME", "position": "top-left",
                 "x": 24, "y": 24, "color": "#E6EDF3", "opacity": 0.72 },
  "aspect": "9:16"
}
```

## Invariants (enforced by tests)

1. `Σ slot.duration == target_duration_sec` (to 1e-3) and the last slot ends exactly at the target.
2. Slots are monotonic; no slot is shorter than `0.18 s` unless the whole target is shorter.
3. Cut density is preserved: a 4× longer brief yields ≈4× more cuts, *not* 4× longer shots.
4. All five pillars appear for targets that can afford five slots.
5. Every internal cut within ±40 ms of a beat is snapped; the reported `snapped_cuts` matches reality.
6. Scaling is a pure function — same DNA + same options = byte-identical plan (seeded PRNG).
7. Watermark position is always `top-left` at `24:24`; both validators force it.
8. TS and Python produce identical plans for the same inputs (`backend/tests/test_parity.py`).

## Portability

```bash
# export from the vault
curl -s localhost:8000/api/frameworks/fw_hormozi_fast > hormozi.json

# import elsewhere
curl -X POST localhost:8000/api/frameworks/import \
  -H 'content-type: application/json' \
  -d "{\"frameworks\":[$(cat hormozi.json)]}"
```

Stems are referenced by relative `/api/files/...` URLs: if you move a blueprint between machines, include the stem files (or accept `preview_only` behaviour).
