"""yt-dlp wrapper: URL probing, format listing and downloading.

This module is the only place that talks to yt-dlp so the rest of the app stays
easy to test and easy to read.
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

import yt_dlp
from yt_dlp.utils import DownloadError, sanitize_filename

from . import config
from .models import FormatInfo, JobStatus, MediaInfo

log = logging.getLogger("rell.extractor")

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class RellError(Exception):
    """Base error with a user facing message + optional hint."""

    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.hint = hint


class UnsupportedURLError(RellError):
    pass


class DomainNotAllowedError(RellError):
    pass


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

ALLOW_PRIVATE = os.getenv("RELL_ALLOW_PRIVATE", "").strip().lower() in ("1", "true", "yes", "on")

PLATFORM_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("facebook", re.compile(r"(?:^|\.)(facebook\.com|fb\.watch|fb\.com|m\.facebook\.com|web\.facebook\.com)$", re.I)),
    ("instagram", re.compile(r"(?:^|\.)(instagram\.com|instagr\.am)$", re.I)),
    ("youtube", re.compile(r"(?:^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$", re.I)),
    ("tiktok", re.compile(r"(?:^|\.)(tiktok\.com|vm\.tiktok\.com)$", re.I)),
    ("twitter", re.compile(r"(?:^|\.)(twitter\.com|x\.com)$", re.I)),
    ("threads", re.compile(r"(?:^|\.)(threads\.net|threads\.com)$", re.I)),
]


def normalize_url(raw: str) -> str:
    """Clean up whatever the user pasted into a usable URL.

    Handles missing scheme, tracking junk, mobile hosts and the classic
    ``...?ref=share`` tails people copy from the Facebook / Instagram apps.
    """
    url = (raw or "").strip()
    if not url:
        raise UnsupportedURLError("Empty link", "Paste a video/reel link first.")

    # Some share sheets append text after the URL – grab the first token that
    # looks like a link, otherwise treat the whole string as the URL.
    match = re.search(r"(?:https?://|www\.|m\.|web\.)\S+", url)
    if match:
        url = match.group(0)

    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", url):
        url = "https://" + url

    # Strip trailing punctuation that often comes along with copy/paste.
    url = url.rstrip(".,;:!?)>\"'")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsupportedURLError(
            f"Unsupported scheme '{parsed.scheme}'", "Only http/https links work."
        )
    if not parsed.netloc or "." not in parsed.netloc:
        raise UnsupportedURLError(f"'{raw}' does not look like a link", "Example: https://www.facebook.com/reel/1402267498733776")

    host = parsed.netloc.lower()
    # Normalise mobile / mirror hosts so the canonical extractor matches.
    host_map = {
        "m.facebook.com": "www.facebook.com",
        "web.facebook.com": "www.facebook.com",
        "mbasic.facebook.com": "www.facebook.com",
        "touch.facebook.com": "www.facebook.com",
        "web.facebook.com.": "www.facebook.com",
        "m.instagram.com": "www.instagram.com",
        "web.instagram.com": "www.instagram.com",
    }
    host = host_map.get(host, host)
    rebuilt = parsed._replace(netloc=host)
    return rebuilt.geturl()


def detect_platform(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    for name, pattern in PLATFORM_PATTERNS:
        if pattern.search(host):
            return name
    return host or "unknown"


def is_internal_target(url: str) -> bool:
    """True for loopback / private / link-local hosts (no DNS lookup involved)."""
    host = (urlparse(url).hostname or "").lower().strip("[]")
    if host in ("localhost", "ip6-localhost", "ip6-loopback", "metadata", "metadata.google.internal"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False          # a normal hostname – let yt-dlp resolve it
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def ensure_public(url: str) -> None:
    """Block SSRF-ish targets unless RELL_ALLOW_PRIVATE is set (tests, LAN NAS, …)."""
    if ALLOW_PRIVATE:
        return
    if is_internal_target(url):
        raise DomainNotAllowedError(
            "Refusing to fetch a private/internal address.",
            "Set RELL_ALLOW_PRIVATE=1 if you really want rell to reach your LAN.",
        )


def ensure_domain_allowed(url: str) -> None:
    allowed = config.ALLOWED_DOMAINS
    if not allowed:
        return
    host = (urlparse(url).hostname or "").lower()
    if not any(host == d or host.endswith("." + d) for d in allowed):
        raise DomainNotAllowedError(
            f"{host} is not on the allow-list",
            "Set RELL_ALLOWED_DOMAINS='' to allow every site.",
        )


def split_urls(text: str) -> list[str]:
    """Split a pasted block of text into individual links."""
    if not text:
        return []
    parts = re.split(r"[\s,;]+", text.strip())
    seen: list[str] = []
    for part in parts:
        part = part.strip().rstrip(".,;:!?)>\"'")
        if not part:
            continue
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", part):
            if not re.match(r"^(www\.|m\.|web\.)", part):
                continue
        if part not in seen:
            seen.append(part)
    return seen


# ---------------------------------------------------------------------------
# yt-dlp plumbing
# ---------------------------------------------------------------------------


class _CollectingLogger:
    """Captures yt-dlp noise so we can surface a friendly hint."""

    def __init__(self) -> None:
        self.lines: list[str] = []

    def debug(self, msg: str) -> None:  # noqa: D401 - yt-dlp calls this for info too
        if msg:
            self.lines.append(str(msg))

    def info(self, msg: str) -> None:
        self.debug(msg)

    def warning(self, msg: str) -> None:
        self.debug(msg)

    def error(self, msg: str) -> None:
        self.debug(msg)


def _base_opts(
    logger: _CollectingLogger | None = None,
    download: bool = False,
    outtmpl: str | None = None,
    progress_hook: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": not download,
        "logger": logger or _CollectingLogger(),
        "noplaylist": True,
        "ignoreerrors": False,
        "retries": 2,
        "fragment_retries": 2,
        "socket_timeout": 25,
        "http_headers": {"User-Agent": config.USER_AGENT},
        "concurrent_fragment_downloads": 4,
        "restrictfilenames": False,
        "windowsfilenames": False,
        "merge_output_format": "mp4",
    }
    if config.FFMPEG_DIR:
        opts["ffmpeg_location"] = config.FFMPEG_DIR
    if config.COOKIES_FILE.exists() and config.COOKIES_FILE.stat().st_size > 0:
        opts["cookiefile"] = str(config.COOKIES_FILE)
    browser = os.getenv("RELL_COOKIES_FROM_BROWSER")
    if browser and not opts.get("cookiefile"):
        opts["cookiesfrombrowser"] = tuple(browser.split(":"))
    if download:
        opts["outtmpl"] = outtmpl or str(config.DOWNLOAD_DIR / "%(title).80B [%(id)s].%(ext)s")
        if progress_hook:
            opts["progress_hooks"] = [progress_hook]
    return opts


def _hint_for(message: str, logs: list[str]) -> tuple[str, str | None]:
    blob = (message + "\n" + "\n".join(logs)).lower()

    login_keys = (
        "login", "log in", "logged in", "logged-in", "sign in", "signin",
        "private", "authentication", "cookie", "restricted", "only available to",
        "subscribers only", "members only",
    )
    if any(k in blob for k in login_keys):
        return (
            "This page needs a logged-in account.",
            "Open Settings → Cookies and paste your facebook.com / instagram.com cookies, then try again.",
        )
    if "removed" in blob or "unavailable" in blob or "not exist" in blob or "no longer available" in blob:
        return ("The video is unavailable (removed, deleted or region locked).", None)
    if "http error 403" in blob or "403: forbidden" in blob:
        return ("The CDN refused the request (link expired or region locked).", "Try again – a fresh extraction usually fixes it.")
    if "http error 404" in blob:
        return ("Page not found (404).", "Check the link is complete.")
    if "unable to download webpage" in blob or "getaddrinfo" in blob or "temporary failure in name resolution" in blob or "connection" in blob:
        return (
            "Network error – this machine could not reach the site.",
            "Check the internet connection, or run rell on a machine with normal network access.",
        )
    if "unable to extract" in blob or "unsupported url" in blob or "no video formats" in blob:
        return (
            "The site changed its markup and the extractor is outdated.",
            "Update with: pip install -U yt-dlp",
        )
    if "certificate" in blob or "ssl" in blob:
        return ("TLS/certificate error while contacting the site.", None)
    return ("Could not read this page.", None)


# ---------------------------------------------------------------------------
# Info cache
# ---------------------------------------------------------------------------


class _Cache:
    def __init__(self, ttl: int, max_entries: int) -> None:
        self.ttl = ttl
        self.max_entries = max_entries
        self._lock = threading.Lock()
        self._data: dict[str, tuple[float, MediaInfo]] = {}

    @staticmethod
    def key(url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]

    def get(self, url: str) -> MediaInfo | None:
        with self._lock:
            hit = self._data.get(self.key(url))
            if not hit:
                return None
            ts, info = hit
            if time.time() - ts > self.ttl:
                self._data.pop(self.key(url), None)
                return None
            return info

    def put(self, url: str, info: MediaInfo) -> None:
        with self._lock:
            self._data[self.key(url)] = (time.time(), info)
            while len(self._data) > self.max_entries:
                oldest = min(self._data.items(), key=lambda kv: kv[1][0])[0]
                self._data.pop(oldest, None)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


cache = _Cache(config.CACHE_TTL, config.CACHE_MAX_ENTRIES)


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def human_size(num: Optional[float]) -> str:
    if not num or num <= 0:
        return ""
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(num)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.2f} {unit}"
        size /= 1024
    return ""


def human_duration(seconds: Optional[float]) -> str:
    if not seconds or seconds <= 0:
        return ""
    total = int(float(seconds) + 0.5)   # round half up (Python's round() is banker's)
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def iso_date(raw: Optional[str]) -> Optional[str]:
    """yt-dlp gives YYYYMMDD – make it readable."""
    if not raw or len(str(raw)) != 8:
        return raw
    s = str(raw)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


AUDIO_EXTS = {"m4a", "mp3", "aac", "opus", "ogg", "wav", "flac", "weba", "aiff", "mka", "alac"}
VIDEO_EXTS = {"mp4", "mkv", "webm", "mov", "avi", "flv", "ts", "m2ts", "m4v", "3gp", "mpg", "mpeg", "wmv"}


def parse_formats(info: dict[str, Any]) -> list[FormatInfo]:
    out: list[FormatInfo] = []
    seen: set[str] = set()
    for f in info.get("formats") or []:
        fid = str(f.get("format_id") or f.get("url") or "")[:40]
        if not fid or fid in seen:
            continue
        seen.add(fid)

        vcodec = f.get("vcodec")
        acodec = f.get("acodec")
        video_ext = str(f.get("video_ext") or "").lower()
        audio_ext = str(f.get("audio_ext") or "").lower()
        ext = str(f.get("ext") or "").lower()
        height = f.get("height") or 0
        width = f.get("width") or 0

        # yt-dlp reports codecs on most sites but only *_ext on others
        # (generic / HTML5 sources), so accept either signal.
        has_video = (vcodec not in (None, "none")) or (video_ext not in ("", "none"))
        has_audio = (acodec not in (None, "none")) or (audio_ext not in ("", "none"))
        if not has_video and not has_audio:
            if ext in AUDIO_EXTS:
                has_audio = True
            elif height or width or ext in VIDEO_EXTS:
                has_video, has_audio = True, True

        if has_video and height:
            label = f"{height}p"
            if f.get("fps") and f["fps"] > 30:
                label += f"{int(f['fps'])}"
        elif has_video:
            label = (f.get("format_note") or "").strip() or f"{ext.upper() or 'VIDEO'} video"
        elif has_audio:
            label = "audio"
            if f.get("abr"):
                label = f"audio {int(f['abr'])}k"
        else:
            label = (f.get("format_note") or "").strip() or fid

        size = f.get("filesize") or f.get("filesize_approx") or None
        out.append(
            FormatInfo(
                format_id=str(f.get("format_id") or fid),
                ext=ext or "mp4",
                label=label,
                resolution=f"{width}x{height}" if width and height else (f.get("resolution") or ""),
                width=width or None,
                height=height or None,
                fps=f.get("fps"),
                filesize=size,
                filesize_text=human_size(size),
                vcodec=vcodec if has_video else None,
                acodec=acodec if has_audio else None,
                has_video=has_video,
                has_audio=has_audio,
                tbr=f.get("tbr"),
                protocol=str(f.get("protocol") or ""),
                format_note=str(f.get("format_note") or ""),
                url=f.get("url"),
            )
        )

    # Sort: video renditions first (highest → lowest), then audio.
    out.sort(key=lambda x: (not x.has_video, -(x.height or 0), -(x.tbr or 0)))
    return out


def build_media_info(url: str, info: dict[str, Any], logger: _CollectingLogger) -> MediaInfo:
    formats = parse_formats(info)
    heights = [f.height for f in formats if f.has_video and f.height]
    best_height = max(heights) if heights else None

    thumbnails = []
    for t in (info.get("thumbnails") or [])[-8:]:
        if isinstance(t, dict) and t.get("url"):
            thumbnails.append(
                {
                    "url": t["url"],
                    "width": t.get("width"),
                    "height": t.get("height"),
                    "id": t.get("id"),
                }
            )

    platform = detect_platform(url)
    title = info.get("title") or info.get("fulltitle") or info.get("display_id") or "Untitled"

    return MediaInfo(
        url=url,
        platform=platform,
        extractor=str(info.get("extractor") or info.get("extractor_key") or platform),
        ok=True,
        video_id=info.get("id") or info.get("display_id"),
        title=title,
        description=(info.get("description") or "").strip() or None,
        webpage_url=info.get("webpage_url") or url,
        uploader=info.get("uploader") or info.get("channel") or info.get("creator"),
        uploader_id=info.get("uploader_id") or info.get("channel_id"),
        uploader_url=info.get("uploader_url") or info.get("channel_url"),
        channel=info.get("channel") or info.get("creator"),
        channel_url=info.get("channel_url") or info.get("uploader_url"),
        duration=info.get("duration"),
        duration_text=human_duration(info.get("duration")),
        upload_date=iso_date(info.get("upload_date")),
        timestamp=info.get("timestamp"),
        view_count=info.get("view_count"),
        like_count=info.get("like_count"),
        comment_count=info.get("comment_count"),
        repost_count=info.get("repost_count"),
        thumbnail=info.get("thumbnail"),
        thumbnails=thumbnails,
        tags=list(info.get("tags") or [])[:40],
        categories=list(info.get("categories") or [])[:10],
        is_live=bool(info.get("is_live")),
        availability=info.get("availability"),
        age_limit=info.get("age_limit"),
        formats=formats,
        best_height=best_height,
        best_ext=(formats[0].ext if formats else "mp4"),
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def probe(url: str, include_raw: bool = False, use_cache: bool = True) -> MediaInfo:
    """Extract every detail available for ``url`` without downloading anything."""
    url = normalize_url(url)
    ensure_domain_allowed(url)
    ensure_public(url)

    if use_cache:
        cached = cache.get(url)
        if cached is not None:
            hit = cached.model_copy(deep=True)
            if include_raw and hit.raw is None:
                hit = probe(url, include_raw=True, use_cache=False)
            return hit

    logger = _CollectingLogger()
    opts = _base_opts(logger)
    opts["skip_download"] = True
    opts["extract_flat"] = False

    started = time.time()
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as exc:
        message = str(exc)
        clean = re.sub(r"^ERROR:\s*", "", message).strip()
        short, hint = _hint_for(clean, logger.lines)
        log.warning("probe failed for %s: %s", url, clean[:300])
        return MediaInfo(url=url, platform=detect_platform(url), ok=False, error=clean or short, hint=hint)
    except Exception as exc:  # noqa: BLE001 - always answer with something usable
        message = f"{type(exc).__name__}: {exc}"
        short, hint = _hint_for(message, logger.lines)
        return MediaInfo(url=url, platform=detect_platform(url), ok=False, error=message, hint=hint)

    if not info:
        return MediaInfo(url=url, platform=detect_platform(url), ok=False, error="No info returned", hint=None)

    # Playlists (rare with noplaylist=True) – take the first entry.
    if info.get("_type") == "playlist" and info.get("entries"):
        entries = [e for e in info["entries"] if e]
        if entries:
            info = entries[0]

    result = build_media_info(url, info, logger)
    result.raw = info if include_raw else None
    log.info("probed %s in %.1fs (%d formats)", url, time.time() - started, len(result.formats))

    if use_cache:
        cache.put(url, result)
    return result


# Quality presets -> yt-dlp format selector
QUALITY_PRESETS: dict[str, str] = {
    "best": "bestvideo*+bestaudio/best",
    "2160": "bestvideo*[height<=2160]+bestaudio/best[height<=2160]/best",
    "1440": "bestvideo*[height<=1440]+bestaudio/best[height<=1440]/best",
    "1080": "bestvideo*[height<=1080]+bestaudio/best[height<=1080]/best",
    "720": "bestvideo*[height<=720]+bestaudio/best[height<=720]/best",
    "480": "bestvideo*[height<=480]+bestaudio/best[height<=480]/best",
    "360": "bestvideo*[height<=360]+bestaudio/best[height<=360]/best",
    "small": "worstvideo+worstaudio/worst",
    "audio": "bestaudio/best",
}


def quality_selector(quality: str) -> str:
    """Accept a preset name or a raw yt-dlp format id / selector."""
    q = (quality or "best").strip().lower()
    if q in QUALITY_PRESETS:
        return QUALITY_PRESETS[q]
    if q.endswith("p") and q[:-1].isdigit():
        height = q[:-1]
        return f"bestvideo*[height<={height}]+bestaudio/best[height<={height}]/best"
    return quality  # trust the caller (explicit format id / selector)


def is_audio_only(quality: str) -> bool:
    return (quality or "").strip().lower() in ("audio", "mp3", "m4a")


# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------

JOBS: dict[str, JobStatus] = {}
_JOBS_LOCK = threading.Lock()


def new_job(url: str) -> JobStatus:
    job = JobStatus(job_id=uuid.uuid4().hex[:12], url=url, status="queued")
    with _JOBS_LOCK:
        JOBS[job.job_id] = job
        # keep the dict small
        if len(JOBS) > 200:
            for key in list(JOBS)[:50]:
                JOBS.pop(key, None)
    return job


def get_job(job_id: str) -> JobStatus | None:
    with _JOBS_LOCK:
        return JOBS.get(job_id)


def _make_hook(job: JobStatus) -> Callable[[dict[str, Any]], None]:
    def hook(d: dict[str, Any]) -> None:
        status = d.get("status")
        with _JOBS_LOCK:
            if status == "downloading":
                job.status = "running"
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                if total:
                    job.percent = round(done * 100 / total, 1)
                job.speed = str(d.get("_speed_str") or "").strip()
                job.eta = str(d.get("_eta_str") or "").strip()
            elif status == "finished":
                job.percent = 100.0
                job.speed = ""
                job.eta = ""
                if d.get("filename"):
                    job.filename = str(Path(d["filename"]).name)
    return hook


def download(
    url: str,
    quality: str = "best",
    dest_dir: Path | None = None,
    outtmpl: str | None = None,
    job: JobStatus | None = None,
    on_path: Callable[[Path], None] | None = None,
) -> Path:
    """Download ``url`` and return the path of the produced file."""
    url = normalize_url(url)
    ensure_domain_allowed(url)
    ensure_public(url)

    dest = Path(dest_dir or config.DOWNLOAD_DIR)
    dest.mkdir(parents=True, exist_ok=True)

    template = outtmpl or str(dest / "%(title).80B [%(id)s].%(ext)s")
    logger = _CollectingLogger()
    opts = _base_opts(logger, download=True, outtmpl=template, progress_hook=_make_hook(job) if job else None)
    opts["format"] = quality_selector(quality)

    audio_only = is_audio_only(quality)
    if audio_only and quality.strip().lower() == "mp3":
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ]
        opts["format"] = QUALITY_PRESETS["audio"]
    elif audio_only:
        # keep the native audio container (usually m4a) – fastest and lossless
        opts["format"] = QUALITY_PRESETS["audio"]

    if not config.HAS_FFMPEG:
        # Without ffmpeg merging is impossible – fall back to the best
        # single-file rendition so the user still gets something.
        opts["format"] = "best" if not audio_only else "bestaudio/best"

    before: set[str] = {str(p) for p in dest.rglob("*") if p.is_file()}

    if job:
        with _JOBS_LOCK:
            job.status = "running"

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except DownloadError as exc:
        message = re.sub(r"^ERROR:\s*", "", str(exc)).strip()
        short, hint = _hint_for(message, logger.lines)
        if job:
            with _JOBS_LOCK:
                job.status = "error"
                job.error = message or short
        raise RellError(message or short, hint) from exc
    except Exception as exc:  # noqa: BLE001
        if job:
            with _JOBS_LOCK:
                job.status = "error"
                job.error = str(exc)
        raise RellError(f"{type(exc).__name__}: {exc}") from exc

    after = [p for p in dest.rglob("*") if p.is_file() and str(p) not in before]
    target: Path | None = None

    requested = (info or {}).get("requested_downloads") or []
    if requested and requested[0].get("filepath"):
        candidate = Path(requested[0]["filepath"])
        if candidate.exists():
            target = candidate

    if target is None and after:
        target = max(after, key=lambda p: p.stat().st_mtime)

    if target is None and (info or {}).get("_filename"):
        candidate = Path(info["_filename"])
        if candidate.exists():
            target = candidate

    if target is None:
        message = "Download finished but no file was produced."
        if job:
            with _JOBS_LOCK:
                job.status = "error"
                job.error = message
        raise RellError(message, "Try another quality preset.")

    if job:
        with _JOBS_LOCK:
            job.status = "done"
            job.percent = 100.0
            job.filename = target.name
            job.size = target.stat().st_size

    if on_path:
        on_path(target)
    return target


def safe_filename(name: str, fallback: str = "video") -> str:
    cleaned = sanitize_filename(name or "", restricted=False).strip() or fallback
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:150]


def thumbnail_bytes(target: str, referer: str | None = None) -> bytes:
    """Fetch a thumbnail server-side so the UI is never blocked by hotlink rules."""
    import urllib.request

    req = urllib.request.Request(
        target,
        headers={
            "User-Agent": config.USER_AGENT,
            "Referer": referer or "",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as resp:  # noqa: S310 - explicit https url
        return resp.read()
