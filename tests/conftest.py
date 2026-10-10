"""Point rell at throwaway folders before anything imports app.config."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="rell-test-"))
os.environ["RELL_DATA_DIR"] = str(_TMP / "data")
os.environ["RELL_DOWNLOAD_DIR"] = str(_TMP / "downloads")
os.environ["RELL_HISTORY_DB"] = str(_TMP / "data" / "history.sqlite3")
os.environ["RELL_COOKIES_FILE"] = str(_TMP / "data" / "cookies.txt")
os.environ["RELL_CACHE_TTL"] = "5"
os.environ["RELL_ALLOWED_DOMAINS"] = ""
# The end-to-end tests run against a local 127.0.0.1 fixture server.
os.environ["RELL_ALLOW_PRIVATE"] = "1"

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402


@pytest.fixture()
def tmp_dirs():
    return {"data": _TMP / "data", "downloads": _TMP / "downloads"}


@pytest.fixture()
def fake_info():
    """A realistic yt-dlp info dict shaped like a Facebook reel response."""
    return {
        "id": "1402267498733776",
        "extractor": "facebook:reel",
        "extractor_key": "FacebookReel",
        "title": "Sunset timelapse over the river #reels",
        "description": "Shot on a phone, edited in 10 minutes.\n#reel #nature",
        "webpage_url": "https://www.facebook.com/reel/1402267498733776",
        "uploader": "Nature Clips BD",
        "uploader_id": "100064000000000",
        "uploader_url": "https://www.facebook.com/100064000000000",
        "channel": "Nature Clips BD",
        "duration": 42.5,
        "upload_date": "20260318",
        "timestamp": 1774137600,
        "view_count": 128500,
        "like_count": 4211,
        "comment_count": 187,
        "repost_count": 96,
        "thumbnail": "https://scontent.example.com/thumb.jpg",
        "thumbnails": [
            {"id": "0", "url": "https://scontent.example.com/t0.jpg", "width": 180, "height": 320},
            {"id": "1", "url": "https://scontent.example.com/t1.jpg", "width": 720, "height": 1280},
        ],
        "tags": ["reel", "nature"],
        "categories": ["Entertainment"],
        "is_live": False,
        "availability": "public",
        "age_limit": 0,
        "formats": [
            {
                "format_id": "hd1",
                "ext": "mp4",
                "width": 720,
                "height": 1280,
                "fps": 30.0,
                "vcodec": "avc1.4D401F",
                "acodec": "mp4a.40.2",
                "filesize": 8_400_000,
                "tbr": 1600.0,
                "protocol": "https",
                "format_note": "hd",
                "url": "https://video.example.com/hd1.mp4",
            },
            {
                "format_id": "sd1",
                "ext": "mp4",
                "width": 360,
                "height": 640,
                "fps": 30.0,
                "vcodec": "avc1.4D401F",
                "acodec": "mp4a.40.2",
                "filesize": 2_100_000,
                "tbr": 400.0,
                "protocol": "https",
                "format_note": "sd",
                "url": "https://video.example.com/sd1.mp4",
            },
            {
                "format_id": "audio-m4a",
                "ext": "m4a",
                "vcodec": "none",
                "acodec": "mp4a.40.2",
                "abr": 64.0,
                "filesize": 340_000,
                "protocol": "https",
                "url": "https://video.example.com/audio.m4a",
            },
        ],
    }
