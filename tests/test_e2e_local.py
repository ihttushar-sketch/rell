"""End-to-end tests that never touch the internet.

A tiny local HTTP server serves a fixture page + a real (ffmpeg generated) mp4,
then the *actual* yt-dlp pipeline runs against it. This proves probing,
format listing, ffmpeg merging and file delivery all work — no mocks.

Skipped automatically when ffmpeg is not available.
"""
from __future__ import annotations

import http.server
import shutil
import socketserver
import subprocess
import threading
from functools import partial
from pathlib import Path

import pytest

from app import config, extractor

pytestmark = pytest.mark.skipif(not config.HAS_FFMPEG, reason="ffmpeg not available")


def _ffmpeg() -> str:
    ffmpeg = Path(config.FFMPEG_DIR) / "ffmpeg"
    if ffmpeg.exists():
        return str(ffmpeg)
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


@pytest.fixture(scope="module")
def local_site(tmp_path_factory):
    """Serve a fixture reel page on 127.0.0.1 with a generated clip."""
    root = tmp_path_factory.mktemp("site")
    clip = root / "clip.mp4"
    subprocess.run(
        [
            _ffmpeg(), "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(clip),
        ],
        check=True,
        capture_output=True,
    )

    page = root / "page.html"
    page.write_text(
        """<!DOCTYPE html><html><head>
        <title>Local fixture reel</title>
        <meta property="og:title" content="Local fixture reel" />
        <meta property="og:description" content="Used by the rell end-to-end tests." />
        <meta property="og:video" content="{base}/clip.mp4" />
        <meta property="og:video:type" content="video/mp4" />
        </head><body>
        <video controls width="320"><source src="clip.mp4" type="video/mp4"></video>
        </body></html>""".replace("{base}", "http://127.0.0.1:8899"),
        encoding="utf-8",
    )

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):  # silence
            pass

    handler = partial(Quiet, directory=str(root))

    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True
        daemon_threads = True

    httpd = ReusableTCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    # Point og:video at the real port so the generic extractor finds it.
    page.write_text(page.read_text().replace(":8899", f":{port}"), encoding="utf-8")

    try:
        yield f"http://127.0.0.1:{port}/page.html"
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_probe_real_extraction(local_site):
    extractor.cache.clear()
    info = extractor.probe(local_site, use_cache=False)
    assert info.ok, info.error
    assert info.title
    assert info.formats, "expected at least one rendition"
    assert any(f.has_video for f in info.formats)
    assert info.best_height in (240, None) or info.best_height > 0
    assert info.duration is None or info.duration > 0


def test_download_best_produces_a_file(local_site, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    path = extractor.download(local_site, quality="best", dest_dir=out)
    assert path.exists()
    assert path.stat().st_size > 1000
    assert path.suffix.lower() in (".mp4", ".mkv", ".webm")


def test_download_720_falls_back_gracefully(local_site, tmp_path):
    """Asking for a higher quality than exists must still deliver a file."""
    out = tmp_path / "out"
    out.mkdir()
    path = extractor.download(local_site, quality="1080", dest_dir=out)
    assert path.exists() and path.stat().st_size > 1000


def test_download_reports_progress(local_site, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    job = extractor.new_job(local_site)
    path = extractor.download(local_site, quality="best", dest_dir=out, job=job)
    assert job.status == "done"
    assert job.percent == 100.0
    assert job.filename == path.name
    assert job.size == path.stat().st_size


def test_download_mp3_transcodes(local_site, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    path = extractor.download(local_site, quality="mp3", dest_dir=out)
    assert path.exists()
    assert path.suffix.lower() == ".mp3"
    assert path.stat().st_size > 1000


def test_api_streams_real_file(local_site, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import app, STREAM_DIR

    with TestClient(app) as client:
        r = client.get("/api/download", params={"url": local_site, "quality": "best"})
        assert r.status_code == 200, r.text
        assert len(r.content) > 1000
        assert "attachment" in r.headers["content-disposition"]
        # MP4 ('ftyp') or Matroska/WebM magic — i.e. a real media container.
        assert r.content[4:8] == b"ftyp" or r.content[:4] == b"\x1aE\xdf\xa3"

    # the temporary stream folder must be cleaned up again
    leftovers = [p for p in STREAM_DIR.iterdir() if p.is_dir() and any(p.iterdir())]
    assert not leftovers, f"stream temp folders not cleaned: {leftovers}"
