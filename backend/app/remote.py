"""Remote ingestion (yt-dlp): options, capability probing, actionable errors.

Platforms change their players constantly, so this module keeps the download
configuration in one place and turns yt-dlp's internal errors into instructions a
studio user can act on. Everything is environment-driven and optional:

    NEXUS_YTDLP=off                 disable remote ingestion entirely
    NEXUS_YTDLP_COOKIES=<file>      cookies.txt for bot-checked / private feeds
    NEXUS_YTDLP_PROXY=<url>         http://, https:// or socks5:// proxy
    NEXUS_YTDLP_CLIENTS=web_safari  override YouTube player clients
    NEXUS_YTDLP_JS_RUNTIME=node     JS runtime for signature solving
    NEXUS_YTDLP_IMPERSONATE=chrome  TLS impersonation (needs curl_cffi)
"""

from __future__ import annotations

import os
import re
import shutil
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional

# Older releases silently break whenever a platform ships a new player.
_MIN_SUPPORTED = date(2025, 1, 1)


def version() -> Optional[str]:
    """Installed yt-dlp version, or None when the package is absent."""
    try:
        from yt_dlp.version import __version__  # type: ignore

        return str(__version__)
    except Exception:  # noqa: BLE001 - package missing or metadata unreadable
        return None


def _version_date(raw: Optional[str]) -> Optional[date]:
    if not raw:
        return None
    match = re.match(r"(\d{4})\.(\d{2})\.(\d{2})", raw)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def staleness_warning() -> Optional[str]:
    """Warn when the installed yt-dlp is old enough to break on live platforms."""
    raw = version()
    parsed = _version_date(raw)
    if not parsed or parsed >= _MIN_SUPPORTED:
        return None
    return (
        f"yt-dlp {raw} is outdated — platforms rotate their players constantly and "
        f"remote downloads will start failing. Upgrade the node: pip install -U yt-dlp"
    )


def base_options(template: str) -> Dict[str, Any]:
    """yt-dlp options for a deterministic MP4 pull into ``template``."""
    options: Dict[str, Any] = {
        "outtmpl": {"default": template},
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "concurrent_fragment_downloads": 4,
        "overwrites": True,
    }

    cookies = os.environ.get("NEXUS_YTDLP_COOKIES", "").strip()
    if cookies and Path(cookies).is_file():
        options["cookiefile"] = cookies

    proxy = os.environ.get("NEXUS_YTDLP_PROXY", "").strip()
    if proxy:
        options["proxy"] = proxy

    clients = os.environ.get("NEXUS_YTDLP_CLIENTS", "").strip()
    if clients:
        options["extractor_args"] = {
            "youtube": {"player_client": [client.strip() for client in clients.split(",") if client.strip()]}
        }

    runtime = os.environ.get("NEXUS_YTDLP_JS_RUNTIME", "").strip()
    if runtime:
        name, _, path = runtime.partition(":")
        options["js_runtimes"] = {name.strip().lower(): ({"path": path} if path else {})}
    elif shutil.which("deno") is None and shutil.which("node"):
        # Signature solving needs a JS runtime; node is a fine stand-in for deno.
        options["js_runtimes"] = {"node": {}}

    impersonate = os.environ.get("NEXUS_YTDLP_IMPERSONATE", "").strip()
    if impersonate:
        options["impersonate"] = impersonate

    return options


# Ordered: first matching pattern wins. Messages say *what to do*, not what broke.
_ERROR_HINTS: tuple[tuple[str, str], ...] = (
    (
        r"confirm you'?re not a bot|sign in to confirm|bot.?check|use --cookies",
        "The platform is asking this IP to prove it is human. Export browser cookies to a "
        "file and point NEXUS_YTDLP_COOKIES at it (or run the node on a residential connection).",
    ),
    (
        r"tls/ssl|ssl.?error|connection reset|connection aborted|certificate|"
        r"unable to download (webpage|api page)|getaddrinfo|name or service not known|timed out|"
        r"temporary failure in name resolution|network is unreachable",
        "The node cannot reach the platform from this network (egress blocked or filtered). "
        "Upload the media file instead, or route traffic through NEXUS_YTDLP_PROXY.",
    ),
    (
        r"failed to extract any player response|player response|unable to extract|nsig|"
        r"signature|player js|no video formats found",
        "The platform changed its player and this yt-dlp cannot parse it. Upgrade the node: "
        "pip install -U yt-dlp",
    ),
    (
        r"private video|video unavailable|removed by the uploader|age.?restricted|"
        r"members-only|confirm your age|this video is not available",
        "That video is not publicly downloadable (private, removed, age- or region-restricted). "
        "Use a public link or upload the file.",
    ),
    (
        r"http error 429|too many requests|rate.?limit",
        "The platform rate-limited this node. Wait a few minutes, or supply cookies so requests "
        "are attributed to a session.",
    ),
    (
        r"requested format is not available|no such format",
        "No MP4 stream at or below 1080p was offered for that link.",
    ),
    (
        r"unsupported url|not a valid url|is not a valid",
        "That link is not a media URL yt-dlp understands. Paste the page URL, not a player embed.",
    ),
)

_BOILERPLATE = re.compile(r"(?:\s*;?\s*please report this issue on\s+https?://\S+.*)$", re.I | re.S)


def friendly_error(raw: str) -> str:
    """Strip yt-dlp's boilerplate and append the remediation that applies."""
    text = _BOILERPLATE.sub("", str(raw)).strip()
    text = re.sub(r"^ERROR:\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    detail = text if len(text) <= 220 else text[:217].rstrip() + "…"
    for pattern, hint in _ERROR_HINTS:
        if re.search(pattern, text, re.I):
            return f"{hint} [{detail}]"
    return detail or "Remote download failed for an unknown reason"


__all__ = ["version", "staleness_warning", "base_options", "friendly_error"]
