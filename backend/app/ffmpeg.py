"""FFmpeg/FFprobe primitives: probing, progress-aware execution, drawtext helpers."""

from __future__ import annotations

import functools
import json
import logging
import os
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Sequence

from .capabilities import ffmpeg_binary, ffprobe_binary, hardware_accel

logger = logging.getLogger("nexus.ffmpeg")

ProgressCallback = Callable[[float, str], None]


class FFmpegError(RuntimeError):
    """Raised when an ffmpeg invocation fails; carries the tail of stderr."""

    def __init__(self, message: str, stderr: str = "") -> None:
        super().__init__(message)
        self.stderr = stderr


@dataclass
class MediaInfo:
    path: str
    duration: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 0.0
    has_video: bool = False
    has_audio: bool = False
    sample_rate: int = 0
    channels: int = 0
    codec: str = ""
    bit_rate: int = 0
    rotation: int = 0
    raw: dict = field(default_factory=dict)

    @property
    def aspect(self) -> str:
        if not self.width or not self.height:
            return "9:16"
        ratio = self.width / self.height
        if ratio > 1.2:
            return "16:9"
        if abs(1 - ratio) < 0.08:
            return "1:1"
        if ratio < 0.72:
            return "9:16"
        return "4:5"


def require_ffmpeg() -> str:
    binary = ffmpeg_binary()
    if not binary:
        raise FFmpegError(
            "ffmpeg is not installed on this node. Install system ffmpeg or `pip install imageio-ffmpeg`."
        )
    return binary


_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_VIDEO_RE = re.compile(r"Stream #\d+:\d+.*?: Video:.*?(\d{2,5})x(\d{2,5})")
_FPS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*fps")
_AUDIO_RE = re.compile(r"Stream #\d+:\d+.*?: Audio: ([a-zA-Z0-9_]+).*?(\d+)\s*Hz,\s*([a-z0-9]+)")
_CODEC_RE = re.compile(r"Video:\s*([a-zA-Z0-9_]+)")


