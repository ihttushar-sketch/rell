"""Unit tests for the yt-dlp wrapper — no network involved."""
from __future__ import annotations

import pytest

from app import extractor
from app.extractor import (
    DomainNotAllowedError,
    UnsupportedURLError,
    build_media_info,
    detect_platform,
    human_duration,
    human_size,
    iso_date,
    normalize_url,
    parse_formats,
    quality_selector,
    split_urls,
)


# ---------------------------------------------------------------- URLs
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://www.facebook.com/reel/1402267498733776", "https://www.facebook.com/reel/1402267498733776"),
        ("facebook.com/reel/1402267498733776", "https://facebook.com/reel/1402267498733776"),
        ("  https://m.facebook.com/reel/123  ", "https://www.facebook.com/reel/123"),
        ("https://web.facebook.com/watch/?v=123", "https://www.facebook.com/watch/?v=123"),
        ("https://mbasic.facebook.com/story.php?story_fbid=1", "https://www.facebook.com/story.php?story_fbid=1"),
        ("https://www.instagram.com/reel/C1234abcd/?utm_source=ig_web_copy_link", "https://www.instagram.com/reel/C1234abcd/?utm_source=ig_web_copy_link"),
        ("https://www.facebook.com/reel/123.", "https://www.facebook.com/reel/123"),
        ("Check this out https://www.facebook.com/reel/123 nice", "https://www.facebook.com/reel/123"),
    ],
)
def test_normalize_url(raw, expected):
    assert normalize_url(raw) == expected


@pytest.mark.parametrize("bad", ["", "   ", "ftp://x.com/a", "javascript:alert(1)", "not a link at all"])
def test_normalize_url_rejects_junk(bad):
    with pytest.raises(UnsupportedURLError):
        normalize_url(bad)


@pytest.mark.parametrize(
    "url,platform",
    [
        ("https://www.facebook.com/reel/1", "facebook"),
        ("https://fb.watch/abc", "facebook"),
        ("https://www.instagram.com/reel/ABC/", "instagram"),
        ("https://youtu.be/abc", "youtube"),
        ("https://example.org/video", "example.org"),
    ],
)
def test_detect_platform(url, platform):
    assert detect_platform(url) == platform


def test_split_urls_block():
    text = """
    https://www.facebook.com/reel/111
    https://www.instagram.com/reel/BBB/ , junk
    https://www.facebook.com/reel/111
    https://fb.watch/xyz
    """
    assert split_urls(text) == [
        "https://www.facebook.com/reel/111",
        "https://www.instagram.com/reel/BBB/",
        "https://fb.watch/xyz",
    ]


def test_domain_allow_list(monkeypatch):
    monkeypatch.setattr(extractor.config, "ALLOWED_DOMAINS", ["facebook.com", "instagram.com"])
    extractor.ensure_domain_allowed("https://www.facebook.com/reel/1")
    extractor.ensure_domain_allowed("https://m.instagram.com/reel/1/")
    with pytest.raises(DomainNotAllowedError):
        extractor.ensure_domain_allowed("https://youtube.com/watch?v=1")


# ---------------------------------------------------------------- formatting
def test_human_size():
    assert human_size(None) == ""
    assert human_size(0) == ""
    assert human_size(512) == "512 B"
    assert human_size(2048) == "2.00 KB"
    assert human_size(8_400_000).endswith("MB")


def test_human_duration():
    assert human_duration(None) == ""
    assert human_duration(42.5) == "0:43"
    assert human_duration(3661) == "1:01:01"


def test_iso_date():
    assert iso_date("20260318") == "2026-03-18"
    assert iso_date(None) is None
    assert iso_date("weird") == "weird"


def test_parse_formats_sorts_and_labels(fake_info):
    formats = parse_formats(fake_info)
    assert [f.format_id for f in formats] == ["hd1", "sd1", "audio-m4a"]
    assert formats[0].label == "1280p"
    assert formats[0].resolution == "720x1280"
    assert formats[0].has_video and formats[0].has_audio
    assert formats[2].has_audio and not formats[2].has_video
    assert formats[2].label == "audio 64k"
    assert formats[0].filesize_text.endswith("MB")


