"""Retention-map guarantees produced by the analysis stage."""

from __future__ import annotations

from app.analyzer import assign_pillars

RATIOS = {"hook": 0.12, "pain": 0.20, "trigger": 0.45, "comment": 0.13, "outro": 0.10}


def _shots(durations):
    shots = []
    cursor = 0.0
    for duration in durations:
        shots.append({"index": len(shots), "start": round(cursor, 3), "end": round(cursor + duration, 3), "duration": duration, "pillar": 0})
        cursor += duration
    return shots


def _counts(shots):
    return {pillar: sum(1 for s in shots if s["pillar"] == pillar) for pillar in range(1, 6)}


def test_every_pillar_is_populated_above_five_shots():
    shots = _shots([0.9] * 6)
    assign_pillars(shots, RATIOS)
    counts = _counts(shots)
    assert sum(counts.values()) == 6
    assert min(counts.values()) >= 1, counts
    # trigger is the widest phase and must dominate
    assert counts[3] == max(counts.values())


def test_bands_are_contiguous_and_monotonic():
    shots = _shots([0.5] * 40)
    assign_pillars(shots, RATIOS)
    pillars = [shot["pillar"] for shot in shots]
    assert pillars == sorted(pillars), "pillar order must follow the timeline"
    assert set(pillars) == {1, 2, 3, 4, 5}


def test_short_timeline_keeps_the_hook_first():
    shots = _shots([1.0, 1.0, 1.0])
    assign_pillars(shots, RATIOS)
    assert [shot["pillar"] for shot in shots] == [1, 2, 3], "bands stay ordered and the hook opens the edit"


def test_hook_is_never_starved():
    for count in (5, 7, 11, 19, 40):
        shots = _shots([0.4] * count)
        assign_pillars(shots, RATIOS)
        assert _counts(shots)[1] >= 1, count


def test_positions_are_preserved():
    shots = _shots([1.2] * 10)
    starts = [shot["start"] for shot in shots]
    assign_pillars(shots, RATIOS)
    assert [shot["start"] for shot in shots] == starts
