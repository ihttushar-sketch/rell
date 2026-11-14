"""Runtime capability detection.

Every heavy dependency is optional: the node reports what it can actually do so
the studio can adapt its UI and pick a fallback pipeline instead of failing.
"""

from __future__ import annotations

import functools
import importlib.util
import os
import shutil
import subprocess
from typing import Any

from . import __version__


def _module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


@functools.lru_cache(maxsize=1)
def ffmpeg_binary() -> str | None:
    explicit = os.environ.get("NEXUS_FFMPEG")
    if explicit and os.path.exists(explicit):
        return explicit
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # pragma: no cover - optional dependency
        return None


@functools.lru_cache(maxsize=1)
def ffprobe_binary() -> str | None:
    explicit = os.environ.get("NEXUS_FFPROBE")
    if explicit and os.path.exists(explicit):
        return explicit
    return shutil.which("ffprobe")


def _encoder_available(encoder: str) -> bool:
    """Encoder must exist *and* actually encode a frame.

    Listing h264_nvenc on a CPU-only box is common; only a real trial encode
    proves the hardware path works.
    """
    binary = ffmpeg_binary()
    if not binary:
        return False
    try:
        listed = subprocess.run(
            [binary, "-hide_banner", "-h", f"encoder={encoder}"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if "Encoder" not in listed.stdout or "not found" in listed.stdout.lower():
            return False
        trial = subprocess.run(
            [
                binary, "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1:r=10",
                "-frames:v", "2", "-c:v", encoder, "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
            timeout=25,
        )
        return trial.returncode == 0
    except Exception:
        return False


@functools.lru_cache(maxsize=1)
def hardware_accel() -> str | None:
    """Best hardware H.264 encoder available, or None for CPU."""
    if not os.environ.get("NEXUS_HWACCEL", "auto").lower() == "off":
        for encoder, label in (("h264_nvenc", "nvenc"), ("h264_videotoolbox", "videotoolbox"), ("h264_qsv", "qsv")):
            if _encoder_available(encoder):
                return label
    return None


@functools.lru_cache(maxsize=1)
def snapshot() -> dict[str, Any]:
    notes: list[str] = []
    ffmpeg = ffmpeg_binary()
    if ffmpeg and "imageio" in ffmpeg:
        notes.append("ffmpeg resolved from the bundled imageio-ffmpeg binary")
    if not ffmpeg:
        notes.append("ffmpeg missing: analysis and rendering are unavailable")
    if not _module_available("cv2"):
        notes.append("OpenCV missing: optical-flow motion classification degrades to frame differencing")
    if not _module_available("scenedetect"):
        notes.append("PySceneDetect missing: histogram cut detection is used instead")
    if not _module_available("demucs"):
        notes.append("Demucs missing: 3-stem separation is skipped, the reference mix is retained as BGM")
    if not _module_available("librosa"):
        notes.append("librosa missing: tempo tracking uses the built-in spectral-flux analyser")
    if not _module_available("yt_dlp"):
        notes.append("yt-dlp missing: remote URL ingestion disabled")
    from .vision import status as vision_status

    vision = vision_status()
    return {
        "engine": "server",
        "version": __version__,
        "ffmpeg": bool(ffmpeg),
        "ffmpeg_path": ffmpeg,
        "ffprobe": bool(ffprobe_binary()),
        "ytdlp": _module_available("yt_dlp") and bool(os.environ.get("NEXUS_YTDLP", "on").lower() != "off"),
        "opencv": _module_available("cv2"),
        "scenedetect": _module_available("scenedetect"),
        "demucs": _module_available("demucs"),
        "librosa": _module_available("librosa"),
        "torch": _module_available("torch"),
        "hardware_accel": hardware_accel(),
        "vision": vision["provider"] if vision["enabled"] else None,
        "notes": notes,
    }