def test_build_media_info(fake_info):
    info = build_media_info("https://www.facebook.com/reel/1402267498733776", fake_info, extractor._CollectingLogger())
    assert info.ok is True
    assert info.platform == "facebook"
    assert info.video_id == "1402267498733776"
    assert info.uploader == "Nature Clips BD"
    assert info.duration_text == "0:43"
    assert info.upload_date == "2026-03-18"
    assert info.view_count == 128500
    assert info.like_count == 4211
    assert info.comment_count == 187
    assert info.repost_count == 96
    assert info.best_height == 1280
    assert len(info.thumbnails) == 2
    assert info.tags == ["reel", "nature"]


def test_build_media_info_tolerates_missing_fields():
    info = build_media_info("https://example.org/v", {"id": "1"}, extractor._CollectingLogger())
    assert info.ok
    assert info.title == "Untitled"
    assert info.formats == []
    assert info.best_height is None


# ---------------------------------------------------------------- qualities
@pytest.mark.parametrize(
    "quality,selector",
    [
        ("best", "bestvideo*+bestaudio/best"),
        ("1080", "bestvideo*[height<=1080]+bestaudio/best[height<=1080]/best"),
        ("720p", "bestvideo*[height<=720]+bestaudio/best[height<=720]/best"),
        ("audio", "bestaudio/best"),
        ("hd1", "hd1"),
    ],
)
def test_quality_selector(quality, selector):
    assert quality_selector(quality) == selector


def test_is_audio_only():
    assert extractor.is_audio_only("mp3")
    assert extractor.is_audio_only("AUDIO")
    assert not extractor.is_audio_only("best")


def test_safe_filename():
    assert extractor.safe_filename("a/b:c*?") != ""
    assert extractor.safe_filename("", "fallback") == "fallback"


# ---------------------------------------------------------------- probe()
class _FakeYDL:
    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=False):
        return _FakeYDL.payload


def test_probe_uses_engine_and_caches(monkeypatch, fake_info):
    _FakeYDL.payload = fake_info
    calls = {"n": 0}

    class Counting(_FakeYDL):
        def extract_info(self, url, download=False):
            calls["n"] += 1
            return fake_info

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", Counting)
    extractor.cache.clear()

    url = "https://www.facebook.com/reel/1402267498733776"
    first = extractor.probe(url)
    second = extractor.probe(url)

    assert first.ok and second.ok
    assert first.title == fake_info["title"]
    assert calls["n"] == 1, "second call should come from the cache"
    assert second.raw is None


def test_probe_include_raw(monkeypatch, fake_info):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", type("Y", (_FakeYDL,), {"extract_info": lambda self, url, download=False: fake_info}))
    extractor.cache.clear()
    info = extractor.probe("https://www.facebook.com/reel/999", include_raw=True)
    assert info.raw is not None
    assert info.raw["view_count"] == 128500


def test_probe_error_gives_login_hint(monkeypatch):
    from yt_dlp.utils import DownloadError

    def boom(self, url, download=False):
        raise DownloadError("ERROR: [facebook] 123: This video is only available to logged in users")

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", type("Y", (_FakeYDL,), {"extract_info": boom}))
    extractor.cache.clear()

    info = extractor.probe("https://www.facebook.com/reel/123")
    assert info.ok is False
    assert "logged in" in info.error
    assert info.hint and "Cookies" in info.hint


def test_probe_network_error_hint(monkeypatch):
    from yt_dlp.utils import DownloadError

    def boom(self, url, download=False):
        raise DownloadError("ERROR: Unable to download webpage: [Errno -3] Temporary failure in name resolution")

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", type("Y", (_FakeYDL,), {"extract_info": boom}))
    extractor.cache.clear()

    info = extractor.probe("https://www.facebook.com/reel/123")
    assert info.ok is False
    assert info.hint and "network" in info.hint.lower()


