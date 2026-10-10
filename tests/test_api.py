"""API level tests — the FastAPI app driven with TestClient, engine mocked."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app import config, extractor, history
from app.main import app
from app.models import MediaInfo


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def mock_probe(monkeypatch, fake_info):
    """Make every probe() return the same fake Facebook reel."""
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", _FakeYDLFactory(fake_info))
    extractor.cache.clear()
    return fake_info


def _FakeYDLFactory(payload):
    class _YDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def extract_info(self, url, download=False):
            if download:
                raise AssertionError("tests must not download")
            return payload

    return _YDL


REEL = "https://www.facebook.com/reel/1402267498733776"


# ---------------------------------------------------------------- meta
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["details"]["yt_dlp_version"]
    assert body["details"]["download_dir"] == str(config.DOWNLOAD_DIR)


def test_presets(client):
    body = client.get("/api/presets").json()
    ids = [p["id"] for p in body["items"]]
    assert "best" in ids and "1080" in ids and "mp3" in ids
    assert body["mp3_available"] == bool(config.HAS_FFMPEG)


def test_index_and_static(client):
    assert client.get("/").status_code == 200
    assert "rell" in client.get("/").text
    assert client.get("/static/styles.css").status_code == 200
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/favicon.svg").status_code == 200


def test_normalize_endpoint(client):
    r = client.post("/api/normalize", json={"url": "m.facebook.com/reel/123 "})
    body = r.json()
    assert body["ok"] is True
    assert body["url"] == "https://www.facebook.com/reel/123"
    assert body["platform"] == "facebook"

    bad = client.post("/api/normalize", json={"url": "hello world"}).json()
    assert bad["ok"] is False
    assert bad["hint"]


# ---------------------------------------------------------------- info
def test_info_returns_everything(client, mock_probe):
    r = client.post("/api/info", json={"url": REEL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["platform"] == "facebook"
    assert body["title"] == mock_probe["title"]
    assert body["uploader"] == "Nature Clips BD"
    assert body["view_count"] == 128500
    assert body["like_count"] == 4211
    assert body["comment_count"] == 187
    assert body["duration_text"] == "0:43"
    assert body["upload_date"] == "2026-03-18"
    assert body["best_height"] == 1280
    assert len(body["formats"]) == 3
    assert body["formats"][0]["label"] == "1280p"
    assert body["raw"] is None


def test_info_with_raw(client, mock_probe):
    body = client.post("/api/info", json={"url": REEL, "include_raw": True}).json()
    assert body["raw"]["view_count"] == 128500


def test_info_rejects_junk(client):
    r = client.post("/api/info", json={"url": "not a link"})
    assert r.status_code == 400


def test_info_error_shape(client, monkeypatch):
    def fake(url, include_raw=False, use_cache=True):
        return MediaInfo(
            url=url,
            platform="facebook",
            ok=False,
            error="This video is only available to logged in users",
            hint="Open Settings → Cookies and paste your cookies.",
        )

    monkeypatch.setattr(extractor, "probe", fake)
    r = client.post("/api/info", json={"url": REEL})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "Cookies" in body["hint"]


def test_formats_endpoint(client, mock_probe):
    body = client.get(f"/api/formats?url={REEL}&quality=720").json()
    assert body["best_height"] == 1280
    assert body["selector"].startswith("bestvideo*[height<=720]")
    assert len(body["formats"]) == 3


def test_batch(client, mock_probe):
    text = "\n".join([REEL, "https://www.instagram.com/reel/BBBB/", "not a link"])
    body = client.post("/api/batch", json={"raw_text": text}).json()
    assert body["count"] == 2
    assert body["ok"] == 2
    assert body["failed"] == 0


def test_batch_rejects_empty(client):
    assert client.post("/api/batch", json={"raw_text": "   "}).status_code == 400


def test_history_roundtrip(client, mock_probe):
    client.delete("/api/history")
    client.post("/api/info", json={"url": REEL})
    items = client.get("/api/history?limit=5").json()["items"]
    assert items, "extraction should be remembered"
    assert items[0]["url"] == REEL
    assert items[0]["title"] == mock_probe["title"]
    assert client.delete("/api/history").json()["deleted"] >= 1


# ---------------------------------------------------------------- cookies
def test_cookies_lifecycle(client):
    assert client.get("/api/cookies").json()["loaded"] is False

    header = "cookie: datr=abc123; sb=xyz789; c_user=1000640"
    r = client.post("/api/cookies", json={"text": header})
    assert r.status_code == 200, r.text
    assert r.json()["cookie_rows"] >= 3

    status = client.get("/api/cookies").json()
    assert status["loaded"] is True
    assert status["rows"] >= 3

    saved = config.COOKIES_FILE.read_text()
    assert saved.startswith("# Netscape HTTP Cookie File")
    assert "datr" in saved

    assert client.delete("/api/cookies").json() == {"loaded": False}
    assert client.get("/api/cookies").json()["loaded"] is False


def test_cookies_netscape_passthrough(client):
    netscape = "# Netscape HTTP Cookie File\n.facebook.com\tTRUE\t/\tTRUE\t1999999999\tdatr\tabc\n"
    r = client.post("/api/cookies", json={"text": netscape})
    assert r.json()["cookie_rows"] == 1
    assert config.COOKIES_FILE.read_text() == netscape
    client.delete("/api/cookies")


def test_cookies_reject_empty(client):
    assert client.post("/api/cookies", json={"text": "   "}).status_code == 400


def test_cookies_upload(client):
    r = client.post(
        "/api/cookies/upload",
        files={"file": ("cookies.txt", b"datr=abc; sb=def", "text/plain")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["cookie_rows"] >= 2
    client.delete("/api/cookies")


# ---------------------------------------------------------------- library
def test_library_listing(client, tmp_dirs):
    downloads = tmp_dirs["downloads"]
    downloads.mkdir(parents=True, exist_ok=True)
    sample = downloads / "Sample Video [123].mp4"
    sample.write_bytes(b"\x00" * 2048)
    (downloads / ".hidden").write_bytes(b"x")

    items = client.get("/api/library").json()
    names = [i["name"] for i in items]
    assert "Sample Video [123].mp4" in names
    assert ".hidden" not in names
    entry = next(i for i in items if i["name"] == "Sample Video [123].mp4")
    assert entry["size"] == 2048
    assert entry["size_text"] == "2.00 KB"

    got = client.get(f"/api/library/{sample.name}")
    assert got.status_code == 200
    assert len(got.content) == 2048

    assert client.delete(f"/api/library/{sample.name}").json() == {"deleted": sample.name}
    assert not sample.exists()


def test_library_rejects_traversal(client):
    assert client.get("/api/library/..%2f..%2fetc%2fpasswd").status_code in (400, 404)
    assert client.get("/api/library/.secret").status_code == 400
    assert client.delete("/api/library/nope.mp4").status_code == 404


# ---------------------------------------------------------------- download
def test_download_streams_file(client, monkeypatch, tmp_dirs):
    def fake_download(url, quality="best", dest_dir=None, outtmpl=None, job=None, on_path=None):
        dest = dest_dir or config.DOWNLOAD_DIR
        path = dest / "Sunset timelapse [1402267498733776].mp4"
        path.write_bytes(b"fake-mp4-bytes")
        return path

    monkeypatch.setattr(extractor, "download", fake_download)

    r = client.get(f"/api/download?url={REEL}&quality=1080")
    assert r.status_code == 200, r.text
    assert r.content == b"fake-mp4-bytes"
    assert "attachment" in r.headers.get("content-disposition", "")
    assert "Sunset" in r.headers["content-disposition"]


def test_download_custom_filename(client, monkeypatch, tmp_dirs):
    def fake_download(url, quality="best", dest_dir=None, outtmpl=None, job=None, on_path=None):
        path = dest_dir / "video.mp4"
        path.write_bytes(b"xyz")
        return path

    monkeypatch.setattr(extractor, "download", fake_download)
    r = client.get(f"/api/download?url={REEL}&quality=best&filename=my%20clip")
    assert r.status_code == 200
    # Starlette encodes non-ASCII / spaced names per RFC 5987.
    disposition = r.headers["content-disposition"]
    assert "my%20clip.mp4" in disposition or "my clip.mp4" in disposition
    assert disposition.startswith("attachment")


def test_download_error_is_json(client, monkeypatch):
    def boom(*args, **kwargs):
        raise extractor.RellError("Video unavailable", "Check the link is complete.")

    monkeypatch.setattr(extractor, "download", boom)
    r = client.get(f"/api/download?url={REEL}")
    assert r.status_code == 502
    assert r.json()["detail"] == "Video unavailable"
    assert r.json()["hint"] == "Check the link is complete."


def test_save_creates_job(client, monkeypatch):
    started = {}

    def fake_download(url, quality="best", dest_dir=None, outtmpl=None, job=None, on_path=None):
        started["job"] = job
        if job:
            job.status = "done"
            job.percent = 100.0
            job.filename = "saved.mp4"

    monkeypatch.setattr(extractor, "download", fake_download)

    r = client.post("/api/save", json={"url": REEL, "quality": "best"})
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    import time
    for _ in range(40):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.1)

    assert job["status"] == "done"
    assert job["filename"] == "saved.mp4"
    assert client.get("/api/jobs/does-not-exist").status_code == 404


def test_openapi_documents_everything(client):
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    for expected in ["/api/info", "/api/batch", "/api/download", "/api/formats", "/api/library", "/api/cookies", "/api/health"]:
        assert expected in paths, f"{expected} missing from OpenAPI"
    assert spec["info"]["title"] == "rell"


def test_cache_clear(client):
    assert client.delete("/api/cache").json() == {"cleared": True}


def test_thumb_rejects_internal_address(client, monkeypatch):
    monkeypatch.setattr(extractor, "ALLOW_PRIVATE", False)
    r = client.get("/api/thumb", params={"url": "http://169.254.169.254/latest/meta-data/"})
    assert r.status_code == 400
    assert "private" in r.json()["detail"].lower()


def test_thumb_requires_http(client):
    assert client.get("/api/thumb", params={"url": "file:///etc/passwd"}).status_code == 400
