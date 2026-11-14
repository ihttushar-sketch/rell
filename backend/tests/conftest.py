"""Isolates test data from the operator's real vault."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TEST_DATA = Path(tempfile.mkdtemp(prefix="nexus-tests-"))
os.environ.setdefault("NEXUS_DATA_DIR", str(_TEST_DATA))
os.environ.setdefault("NEXUS_DB", str(_TEST_DATA / "tests.db"))
os.environ.setdefault("NEXUS_YTDLP", "off")
