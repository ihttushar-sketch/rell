"""Pydantic schemas shared by the API and the web UI."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class FormatInfo(BaseModel):
    """One downloadable rendition of the media."""

    format_id: str
    ext: str = "mp4"
    label: str = ""            # e.g. "1080p", "720p", "audio"
    resolution: str = ""       # e.g. "1080x1920"
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    filesize: Optional[int] = None
    filesize_text: str = ""
    vcodec: Optional[str] = None
    acodec: Optional[str] = None
    has_video: bool = False
    has_audio: bool = False
    tbr: Optional[float] = None       # total bitrate kbps
    protocol: str = ""
    format_note: str = ""
    url: Optional[str] = None         # direct CDN link (may expire quickly)


class MediaInfo(BaseModel):
    """Everything rell could read out of a page."""

    url: str
    platform: str = "unknown"
    extractor: str = ""
    ok: bool = True
    error: Optional[str] = None
    hint: Optional[str] = None        # human friendly "what to do next"

    video_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    webpage_url: Optional[str] = None

    uploader: Optional[str] = None
    uploader_id: Optional[str] = None
    uploader_url: Optional[str] = None
    channel: Optional[str] = None
    channel_url: Optional[str] = None

    duration: Optional[float] = None
    duration_text: str = ""
    upload_date: Optional[str] = None
    timestamp: Optional[int] = None

    view_count: Optional[int] = None
    like_count: Optional[int] = None
    comment_count: Optional[int] = None
    repost_count: Optional[int] = None

    thumbnail: Optional[str] = None
    thumbnails: list[dict[str, Any]] = Field(default_factory=list)

    tags: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)

    is_live: bool = False
    availability: Optional[str] = None
    age_limit: Optional[int] = None

    formats: list[FormatInfo] = Field(default_factory=list)
    best_height: Optional[int] = None
    best_ext: str = "mp4"

    raw: Optional[dict[str, Any]] = None   # full yt-dlp dict, only on request


class InfoRequest(BaseModel):
    url: str
    include_raw: bool = False


class BatchRequest(BaseModel):
    urls: list[str] = Field(default_factory=list)
    raw_text: Optional[str] = None      # newline separated, used when urls is empty
    include_raw: bool = False


class SaveRequest(BaseModel):
    url: str
    quality: str = "best"
    folder: Optional[str] = None


class JobStatus(BaseModel):
    job_id: str
    url: str
    status: Literal["queued", "running", "done", "error"] = "queued"
    percent: float = 0.0
    speed: str = ""
    eta: str = ""
    filename: Optional[str] = None
    size: Optional[int] = None
    error: Optional[str] = None


class CookieRequest(BaseModel):
    text: str


class LibraryEntry(BaseModel):
    name: str
    size: int
    size_text: str
    modified: float
    url: str


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    details: dict[str, Any]
