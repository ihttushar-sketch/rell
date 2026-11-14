"""Cross-engine parity: the Python scaler must match the TypeScript scaler.

Fixtures are produced by `npm run fixtures` in /frontend and committed, so CI
can verify the two engines without a Node toolchain.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.scaler import scale_framework

FIXTURES = Path(__file__).parent / "fixtures"
PLANS = sorted(FIXTURES.glob("plan_*.json"))


def test_fixtures_exist() -> None:
    assert len(PLANS) >= 6, "run `npm run fixtures` in frontend/ to regenerate"


@pytest.mark.parametrize("plan_path", PLANS, ids=lambda p: p.stem)
def test_python_matches_typescript_plan(plan_path: Path) -> None:
    expected = json.loads(plan_path.read_text())
    slug = plan_path.stem.removeprefix("plan_").rsplit("_", 1)[0]
    framework = json.loads((FIXTURES / f"framework_{slug}.json").read_text())

    actual = scale_framework(
        framework,
        {
            "target_duration_sec": expected["target_duration_sec"],
            "bg_mode": expected["audio"]["mode"],
            "preserve_sfx": expected["audio"]["preserve_sfx"],
        },
    )

    assert actual["target_duration_sec"] == expected["target_duration_sec"]
    assert actual["bpm"] == expected["bpm"]
    assert actual["beat_grid"] == expected["beat_grid"]
    assert actual["crossfade_points"] == expected["crossfade_points"]
    assert actual["stats"] == expected["stats"]
    assert len(actual["slots"]) == len(expected["slots"])
    assert actual["watermark"] == expected["watermark"]

    for got, want in zip(actual["slots"], expected["slots"]):
        assert got["start"] == want["start"], f"slot {got['index']} start drift"
        assert got["end"] == want["end"], f"slot {got['index']} end drift"
        assert got["duration"] == want["duration"]
        assert got["pillar"] == want["pillar"]
        assert got["src_shot"] == want["src_shot"]
        assert got["motion"] == want["motion"]
        assert got["transition"] == want["transition"]
        assert got["overlays"] == want["overlays"]
        assert got["sfx"] == want["sfx"]
        assert got["grade"] == want["grade"]

    for got, want in zip(actual["pillars"], expected["pillars"]):
        assert got == want
