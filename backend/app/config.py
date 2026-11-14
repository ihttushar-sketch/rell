"""Runtime configuration for the NEXUS FRAME production node."""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("NEXUS_DATA_DIR", BACKEND_ROOT / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
RENDER_DIR = DATA_DIR / "renders"
STEM_DIR = DATA_DIR / "stems"
CACHE_DIR = DATA_DIR / "cache"
DB_PATH = Path(os.environ.get("NEXUS_DB", DATA_DIR / "nexus.db"))

for _directory in (DATA_DIR, UPLOAD_DIR, RENDER_DIR, STEM_DIR, CACHE_DIR):
    _directory.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = int(os.environ.get("NEXUS_MAX_UPLOAD_MB", "512")) * 1024 * 1024
MAX_TARGET_SEC = float(os.environ.get("NEXUS_MAX_TARGET_SEC", "1800"))

# Render defaults. The node auto-selects around 720p vertical for CPU boxes;
# set NEXUS_RENDER_MAX_DIM=1920 on a GPU workstation for full 1080x1920.
RENDER_MAX_DIM = int(os.environ.get("NEXUS_RENDER_MAX_DIM", "1280"))
RENDER_FPS = int(os.environ.get("NEXUS_RENDER_FPS", "30"))
RENDER_CRF = int(os.environ.get("NEXUS_RENDER_CRF", "20"))
RENDER_PRESET = os.environ.get("NEXUS_RENDER_PRESET", "veryfast")
ENABLE_HWACCEL = os.environ.get("NEXUS_HWACCEL", "auto").lower() != "off"
MAX_ANALYZE_SEC = float(os.environ.get("NEXUS_MAX_ANALYZE_SEC", "300"))
YTDLP_ENABLED = os.environ.get("NEXUS_YTDLP", "on").lower() != "off"

ALLOWED_ORIGINS = [origin.strip() for origin in os.environ.get("NEXUS_ALLOWED_ORIGINS", "*").split(",") if origin.strip()]
