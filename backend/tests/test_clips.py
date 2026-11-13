"""Voice-activity trimming used by the smart clip matcher."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.capabilities import ffmpeg_binary
from app.clips import speech_windows
from app.ffmpeg import probe


@pytest.fixture()
def clip_with_silence(tmp_path: Path) -> Path:
    binary = ffmpeg_binary()
    if not binary:
        pytest.skip("ffmpeg unavailable")
    path = tmp_path / "speech-and-dead-air.mp4"
    subprocess.run(
        [
            binary, "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=25:duration=6",
            "-f", "lavfi", "-i",
            "aevalsrc='if(lt(mod(t,3),1.2),0.35*sin(2*PI*440*t),0)':s=44100:d=6",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", "-y", str(path),
        ],
        check=True,
        timeout=180,
    )
    return path


def test_speech_windows_drop_dead_air(clip_with_silence: Path) -> None:
    media = probe(str(clip_with_silence))
    windows = speech_windows(str(clip_with_silence), media)
    assert windows, "must return at least one window"
    assert len(windows) >= 2, f"expected multiple speech bursts, got {windows}"
    covered = sum(end - start for start, end in windows)
    assert covered < media.duration - 0.8, "silence must be excluded from the pool"
    for start, end in windows:
        assert 0 <= start < end <= media.duration + 0.1


def test_silent_or_audio_less_clip_falls_back_to_full_window(tmp_path: Path) -> None:
    binary = ffmpeg_binary()
    if not binary:
        pytest.skip("ffmpeg unavailable")
    path = tmp_path / "silent.mp4"
    subprocess.run(
        [
            binary, "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=160x284:rate=25:duration=2",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", str(path),
        ],
        check=True,
        timeout=120,
    )
    media = probe(str(path))
    windows = speech_windows(str(path), media)
    assert windows == [(0.0, media.duration)] or windows[0][0] == 0.0
