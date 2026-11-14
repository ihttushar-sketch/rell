"""Remote ingestion: option plumbing, error translation and version hygiene."""

from __future__ import annotations

from pathlib import Path

import pytest

from app import remote


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in (
        "NEXUS_YTDLP_COOKIES",
        "NEXUS_YTDLP_PROXY",
        "NEXUS_YTDLP_CLIENTS",
        "NEXUS_YTDLP_JS_RUNTIME",
        "NEXUS_YTDLP_IMPERSONATE",
    ):
        monkeypatch.delenv(key, raising=False)


def test_bot_check_error_asks_for_cookies():
    message = remote.friendly_error(
        "ERROR: [youtube] abc123: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies"
    )
    assert "cookies" in message.lower()
    assert "NEXUS_YTDLP_COOKIES" in message


def test_network_error_suggests_upload_or_proxy():
    message = remote.friendly_error(
        "ERROR: [youtube] abc: Unable to download API page: TLS/SSL connection has been closed (EOF)"
    )
    assert "upload the media file" in message.lower()
    assert "NEXUS_YTDLP_PROXY" in message
    assert "please report" not in message.lower()


def test_stale_player_error_suggests_upgrade():
    message = remote.friendly_error(
        "ERROR: [youtube] abc: Failed to extract any player response; please report this issue on "
        "https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template."
    )
    assert "pip install -U yt-dlp" in message
    assert "https://github.com" not in message


def test_private_video_is_explained():
    message = remote.friendly_error("ERROR: [youtube] abc: Private video. Sign in if you've been granted access")
    assert "not publicly downloadable" in message


def test_unknown_errors_are_trimmed_not_dropped():
    message = remote.friendly_error("ERROR: something odd happened " + "x" * 400)
    assert message.startswith("something odd happened")
    assert len(message) <= 230


def test_cookie_file_only_used_when_present(tmp_path: Path, monkeypatch):
    missing = tmp_path / "nope.txt"
    monkeypatch.setenv("NEXUS_YTDLP_COOKIES", str(missing))
    assert "cookiefile" not in remote.base_options("x-%(id)s.%(ext)s")

    cookies = tmp_path / "cookies.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n")
    monkeypatch.setenv("NEXUS_YTDLP_COOKIES", str(cookies))
    assert remote.base_options("x-%(id)s.%(ext)s")["cookiefile"] == str(cookies)


def test_env_overrides_are_forwarded(monkeypatch):
    monkeypatch.setenv("NEXUS_YTDLP_PROXY", "socks5://10.0.0.9:1080")
    monkeypatch.setenv("NEXUS_YTDLP_CLIENTS", "web_safari, tv")
    monkeypatch.setenv("NEXUS_YTDLP_JS_RUNTIME", "node:/usr/local/bin/node")
    options = remote.base_options("x-%(id)s.%(ext)s")
    assert options["proxy"] == "socks5://10.0.0.9:1080"
    assert options["extractor_args"]["youtube"]["player_client"] == ["web_safari", "tv"]
    assert options["js_runtimes"] == {"node": {"path": "/usr/local/bin/node"}}


def test_node_runtime_is_used_when_deno_is_absent(monkeypatch):
    monkeypatch.setattr(remote.shutil, "which", lambda name: None if name == "deno" else "/usr/local/bin/node")
    assert remote.base_options("x-%(id)s.%(ext)s")["js_runtimes"] == {"node": {}}


def test_old_ytdlp_is_flagged(monkeypatch):
    monkeypatch.setattr(remote, "version", lambda: "2024.12.23")
    warning = remote.staleness_warning()
    assert warning and "outdated" in warning and "pip install -U yt-dlp" in warning

    monkeypatch.setattr(remote, "version", lambda: "2099.01.01")
    assert remote.staleness_warning() is None


def test_download_remote_respects_the_kill_switch(tmp_path: Path, monkeypatch):
    from app import main
    from app.jobs import Job, JobManager

    monkeypatch.setattr(main, "YTDLP_ENABLED", False)
    manager = JobManager()
    job = manager.create("analyze", ["ingest"])
    with pytest.raises(Exception) as excinfo:
        main.download_remote("https://youtu.be/abc", tmp_path, job)
    assert "disabled" in str(excinfo.value).lower()
