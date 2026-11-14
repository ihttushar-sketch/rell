"""Scaler invariants and the 5-pillar retention contract."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.scaler import (
    BEAT_SNAP_WINDOW_SEC,
    MAX_SLOTS,
    MAX_TARGET_SEC,
    MIN_SLOT_SEC,
    MIN_TARGET_SEC,
    allocate_slots,
    build_beat_grid,
    mulberry32,
    scale_framework,
    seed_from_string,
)

FIXTURES = Path(__file__).parent / "fixtures"
FRAMEWORKS = sorted(FIXTURES.glob("framework_*.json"))


def load(path: Path) -> dict:
    return json.loads(path.read_text())


@pytest.mark.parametrize("path", FRAMEWORKS, ids=lambda p: p.stem)
@pytest.mark.parametrize("target", [5, 15, 30, 60, 120])
def test_duration_is_exact_and_monotonic(path: Path, target: float) -> None:
    framework = load(path)
    plan = scale_framework(framework, {"target_duration_sec": target, "bg_mode": "framework", "preserve_sfx": True})
    slots = plan["slots"]
    assert slots, "plan must contain slots"
    assert abs(sum(slot["duration"] for slot in slots) - target) < 0.001
    assert slots[-1]["end"] == round(target, 4)
    for index in range(1, len(slots)):
        assert slots[index]["start"] >= slots[index - 1]["end"] - 1e-6
    assert min(slot["duration"] for slot in slots) >= MIN_SLOT_SEC - 1e-3


@pytest.mark.parametrize("path", FRAMEWORKS, ids=lambda p: p.stem)
def test_all_pillars_present_on_realistic_durations(path: Path) -> None:
    framework = load(path)
    plan = scale_framework(framework, {"target_duration_sec": 30, "bg_mode": "framework", "preserve_sfx": True})
    assert {slot["pillar"] for slot in plan["slots"]} == {1, 2, 3, 4, 5}
    assert [block["pillar"] for block in plan["pillars"]] == [1, 2, 3, 4, 5]
    assert all(block["shot_count"] > 0 for block in plan["pillars"])


def test_density_preserved_not_stretched() -> None:
    framework = load(FRAMEWORKS[0])
    short = scale_framework(framework, {"target_duration_sec": 15})
    long = scale_framework(framework, {"target_duration_sec": 120})
    assert long["stats"]["cuts"] > short["stats"]["cuts"] * 4
    assert abs(short["stats"]["avg_clip_duration"] - long["stats"]["avg_clip_duration"]) < 0.15


def test_beat_snapping_within_window() -> None:
    framework = load(FRAMEWORKS[0])
    plan = scale_framework(framework, {"target_duration_sec": 45})
    beats = build_beat_grid(plan["bpm"], 45)
    snapped = 0
    for slot in plan["slots"][1:]:
        nearest = min(beats, key=lambda beat: abs(beat - slot["start"]))
        if abs(nearest - slot["start"]) <= BEAT_SNAP_WINDOW_SEC + 1e-6:
            snapped += 1
    assert snapped == plan["stats"]["snapped_cuts"]


def test_deterministic_and_seeded() -> None:
    framework = load(FRAMEWORKS[1])
    first = scale_framework(framework, {"target_duration_sec": 30})
    second = scale_framework(framework, {"target_duration_sec": 30})
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert mulberry32(seed_from_string("nexus"))() == mulberry32(seed_from_string("nexus"))()


def test_watermark_is_locked_top_left() -> None:
    plan = scale_framework(load(FRAMEWORKS[0]), {"target_duration_sec": 20})
    assert plan["watermark"]["position"] == "top-left"
    assert plan["watermark"]["x"] == 24 and plan["watermark"]["y"] == 24


def test_extreme_targets_are_clamped() -> None:
    framework = load(FRAMEWORKS[0])
    tiny = scale_framework(framework, {"target_duration_sec": 0.1})
    huge = scale_framework(framework, {"target_duration_sec": 10**6})
    assert tiny["target_duration_sec"] >= MIN_TARGET_SEC
    assert huge["target_duration_sec"] == MAX_TARGET_SEC
    assert len(huge["slots"]) <= MAX_SLOTS


def test_allocate_slots_never_starves_the_hook() -> None:
    ratios = [0.12, 0.20, 0.45, 0.13, 0.10]
    assert allocate_slots(ratios, 3)[0] >= 1
    counts = allocate_slots(ratios, 37)
    assert sum(counts) == 37
    assert all(value >= 1 for value in counts)


def test_sfx_preservation_flag() -> None:
    framework = load(FRAMEWORKS[0])
    with_sfx = scale_framework(framework, {"target_duration_sec": 30, "preserve_sfx": True})
    without = scale_framework(framework, {"target_duration_sec": 30, "preserve_sfx": False})
    assert sum(len(slot["sfx"]) for slot in with_sfx["slots"]) > 0
    assert sum(len(slot["sfx"]) for slot in without["slots"]) == 0