def test_probe_unwraps_playlist(monkeypatch, fake_info):
    payload = {"_type": "playlist", "entries": [fake_info]}
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", type("Y", (_FakeYDL,), {"extract_info": lambda self, url, download=False: payload}))
    extractor.cache.clear()
    info = extractor.probe("https://www.instagram.com/someuser/")
    assert info.video_id == "1402267498733776"


def test_probe_rejects_bad_url():
    with pytest.raises(UnsupportedURLError):
        extractor.probe("")


# ---------------------------------------------------------------- jobs
def test_job_lifecycle():
    job = extractor.new_job("https://www.facebook.com/reel/1")
    assert extractor.get_job(job.job_id) is job
    assert job.status == "queued"

    hook = extractor._make_hook(job)
    hook({"status": "downloading", "total_bytes": 100, "downloaded_bytes": 50, "_speed_str": "1.0MiB/s", "_eta_str": "00:01"})
    assert job.status == "running"
    assert job.percent == 50.0
    hook({"status": "finished", "filename": "/tmp/x.mp4"})
    assert job.percent == 100.0
    assert job.filename == "x.mp4"

    assert extractor.get_job("nope") is None


def test_parse_formats_without_codec_info():
    """Generic/HTML5 sources report video_ext instead of vcodec."""
    info = {
        "formats": [
            {"format_id": "0", "ext": "mp4", "video_ext": "mp4", "audio_ext": "none", "url": "http://x/a.mp4"},
            {"format_id": "1", "ext": "m4a", "video_ext": "none", "audio_ext": "m4a", "abr": 96.0, "url": "http://x/a.m4a"},
            {"format_id": "2", "ext": "mkv", "height": 1080, "width": 1920, "url": "http://x/b.mkv"},
        ]
    }
    formats = parse_formats(info)
    by_id = {f.format_id: f for f in formats}
    assert by_id["0"].has_video and not by_id["0"].has_audio
    assert by_id["0"].label == "MP4 video"
    assert not by_id["1"].has_video and by_id["1"].has_audio
    assert by_id["1"].label == "audio 96k"
    assert by_id["2"].has_video and by_id["2"].has_audio
    assert by_id["2"].label == "1080p"
    assert [f.format_id for f in formats][0] == "2", "known video renditions sort first"


def test_parse_formats_dedupes(fake_info):
    fake_info["formats"].append(dict(fake_info["formats"][0]))
    assert len(parse_formats(fake_info)) == 3


# ---------------------------------------------------------------- SSRF guard
@pytest.mark.parametrize(
    "url,internal",
    [
        ("http://127.0.0.1:8000/x", True),
        ("http://localhost/x", True),
        ("http://[::1]/x", True),
        ("http://169.254.169.254/latest/meta-data/", True),
        ("http://192.168.1.5/nas", True),
        ("http://10.0.0.9/", True),
        ("http://172.16.4.4/", True),
        ("http://0.0.0.0/", True),
        ("https://www.facebook.com/reel/1", False),
        ("https://scontent.cdninstagram.com/v/t50/x.mp4", False),
    ],
)
def test_is_internal_target(url, internal):
    assert extractor.is_internal_target(url) is internal


def test_ensure_public_blocks_internal(monkeypatch):
    monkeypatch.setattr(extractor, "ALLOW_PRIVATE", False)
    with pytest.raises(DomainNotAllowedError):
        extractor.ensure_public("http://169.254.169.254/latest/meta-data/")
    with pytest.raises(DomainNotAllowedError):
        extractor.probe("http://127.0.0.1:9000/secret")


def test_ensure_public_allows_internal_when_opted_in(monkeypatch):
    monkeypatch.setattr(extractor, "ALLOW_PRIVATE", True)
    extractor.ensure_public("http://127.0.0.1:9000/x")   # must not raise


def test_ensure_public_allows_public(monkeypatch):
    monkeypatch.setattr(extractor, "ALLOW_PRIVATE", False)
    extractor.ensure_public("https://www.facebook.com/reel/1")
