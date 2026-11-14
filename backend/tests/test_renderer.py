"""Filtergraph and render-engine guarantees."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from app import renderer
from app.capabilities import ffmpeg_binary
from app.ffmpeg import probe, watermark_filter
from app.jobs import Job, JobStep
from app.renderer import RenderInputs, build_filtergraph, output_size, render_plan
from app.scaler import scale_framework

FIXTURES = Path(__file__).parent / "fixtures"
FRAMEWORK = json.loads((FIXTURES / "framework_hormozi_fast.json").read_text())


def make_plan(target: float = 10.0) -> dict:
    return scale_framework(FRAMEWORK, {"target_duration_sec": target, "bg_mode": "framework", "preserve_sfx": True})


def make_job() -> Job:
    return Job(id="test", kind="produce", steps=[JobStep(key=k, label=k) for k in ("prepare", "graph", "render", "finalize")])


def test_watermark_is_anchored_at_24_24() -> None:
    for width in (540, 720, 1080, 1920):
        filt = watermark_filter(width)
        assert filt.startswith("drawtext=")
        assert "x=24" in filt and "y=24" in filt
        assert "text='NEXUS FRAME'" in filt
        assert "fontcolor=0xE6EDF3" in filt


def test_output_sizes_follow_the_aspect_ratio() -> None:
    for aspect, expected_ratio in (("9:16", 9 / 16), ("16:9", 16 / 9), ("1:1", 1.0), ("4:5", 0.8)):
        width, height = output_size(aspect)
        assert width % 2 == 0 and height % 2 == 0
        assert abs((width / height) - expected_ratio) < 0.02


@pytest.fixture()
def sample_clip(tmp_path: Path) -> Path:
    binary = ffmpeg_binary()
    if not binary:
        pytest.skip("ffmpeg unavailable")
    clip = tmp_path / "clip.mp4"
    subprocess.run(
        [
            binary, "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30:duration=4",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", str(clip),
        ],
        check=True,
        timeout=180,
    )
    return clip


def test_filtergraph_structure(sample_clip: Path) -> None:
    plan = make_plan(10)
    graph, total = build_filtergraph(
        plan,
        RenderInputs(clips=[probe(str(sample_clip))], bg_audio=None, sfx_audio=None),
        270,
        480,
        30,
    )
    assert total == plan["target_duration_sec"]
    assert graph.count("concat=n=") == 1
    assert "zoompan=z=" in graph
    assert "eq=contrast=" in graph
    assert "vignette=" in graph
    assert "drawtext=" in graph and "x=24:y=24" in graph
    assert "loudnorm=I=-14" in graph
    assert "anullsrc" in graph
    # Chains must be ';' separated — newlines alone are not separators for FFmpeg.
    assert graph.count(";") >= len(plan["slots"])
    assert graph.count("[v0]") == 2  # produced by chain 0, consumed by concat


def test_sidechain_ducking_when_voiceover_present(sample_clip: Path) -> None:
    plan = make_plan(6)
    graph, _ = build_filtergraph(
        plan,
        RenderInputs(clips=[probe(str(sample_clip))], bg_audio="/tmp/bgm.wav", sfx_audio=None, voice_audio="/tmp/voice.wav"),
        270,
        480,
        30,
    )
    assert "sidechaincompress" in graph
    assert "amix=inputs=2" in graph


def test_render_produces_a_watermarked_mp4(tmp_path: Path, sample_clip: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    if not ffmpeg_binary():
        pytest.skip("ffmpeg unavailable")
    monkeypatch.setattr(renderer, "RENDER_MAX_DIM", 480)
    monkeypatch.setattr(renderer, "RENDER_DIR", tmp_path)
    plan = make_plan(4)
    result = render_plan(make_job(), plan, [str(sample_clip)], options={"quality": "draft"})
    output = tmp_path / Path(result["video_url"]).name
    assert output.exists() and output.stat().st_size > 10_000
    info = probe(str(output))
    assert info.width % 2 == 0 and info.height % 2 == 0
    assert 3.5 <= info.duration <= 4.6
    assert abs(info.duration - plan["target_duration_sec"]) < 0.3