def _probe_with_ffprobe(path: str) -> MediaInfo | None:
    binary = ffprobe_binary()
    if not binary:
        return None
    try:
        result = subprocess.run(
            [
                binary, "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", path,
            ],
            capture_output=True,
            text=True,
            timeout=45,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    info = MediaInfo(path=path, raw=payload)
    fmt = payload.get("format") or {}
    info.duration = _safe_float(fmt.get("duration"))
    info.bit_rate = int(_safe_float(fmt.get("bit_rate")))
    for stream in payload.get("streams") or []:
        if stream.get("codec_type") == "video" and not info.has_video:
            info.has_video = True
            info.width = int(stream.get("width") or 0)
            info.height = int(stream.get("height") or 0)
            info.codec = stream.get("codec_name") or ""
            info.fps = _fps_from_ratio(stream.get("avg_frame_rate")) or _fps_from_ratio(stream.get("r_frame_rate"))
            info.rotation = _rotation_of(stream)
        elif stream.get("codec_type") == "audio" and not info.has_audio:
            info.has_audio = True
            info.sample_rate = int(stream.get("sample_rate") or 0)
            info.channels = int(stream.get("channels") or 0)
    if info.rotation in (90, 270):
        info.width, info.height = info.height, info.width
    return info


def _fps_from_ratio(value: str | None) -> float:
    if not value or "/" not in value:
        return 0.0
    num, den = value.split("/", 1)
    try:
        numerator, denominator = float(num), float(den)
    except ValueError:
        return 0.0
    return round(numerator / denominator, 3) if denominator else 0.0


def _rotation_of(stream: dict) -> int:
    rotation = stream.get("tags", {}).get("rotate")
    if rotation is not None:
        try:
            return int(rotation) % 360
        except (TypeError, ValueError):
            return 0
    for side_data in stream.get("side_data_list") or []:
        if "rotation" in side_data:
            try:
                return int(side_data["rotation"]) % 360
            except (TypeError, ValueError):
                return 0
    return 0


def _safe_float(value: object) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def probe(path: str | Path) -> MediaInfo:
    """Probe a media file, preferring ffprobe and falling back to ffmpeg's banner."""
    path = str(path)
    info = _probe_with_ffprobe(path)
    if info and info.width and info.duration:
        return info

    binary = require_ffmpeg()
    result = subprocess.run([binary, "-hide_banner", "-i", path], capture_output=True, text=True, timeout=60)
    stderr = result.stderr
    info = info or MediaInfo(path=path)
    match = _DURATION_RE.search(stderr)
    if match:
        hours, minutes, seconds = match.groups()
        info.duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    video = _VIDEO_RE.search(stderr)
    if video:
        info.has_video = True
        info.width, info.height = int(video.group(1)), int(video.group(2))
    fps = _FPS_RE.search(stderr)
    if fps:
        info.fps = float(fps.group(1))
    codec = _CODEC_RE.search(stderr)
    if codec:
        info.codec = codec.group(1)
    audio = _AUDIO_RE.search(stderr)
    if audio:
        info.has_audio = True
        info.channels = {"mono": 1, "stereo": 2}.get(audio.group(3), 2)
        info.sample_rate = int(audio.group(2))
    if not info.fps:
        info.fps = 30.0
    return info


def run_ffmpeg(
    args: Sequence[str],
    *,
    total_duration: float = 0.0,
    on_progress: ProgressCallback | None = None,
    timeout: float | None = None,
    label: str = "ffmpeg",
) -> str:
    """Run ffmpeg with machine-readable progress. Returns combined log tail."""
    binary = require_ffmpeg()
    command = [binary, "-hide_banner", "-nostdin", "-loglevel", "error"]
    if on_progress and total_duration > 0:
        command += ["-progress", "pipe:1", "-nostats"]
    command += list(args)
    logger.info("ffmpeg %s: %s", label, " ".join(command[:14]))

    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    stderr_lines: list[str] = []

    def drain_stderr() -> None:
        assert process.stderr is not None
        for line in process.stderr:
            stderr_lines.append(line.rstrip())
            if len(stderr_lines) > 200:
                del stderr_lines[:100]

    reader = threading.Thread(target=drain_stderr, daemon=True)
    reader.start()

    if process.stdout is not None:
        for line in process.stdout:
            if not on_progress:
                continue
            key, _, value = line.strip().partition("=")
            if key == "out_time_us":
                continue
            if key == "out_time_ms":
                try:
                    seconds = int(value) / 1_000_000
                except ValueError:
                    continue
                on_progress(min(1.0, seconds / total_duration), f"{label} {seconds:.1f}s / {total_duration:.1f}s")
            elif key == "progress" and value == "end":
                on_progress(1.0, f"{label} complete")

    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        raise FFmpegError(f"{label} timed out", "\n".join(stderr_lines)) from None
    reader.join(timeout=2)

    log = "\n".join(stderr_lines)
    if process.returncode != 0:
        raise FFmpegError(f"{label} failed with exit code {process.returncode}", log)
    return log


def run_capture(args: Sequence[str], *, timeout: float = 120) -> subprocess.CompletedProcess:
    binary = require_ffmpeg()
    return subprocess.run([binary, "-hide_banner", "-nostdin", *args], capture_output=True, timeout=timeout)


def video_encoder_args(quality: str = "standard") -> list[str]:
    """Hardware encoder when present, libx264 otherwise."""
    accel = hardware_accel()
    if accel == "nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "22", "-pix_fmt", "yuv420p"]
    if accel == "videotoolbox":
        return ["-c:v", "h264_videotoolbox", "-q:v", "62", "-pix_fmt", "yuv420p"]
    preset = {"draft": "veryfast", "standard": "veryfast", "high": "medium"}.get(quality, "veryfast")
    crf = {"draft": "26", "standard": "20", "high": "18"}.get(quality, "20")
    return ["-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p"]


@dataclass
class FontChoice:
    file: str | None
    family: str = "sans"


def find_font() -> FontChoice:
    explicit = os.environ.get("NEXUS_WATERMARK_FONT")
    if explicit and os.path.exists(explicit):
        return FontChoice(explicit)
    if shutil.which("fc-match"):
        try:
            result = subprocess.run(
                ["fc-match", "-f", "%{file}\n%{family}", "DejaVu Sans:style=Bold"],
                capture_output=True,
                text=True,
                timeout=8,
            )
            lines = [line for line in result.stdout.splitlines() if line.strip()]
            if lines and os.path.exists(lines[0]):
                return FontChoice(lines[0], lines[1] if len(lines) > 1 else "sans")
        except (OSError, subprocess.SubprocessError):
            pass
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ):
        if os.path.exists(candidate):
            return FontChoice(candidate)
    return FontChoice(None)


