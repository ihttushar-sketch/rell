"""Raw-clip intelligence: voice-activity trimming for the smart matcher.

Before a raw clip is cut into slots, dead air is removed from the selection
pool with FFmpeg's ``silencedetect``. The renderer then only draws from
speech-bearing windows, so a five-minute talking-head clip cannot contribute
three seconds of breathing and room tone to a 30-second edit.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import List, Tuple

from .capabilities import ffmpeg_binary
from .ffmpeg import MediaInfo

_SILENCE_START = re.compile(r"silence_start:\s*(-?[0-9.]+)")
_SILENCE_END = re.compile(r"silence_end:\s*(-?[0-9.]+)")

Window = Tuple[float, float]


def speech_windows(path: str, media: MediaInfo, *, noise_db: int = -35, min_silence: float = 0.28) -> List[Window]:
    """Invert ``silencedetect`` output into speech intervals.

    Returns the whole clip as one window when it has no audio, when detection
    fails, or when the clip is basically continuous speech.
    """
    fallback: List[Window] = [(0.0, max(0.2, media.duration or 0.2))]
    binary = ffmpeg_binary()
    if not binary or not media.has_audio or media.duration <= 0.5:
        return fallback
    try:
        result = subprocess.run(
            [
                binary,
                "-hide_banner",
                "-nostdin",
                "-loglevel",
                "info",
                "-i",
                path,
                "-vn",
                "-af",
                f"silencedetect=noise={noise_db}dB:d={min_silence:.2f}",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=max(60, int(media.duration * 3)),
        )
    except (OSError, subprocess.SubprocessError):
        return fallback

    silences: List[Window] = []
    start: float | None = None
    for line in result.stderr.splitlines():
        start_match = _SILENCE_START.search(line)
        if start_match:
            start = max(0.0, float(start_match.group(1)))
            continue
        end_match = _SILENCE_END.search(line)
        if end_match and start is not None:
            silences.append((start, float(end_match.group(1))))
            start = None
    if start is not None:
        silences.append((start, media.duration))

    windows: List[Window] = []
    cursor = 0.0
    for silence_start, silence_end in sorted(silences):
        if silence_start - cursor >= 0.18:
            windows.append((cursor, silence_start))
        cursor = max(cursor, silence_end)
    if media.duration - cursor >= 0.18:
        windows.append((cursor, media.duration))
    return windows or fallback


__all__ = ["speech_windows", "Window"]
