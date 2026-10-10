"""Runtime configuration for rell.

Everything can be overridden with environment variables so the same code runs
on a laptop, a Raspberry Pi or a VPS without edits.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("RELL_DATA_DIR", BASE_DIR / "data"))
DOWNLOAD_DIR = Path(os.getenv("RELL_DOWNLOAD_DIR", BASE_DIR / "downloads"))
BIN_DIR = DATA_DIR / "bin"
COOKIES_FILE = Path(os.getenv("RELL_COOKIES_FILE", DATA_DIR / "cookies.txt"))
HISTORY_DB = Path(os.getenv("RELL_HISTORY_DB", DATA_DIR / "history.sqlite3"))

for _d in (DATA_DIR, DOWNLOAD_DIR, BIN_DIR):
    _d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HOST = os.getenv("RELL_HOST", "0.0.0.0")
PORT = int(os.getenv("RELL_PORT", "8000"))

# How long an extracted info blob stays reusable (seconds).
CACHE_TTL = int(os.getenv("RELL_CACHE_TTL", "600"))
CACHE_MAX_ENTRIES = int(os.getenv("RELL_CACHE_MAX_ENTRIES", "64"))

# History rows kept in sqlite.
HISTORY_LIMIT = int(os.getenv("RELL_HISTORY_LIMIT", "200"))

# Comma separated list of domains that are allowed, e.g. "facebook.com,instagram.com".
# Empty (default) = every site yt-dlp supports.
ALLOWED_DOMAINS = [
    d.strip().lower()
    for d in os.getenv("RELL_ALLOWED_DOMAINS", "").split(",")
    if d.strip()
]

# Seconds a single extraction may take before we give up.
EXTRACT_TIMEOUT = int(os.getenv("RELL_EXTRACT_TIMEOUT", "120"))

USER_AGENT = os.getenv(
    "RELL_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
)


# ---------------------------------------------------------------------------
# ffmpeg
# ---------------------------------------------------------------------------
def resolve_ffmpeg_dir() -> str | None:
    """Return a directory that contains an ``ffmpeg`` executable.

    Priority:
      1. ``RELL_FFMPEG_DIR`` env var
      2. ``ffmpeg`` already on PATH
      3. the static binary bundled with the ``imageio-ffmpeg`` wheel, symlinked
         into ``data/bin/ffmpeg`` so yt-dlp can find it by the expected name.
    """
    env_dir = os.getenv("RELL_FFMPEG_DIR")
    if env_dir and (Path(env_dir) / "ffmpeg").exists():
        return env_dir

    on_path = shutil.which("ffmpeg")
    if on_path:
        return str(Path(on_path).parent)

    try:
        import imageio_ffmpeg

        bundled = Path(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:  # pragma: no cover - imageio-ffmpeg missing
        return None

    if not bundled.exists():
        return None

    link = BIN_DIR / "ffmpeg"
    try:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(bundled)
        os.chmod(bundled, 0o755)
    except OSError:
        return str(bundled.parent)
    return str(BIN_DIR)


FFMPEG_DIR = resolve_ffmpeg_dir()
HAS_FFMPEG = FFMPEG_DIR is not None


def settings_summary() -> dict:
    """Small dict used by ``/api/health`` and the UI status pill."""
    import yt_dlp

    return {
        "yt_dlp_version": yt_dlp.version.__version__,
        "ffmpeg": FFMPEG_DIR or None,
        "ffmpeg_available": HAS_FFMPEG,
        "cookies_loaded": COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0,
        "download_dir": str(DOWNLOAD_DIR),
        "allowed_domains": ALLOWED_DOMAINS or "any",
        "allow_private": os.getenv("RELL_ALLOW_PRIVATE", "").strip().lower() in ("1", "true", "yes", "on"),
        "cache_ttl": CACHE_TTL,
    }