@functools.lru_cache(maxsize=1)
def filter_script_flag() -> str | None:
    """FFmpeg renamed the filtergraph-from-file option.

    FFmpeg ≤ 7 uses ``-filter_complex_script <file>``; FFmpeg 8+ uses
    ``-/filter_complex <file>``. Detect once and cache.
    """
    binary = ffmpeg_binary()
    if not binary:
        return None
    try:
        help_text = subprocess.run([binary, "-hide_banner", "-h", "full"], capture_output=True, text=True, timeout=20).stdout
        if "filter_complex_script" in help_text:
            return "-filter_complex_script"
        probe_result = subprocess.run(
            [binary, "-hide_banner", "-loglevel", "error", "-/filter_complex", "/nonexistent-graph", "-f", "null", "-"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if "Unrecognized option" not in probe_result.stderr:
            return "-/filter_complex"
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def escape_filter_value(value: str) -> str:
    """Escape a value used inside a filtergraph option (not shell-quoted)."""
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace(",", "\\,")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace(";", "\\;")
    )


def watermark_filter(width: int) -> str:
    """Mandatory top-left brand mark, anchored at exactly 24:24 of the frame."""
    font = find_font()
    scale = max(0.8, min(2.2, width / 1080))
    font_size = max(14, int(round(16 * scale)))
    x, y = 24, 24
    boxborder = max(6, int(round(7 * scale)))
    options = [
        f"text='NEXUS FRAME'",
        f"x={x}",
        f"y={y}",
        f"fontsize={font_size}",
        "fontcolor=0xE6EDF3@0.86",
        "box=1",
        "boxcolor=0x0D0F12@0.55",
        f"boxborderw={boxborder}",
        "shadowcolor=0x000000@0.6",
        "shadowx=0",
        "shadowy=1",
    ]
    if font.file:
        options.insert(0, f"fontfile='{escape_filter_value(font.file)}'")
    return "drawtext=" + ":".join(options)


def extract_frame(path: str, timestamp: float, output: str, width: int = 1080) -> bool:
    binary = require_ffmpeg()
    try:
        subprocess.run(
            [
                binary,
                "-hide_banner",
                "-nostdin",
                "-loglevel",
                "error",
                "-ss",
                f"{max(0.0, timestamp):.3f}",
                "-i",
                path,
                "-frames:v",
                "1",
                "-vf",
                f"scale={width}:-2",
                "-q:v",
                "3",
                "-y",
                output,
            ],
            capture_output=True,
            timeout=60,
            check=False,
        )
        return os.path.exists(output) and os.path.getsize(output) > 0
    except (OSError, subprocess.SubprocessError):
        return False


def has_filter(name: str) -> bool:
    binary = require_ffmpeg()
    try:
        result = subprocess.run([binary, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=20)
        return re.search(rf"\s{re.escape(name)}\s", result.stdout) is not None
    except (OSError, subprocess.SubprocessError):
        return False


def unique_name(prefix: str, suffix: str = ".mp4") -> str:
    import uuid

    return f"{prefix}-{uuid.uuid4().hex[:10]}{suffix}"


__all__ = [
    "MediaInfo",
    "FFmpegError",
    "probe",
    "require_ffmpeg",
    "run_ffmpeg",
    "run_capture",
    "video_encoder_args",
    "watermark_filter",
    "escape_filter_value",
    "filter_script_flag",
    "find_font",
    "extract_frame",
    "has_filter",
    "unique_name",
    "hardware_accel",
]
