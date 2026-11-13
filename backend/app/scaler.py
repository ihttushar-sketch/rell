"""Beat-elastic dynamic time scaling.

Python mirror of ``frontend/src/lib/scaler.ts``. The two implementations must
produce identical render plans for the same DNA and target duration — same
constants, same rounding (half-up, like JS ``toFixed``), same seeded PRNG.
``tests/test_scaler.py`` locks those invariants down.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Sequence

MIN_SLOT_SEC = 0.18
MIN_TARGET_SEC = 2.0
MAX_TARGET_SEC = 1800.0
MAX_SLOTS = 600
BEAT_SNAP_WINDOW_SEC = 0.04
MIN_PILLAR_SLOTS = 5

DEFAULT_PHASE_RATIOS = {"hook": 0.12, "pain": 0.20, "trigger": 0.45, "comment": 0.13, "outro": 0.10}
PHASE_KEYS = ("hook", "pain", "trigger", "comment", "outro")
MASK32 = 0xFFFFFFFF


def round_half_up(value: float, digits: int = 4) -> float:
    """Match JavaScript ``Number(value.toFixed(digits))`` for non-negative values."""
    factor = 10.0**digits
    scaled = value * factor
    if math.isnan(scaled) or math.isinf(scaled):
        return value
    rounded = math.floor(abs(scaled) + 0.5) / factor
    return rounded if scaled >= 0 else -rounded


def _imul(a: int, b: int) -> int:
    return ((a & MASK32) * (b & MASK32)) & MASK32


def mulberry32(seed: int) -> Callable[[], float]:
    """Deterministic 32-bit PRNG, identical to the TypeScript implementation."""
    state = seed & MASK32

    def next_value() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & MASK32
        t = state
        t = _imul(t ^ (t >> 15), t | 1)
        t &= MASK32
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & MASK32
        t &= MASK32
        return ((t ^ (t >> 14)) & MASK32) / 4294967296.0

    return next_value


def seed_from_string(value: str) -> int:
    """FNV-1a, matching the studio implementation."""
    h = 2166136261
    for char in value:
        h ^= ord(char) & MASK32
        h = _imul(h, 16777619)
    return h & MASK32


def normalize_ratios(dna: Dict[str, Any]) -> List[float]:
    rhythm = dna.get("rhythm") or {}
    raw_ratios = rhythm.get("phase_ratios") or {}
    raw = [float(raw_ratios.get(key, DEFAULT_PHASE_RATIOS[key]) or 0) for key in PHASE_KEYS]
    safe = [value if math.isfinite(value) and value > 0 else 0.0001 for value in raw]
    total = sum(safe) or 1.0
    return [value / total for value in safe]


def allocate_slots(ratios: Sequence[float], slot_count: int) -> List[int]:
    """Largest-remainder apportionment across the five retention pillars."""
    if slot_count <= 0:
        return [0, 0, 0, 0, 0]
    if slot_count < 5:
        priority = (0, 2, 1, 3, 4)
        short = [0, 0, 0, 0, 0]
        for index in range(slot_count):
            short[priority[index % len(priority)]] += 1
        return short
    total = sum(ratios) or 1.0
    exact = [(ratio / total) * slot_count for ratio in ratios]
    counts = [int(math.floor(value)) for value in exact]
    remaining = slot_count - sum(counts)
    order = sorted(range(len(exact)), key=lambda i: exact[i] - math.floor(exact[i]), reverse=True)
    cursor = 0
    while remaining > 0:
        counts[order[cursor % len(order)]] += 1
        remaining -= 1
        cursor += 1
    for index in range(len(counts)):
        if counts[index] != 0:
            continue
        # Donate from the richest pillar with a spare slot; never starve the hook.
        donor = -1
        for candidate in range(len(counts)):
            if candidate != index and counts[candidate] > 1 and (donor == -1 or counts[candidate] > counts[donor]):
                donor = candidate
        if donor >= 0:
            counts[donor] -= 1
            counts[index] += 1
    return counts


def allocate_short(ratios: Sequence[float], slot_count: int) -> List[int]:
    """Priority fill for very short outputs: hook first, then trigger."""
    return allocate_slots(ratios, slot_count)


def nearest_beat(beats: Sequence[float], target: float, window: float) -> Optional[float]:
    if not beats:
        return None
    lo, hi = 0, len(beats) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if beats[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    best: Optional[float] = None
    best_distance = math.inf
    for index in (lo - 1, lo):
        if 0 <= index < len(beats):
            distance = abs(beats[index] - target)
            if distance < best_distance:
                best_distance = distance
                best = beats[index]
    return best if best is not None and best_distance <= window else None


def build_beat_grid(bpm: float, duration: float) -> List[float]:
    if not math.isfinite(bpm) or bpm <= 0:
        return []
    step = 60.0 / bpm
    beats: List[float] = []
    index = 0
    while index * step <= duration + 1e-9:
        beats.append(round_half_up(index * step, 4))
        index += 1
    return beats


def motion_keys(motion: str) -> Dict[str, Any]:
    table = {
        "zoom_in": (1.0, 1.14, 0.0, 0.0),
        "zoom_out": (1.14, 1.0, 0.0, 0.0),
        "pan_left": (1.08, 1.08, -0.045, 0.0),
        "pan_right": (1.08, 1.08, 0.045, 0.0),
        "shake": (1.06, 1.10, 0.012, -0.008),
        "handheld": (1.03, 1.05, 0.008, 0.006),
        "static": (1.0, 1.0, 0.0, 0.0),
    }
    zoom_from, zoom_to, pan_x, pan_y = table.get(motion, table["static"])
    return {"from": zoom_from, "to": zoom_to, "pan": {"x": pan_x, "y": pan_y}}


def overlays_for(pillar: int, slot_index: int, duration: float) -> List[Dict[str, Any]]:
    if pillar == 4:
        return [
            {
                "kind": "text",
                "text": "Tell me in the comments",
                "at": round_half_up(duration * 0.22, 3),
                "duration": round_half_up(min(1.6, duration * 0.7), 3),
            }
        ]
    if pillar == 5:
        return [
            {"kind": "zoom_punch", "at": 0, "duration": round_half_up(min(0.3, duration * 0.3), 3)},
            {
                "kind": "highlight" if slot_index % 2 == 0 else "arrow",
                "at": round_half_up(duration * (0.35 if slot_index % 2 == 0 else 0.4), 3),
                "duration": round_half_up(min(0.9, duration * 0.55), 3) if slot_index % 2 == 0 else round_half_up(min(0.8, duration * 0.5), 3),
            },
        ]
    if pillar == 1 and slot_index % 3 == 0:
        return [{"kind": "zoom_punch", "at": 0, "duration": round_half_up(min(0.4, duration * 0.5), 3)}]
    return []


def _coerce_shots(dna: Dict[str, Any]) -> List[Dict[str, Any]]:
    shots = [shot for shot in (dna.get("shots") or []) if shot and float(shot.get("duration") or 0) > 0]
    return shots


def scale_framework(dna: Dict[str, Any], options: Dict[str, Any]) -> Dict[str, Any]:
    """Expand a Framework DNA into a full render plan for a target duration."""
    requested = options.get("target_duration_sec")
    try:
        target_value = float(requested)
    except (TypeError, ValueError):
        target_value = 0.0
    if not math.isfinite(target_value):
        target_value = 0.0
    target = min(MAX_TARGET_SEC, max(MIN_TARGET_SEC, target_value))

    shots = _coerce_shots(dna)
    source_duration = max(0.2, float(dna.get("duration_sec") or 0.2))
    total_shot_time = sum(float(shot["duration"]) for shot in shots) or 1.0
    rhythm = dna.get("rhythm") or {}
    avg_shot = float(rhythm.get("avg_shot_sec") or (total_shot_time / len(shots) if shots else 0.8))
    avg_shot = min(8.0, max(MIN_SLOT_SEC, avg_shot))

    slot_count = int(min(MAX_SLOTS, max(1, math.floor(target / avg_shot + 0.5))))
    max_by_length = int(math.floor(target / MIN_SLOT_SEC)) or 1
    slot_count = max(slot_count, min(MIN_PILLAR_SLOTS, max_by_length))
    slot_count = min(slot_count, max_by_length, MAX_SLOTS)

    ratios = normalize_ratios(dna)
    counts = allocate_slots(ratios, slot_count) if slot_count >= MIN_PILLAR_SLOTS else allocate_short(ratios, slot_count)

    rng = mulberry32(seed_from_string(f"{dna.get('id', '')}|{target:.3f}"))
    drafts: List[Dict[str, Any]] = []
    cursor = 0.0
    grade_default = dna.get("grade") or {"brightness": 0.0, "contrast": 1.0, "saturation": 1.0, "vignette": 0.0, "temperature": 0.0}

    for pillar_index, pillar in enumerate(range(1, 6)):
        count = counts[pillar_index]
        if not count:
            continue
        window = ratios[pillar_index] * target
        pillar_shots = [shot for shot in shots if int(shot.get("pillar") or 1) == pillar]
        ladder = pillar_shots or shots
        ladder_total = sum(float(shot["duration"]) for shot in ladder) or 1.0

        weights: List[float] = []
        for j in range(count):
            source = ladder[(j + pillar_index) % len(ladder)] if ladder else None
            base = (float(source["duration"]) / ladder_total) if source else 1.0 / count
            jitter = 1.0 + (rng() - 0.5) * 0.22
            weights.append(max(1e-4, base * jitter))
        weight_sum = sum(weights) or 1.0

        for j in range(count):
            duration = (weights[j] / weight_sum) * window
            source = ladder[(j + pillar_index) % len(ladder)] if ladder else None
            drafts.append(
                {
                    "pillar": pillar,
                    "src_shot": int(source.get("index", 0)) if source else 0,
                    "grade": dict(source.get("grade") or grade_default) if source else dict(grade_default),
                    "motion": (source or {}).get("motion", "static"),
                    "transition": (source or {}).get("transition", "cut"),
                    "focus": dict((source or {}).get("focus") or {"x": 0.0, "y": 0.0}),
                    "start": cursor,
                    "end": cursor + duration,
                }
            )
            cursor += duration

    if drafts:
        drafts[-1]["end"] = target

    bpm = float((dna.get("audio") or {}).get("bpm") or 0)
    beat_grid = build_beat_grid(bpm, target)
    starts: List[float] = [0.0]
    snapped = 0
    for index in range(1, len(drafts)):
        previous = starts[index - 1]
        raw = drafts[index]["start"]
        beat = nearest_beat(beat_grid, raw, BEAT_SNAP_WINDOW_SEC)
        cut = raw
        if beat is not None and beat - previous >= MIN_SLOT_SEC and drafts[index]["end"] - beat >= MIN_SLOT_SEC:
            cut = beat
            snapped += 1
        cut = max(cut, previous + MIN_SLOT_SEC)
        cut = min(cut, drafts[index]["end"] - min(MIN_SLOT_SEC, (drafts[index]["end"] - previous) / 2))
        starts.append(round_half_up(cut, 4))

    preserve_sfx = bool(options.get("preserve_sfx", True))
    slots: List[Dict[str, Any]] = []
    for index, draft in enumerate(drafts):
        start = starts[index]
        end = round_half_up(target, 4) if index == len(drafts) - 1 else starts[index + 1]
        duration = round_half_up(end - start, 4)
        if duration <= 0.001:
            continue
        keys = motion_keys(draft["motion"])
        sfx: List[Dict[str, Any]] = []
        if preserve_sfx:
            transition = draft["transition"]
            if transition == "whip":
                sfx.append({"t": round_half_up(start, 4), "type": "whoosh", "gain": -11})
            elif transition == "flash":
                sfx.append({"t": round_half_up(start, 4), "type": "hit", "gain": -9})
            elif transition == "glitch":
                sfx.append({"t": round_half_up(start, 4), "type": "glitch", "gain": -13})
            if draft["pillar"] == 3 and index % 8 == 0:
                sfx.append({"t": round_half_up(start, 4), "type": "riser", "gain": -15})
        slots.append(
            {
                "index": len(slots),
                "pillar": draft["pillar"],
                "start": round_half_up(start, 4),
                "end": end,
                "duration": duration,
                "src_shot": draft["src_shot"],
                "motion": draft["motion"],
                "zoom_from": keys["from"],
                "zoom_to": keys["to"],
                "pan": keys["pan"],
                "grade": draft["grade"],
                "transition": draft["transition"],
                "focus": draft["focus"],
                "overlays": overlays_for(draft["pillar"], index, duration),
                "sfx": sfx,
            }
        )

    pillar_names = {
        1: "Viral Hook",
        2: "Real Pain Point",
        3: "Interest & Sales Trigger",
        4: "Intent to Comment",
        5: "Motion Graphic Cues",
    }
    pillar_blocks = []
    for index, pillar in enumerate(range(1, 6)):
        in_pillar = [slot for slot in slots if slot["pillar"] == pillar]
        pillar_blocks.append(
            {
                "pillar": pillar,
                "name": pillar_names[pillar],
                "start": in_pillar[0]["start"] if in_pillar else round_half_up(sum(ratios[:index]) * target, 3),
                "end": in_pillar[-1]["end"] if in_pillar else round_half_up(sum(ratios[: index + 1]) * target, 3),
                "shot_count": len(in_pillar),
            }
        )

    loop_count = max(1, math.ceil(target / source_duration))
    crossfades: List[float] = []
    for i in range(1, loop_count):
        approximate = (i * source_duration) % target
        beat = nearest_beat(beat_grid, approximate, 0.25)
        crossfades.append(round_half_up(beat if beat is not None else approximate, 3))

    watermark = dict(
        dna.get("watermark")
        or {"text": "NEXUS FRAME", "position": "top-left", "x": 24, "y": 24, "color": "#E6EDF3", "opacity": 0.72}
    )
    watermark["position"] = "top-left"
    audio_dna = dna.get("audio") or {}
    source = dna.get("source") or {}

    return {
        "framework_id": dna.get("id", ""),
        "framework_name": dna.get("framework_name", "Untitled Framework"),
        "target_duration_sec": round_half_up(target, 3),
        "bpm": bpm,
        "beat_grid": beat_grid,
        "crossfade_points": crossfades,
        "slots": slots,
        "pillars": pillar_blocks,
        "stats": {
            "cuts": len(slots),
            "effective_bpm": round_half_up((len(slots) / target) * 60, 2),
            "avg_clip_duration": round_half_up(target / max(1, len(slots)), 3),
            "density": round_half_up(len(slots) / target, 3),
            "snapped_cuts": snapped,
            "loop_count": loop_count,
        },
        "audio": {
            "mode": options.get("bg_mode", "framework"),
            "preserve_sfx": preserve_sfx,
            "lufs": float(audio_dna.get("lufs") or -14),
        },
        "watermark": watermark,
        "aspect": options.get("aspect") or source.get("aspect") or "9:16",
    }
