"""rell API + static web UI.

Run with:  ./run.sh          (or: python -m app.main)
Docs at:   http://localhost:8000/docs
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, Body, FastAPI, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__, config, extractor, history
from .models import (
    BatchRequest,
    CookieRequest,
    HealthResponse,
    InfoRequest,
    LibraryEntry,
    MediaInfo,
    SaveRequest,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
log = logging.getLogger("rell")

STATIC_DIR = Path(__file__).resolve().parent / "static"
STREAM_DIR = config.DOWNLOAD_DIR / ".stream"
STREAM_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="rell",
    version=__version__,
    description=(
        "Paste a Facebook / Instagram reel link and get **everything** from that page: "
        "title, caption, page name, upload date, views, likes, comments, thumbnail, "
        "all available qualities with direct CDN links, and one-click downloads."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Rell-Title"],
)

# Only two heavy jobs at a time keeps small machines responsive.
_DOWNLOAD_SEMAPHORE = threading.Semaphore(2)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _timed_error(exc: Exception) -> JSONResponse:
    message = getattr(exc, "message", str(exc)) or type(exc).__name__
    hint = getattr(exc, "hint", None)
    status = 400 if isinstance(exc, (extractor.UnsupportedURLError, extractor.DomainNotAllowedError)) else 502
    return JSONResponse(status_code=status, content={"detail": message, "hint": hint})


async def _probe(url: str, include_raw: bool = False) -> MediaInfo:
    try:
        return await asyncio.wait_for(
            run_in_threadpool(extractor.probe, url, include_raw),
            timeout=config.EXTRACT_TIMEOUT,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail=f"Extraction timed out after {config.EXTRACT_TIMEOUT}s. The site may be slow or blocking this network.",
        ) from exc
    except extractor.RellError as exc:
        raise HTTPException(status_code=400, detail=exc.message, headers={}) from exc


def _remember(info: MediaInfo) -> None:
    try:
        history.add(
            url=info.url,
            platform=info.platform,
            title=info.title or "",
            ok=info.ok,
            error=info.error,
            thumb=info.thumbnail,
            payload={
                "uploader": info.uploader,
                "duration": info.duration,
                "view_count": info.view_count,
                "best_height": info.best_height,
            },
        )
    except Exception:  # noqa: BLE001 - history must never break a request
        log.exception("history write failed")


def _safe_library_path(name: str) -> Path:
    cleaned = Path(name).name
    if not cleaned or cleaned.startswith("."):
        raise HTTPException(status_code=400, detail="Bad file name")
    target = (config.DOWNLOAD_DIR / cleaned).resolve()
    root = config.DOWNLOAD_DIR.resolve()
    if not str(target).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Bad file name")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found in library")
    return target


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.svg", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------


@app.get("/api/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__, details=config.settings_summary())


@app.get("/api/presets", tags=["meta"])
async def presets() -> dict[str, Any]:
    """Quality presets the UI renders as buttons."""
    items = [
        {"id": "best", "label": "Best available", "note": "highest quality, merges streams if needed"},
        {"id": "2160", "label": "4K · 2160p", "note": "falls back to the best lower quality"},
        {"id": "1440", "label": "2K · 1440p", "note": ""},
        {"id": "1080", "label": "Full HD · 1080p", "note": ""},
        {"id": "720", "label": "HD · 720p", "note": ""},
        {"id": "480", "label": "480p", "note": "smaller file"},
        {"id": "360", "label": "360p", "note": "smallest video"},
        {"id": "audio", "label": "Audio only", "note": "original audio track (m4a/webm)"},
        {"id": "mp3", "label": "MP3", "note": "converted with ffmpeg"},
    ]
    return {
        "items": items,
        "ffmpeg_available": config.HAS_FFMPEG,
        "mp3_available": config.HAS_FFMPEG,
        "selectors": extractor.QUALITY_PRESETS,
    }


@app.post("/api/normalize", tags=["meta"])
async def normalize(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Check a pasted link without touching the network."""
    raw = str(payload.get("url") or "")
    try:
        url = extractor.normalize_url(raw)
        extractor.ensure_domain_allowed(url)
    except extractor.RellError as exc:
        return {"ok": False, "url": raw, "error": exc.message, "hint": exc.hint}
    return {
        "ok": True,
        "url": url,
        "platform": extractor.detect_platform(url),
        "links_found": extractor.split_urls(raw),
    }


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------


@app.post("/api/info", response_model=MediaInfo, tags=["extract"])
async def info(req: InfoRequest) -> MediaInfo:
    """Everything about one page: metadata + every downloadable format."""
    result = await _probe(req.url, req.include_raw)
    _remember(result)
    return result


@app.post("/api/batch", tags=["extract"])
async def batch(req: BatchRequest) -> dict[str, Any]:
    """Handle a whole block of pasted links at once."""
    urls = list(req.urls or [])
    if not urls and req.raw_text:
        urls = extractor.split_urls(req.raw_text)
    urls = urls[:25]
    if not urls:
        raise HTTPException(status_code=400, detail="No links found in the input")

    results: list[dict[str, Any]] = []
    for raw in urls:
        try:
            item = await _probe(raw, req.include_raw)
        except HTTPException as exc:
            item = MediaInfo(
                url=raw,
                ok=False,
                error=str(exc.detail),
                hint="Check the link and try again.",
            )
        _remember(item)
        results.append(item.model_dump(exclude_none=False))

    ok = sum(1 for r in results if r.get("ok"))
    return {"count": len(results), "ok": ok, "failed": len(results) - ok, "results": results}


@app.get("/api/formats", tags=["extract"])
async def formats(url: str = Query(...), quality: Optional[str] = Query(None)) -> dict[str, Any]:
    """Format table only – handy for a quick `curl`."""
    info = await _probe(url)
    if not info.ok:
        raise HTTPException(status_code=502, detail=info.error, headers={})
    chosen = None
    if quality:
        chosen = extractor.quality_selector(quality)
    return {
        "url": info.url,
        "title": info.title,
        "best_height": info.best_height,
        "selector": chosen,
        "formats": [f.model_dump() for f in info.formats],
    }


@app.get("/api/thumb", tags=["extract"])
async def thumb(url: str = Query(...), referer: Optional[str] = Query(None)) -> Response:
    """Proxy a thumbnail so browsers never hit Facebook/Instagram hotlink rules."""
    if not re.match(r"^https?://", url):
        raise HTTPException(status_code=400, detail="thumb url must be http(s)")
    try:
        extractor.ensure_public(url)
    except extractor.RellError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc

    def fetch() -> bytes:
        data = extractor.thumbnail_bytes(url, referer)
        if len(data) > 12 * 1024 * 1024:
            raise ValueError("thumbnail is larger than 12 MB")
        return data

    try:
        data = await run_in_threadpool(fetch)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not fetch thumbnail: {exc}") from exc

    media = "image/jpeg"
    if ".png" in url.lower():
        media = "image/png"
    elif ".webp" in url.lower():
        media = "image/webp"
    return Response(content=data, media_type=media, headers={"Cache-Control": "public, max-age=3600"})


# ---------------------------------------------------------------------------
# downloading
# ---------------------------------------------------------------------------


def _stream_cleanup(folder: Path) -> None:
    shutil.rmtree(folder, ignore_errors=True)


@app.get("/api/download", tags=["download"])
async def download_stream(
    background: BackgroundTasks,
    url: str = Query(..., description="video/reel link"),
    quality: str = Query("best", description="preset id, e.g. best/1080/720/audio/mp3, or a raw format id"),
    filename: Optional[str] = Query(None, description="optional custom file name (no extension needed)"),
) -> FileResponse:
    """Download the file and stream it straight to the browser."""
    job_folder = STREAM_DIR / uuid.uuid4().hex
    job_folder.mkdir(parents=True, exist_ok=True)

    template = str(job_folder / "%(title).80B [%(id)s].%(ext)s")

    def work() -> Path:
        with _DOWNLOAD_SEMAPHORE:
            return extractor.download(url, quality=quality, dest_dir=job_folder, outtmpl=template)

    try:
        path = await run_in_threadpool(work)
    except extractor.RellError as exc:
        background.add_task(_stream_cleanup, job_folder)
        return _timed_error(exc)
    except Exception as exc:  # noqa: BLE001
        background.add_task(_stream_cleanup, job_folder)
        log.exception("stream download failed")
        raise HTTPException(status_code=502, detail=f"Download failed: {exc}") from exc

    if not path.exists():
        background.add_task(_stream_cleanup, job_folder)
        raise HTTPException(status_code=502, detail="Download produced no file")

    serve_name = path.name
    if filename:
        ext = path.suffix or ".mp4"
        serve_name = extractor.safe_filename(filename, "video") + ext

    background.add_task(_stream_cleanup, job_folder)

    try:
        history.add(url=url, platform=extractor.detect_platform(url), title=serve_name, ok=True)
    except Exception:  # noqa: BLE001
        pass

    log.info("streamed %s (%.2f MB)", serve_name, path.stat().st_size / 1_048_576)
    return FileResponse(
        path=str(path),
        filename=serve_name,
        media_type="application/octet-stream",
        background=background,
        headers={"X-Rell-Title": serve_name},
    )


@app.post("/api/save", tags=["download"])
async def save(req: SaveRequest) -> dict[str, Any]:
    """Download into the server-side library folder (progress via /api/jobs)."""
    job = extractor.new_job(req.url)

    def work() -> None:
        with _DOWNLOAD_SEMAPHORE:
            try:
                extractor.download(req.url, quality=req.quality, dest_dir=config.DOWNLOAD_DIR, job=job)
            except Exception as exc:  # noqa: BLE001
                log.warning("save failed: %s", exc)

    threading.Thread(target=work, daemon=True, name=f"rell-save-{job.job_id}").start()
    return {"job_id": job.job_id, "status": job.status, "url": job.url}


@app.get("/api/jobs/{job_id}", tags=["download"])
async def job_status(job_id: str) -> dict[str, Any]:
    job = extractor.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job id")
    return job.model_dump()


# ---------------------------------------------------------------------------
# library
# ---------------------------------------------------------------------------


@app.get("/api/library", response_model=list[LibraryEntry], tags=["library"])
async def library() -> list[LibraryEntry]:
    entries: list[LibraryEntry] = []
    for path in sorted(config.DOWNLOAD_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not path.is_file() or path.name.startswith("."):
            continue
        stat = path.stat()
        entries.append(
            LibraryEntry(
                name=path.name,
                size=stat.st_size,
                size_text=extractor.human_size(stat.st_size),
                modified=stat.st_mtime,
                url=f"/api/library/{path.name}",
            )
        )
    return entries


@app.get("/api/library/{name}", tags=["library"])
async def library_file(name: str) -> FileResponse:
    path = _safe_library_path(name)
    return FileResponse(path=str(path), filename=path.name, media_type="application/octet-stream")


@app.delete("/api/library/{name}", tags=["library"])
async def library_delete(name: str) -> dict[str, Any]:
    path = _safe_library_path(name)
    path.unlink(missing_ok=True)
    return {"deleted": name}


# ---------------------------------------------------------------------------
# cookies (for reels that need a logged-in account)
# ---------------------------------------------------------------------------


@app.post("/api/cookies", tags=["cookies"])
async def set_cookies(req: CookieRequest) -> dict[str, Any]:
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Cookie text is empty")

    if not re.search(r"^(# Netscape HTTP Cookie File|# HTTP Cookie File|\S+\t\S+\t)", text, re.M) and "=" in text:
        # The user pasted a raw `Cookie:` request header – convert it.
        text = _header_to_netscape(text)

    if not text.endswith("\n"):
        text += "\n"   # cookie parsers expect a terminated last line

    config.COOKIES_FILE.write_text(text, encoding="utf-8")
    os.chmod(config.COOKIES_FILE, 0o600)
    extractor.cache.clear()
    count = len([ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")])
    return {"ok": True, "cookie_rows": count, "path": str(config.COOKIES_FILE)}


@app.post("/api/cookies/upload", tags=["cookies"])
async def upload_cookies(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    return await set_cookies(CookieRequest(text=data.decode("utf-8", errors="replace")))


def _header_to_netscape(header: str) -> str:
    """Convert a raw ``Cookie: a=b; c=d`` header into a Netscape cookie file."""
    header = re.sub(r"^cookie:\s*", "", header.strip(), flags=re.I)
    lines = ["# Netscape HTTP Cookie File", "# Generated by rell from a pasted Cookie header", ""]
    for part in header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, _, value = part.partition("=")
        for domain in ("facebook.com", "instagram.com"):
            lines.append("\t".join([f".{domain}", "TRUE", "/", "TRUE", str(int(time.time()) + 31536000), key.strip(), value.strip()]))
    return "\n".join(lines) + "\n"


@app.get("/api/cookies", tags=["cookies"])
async def cookies_status() -> dict[str, Any]:
    exists = config.COOKIES_FILE.exists()
    size = config.COOKIES_FILE.stat().st_size if exists else 0
    rows = 0
    if exists and size:
        rows = len([ln for ln in config.COOKIES_FILE.read_text(errors="replace").splitlines() if ln.strip() and not ln.startswith("#")])
    return {"loaded": bool(exists and size), "rows": rows, "path": str(config.COOKIES_FILE)}


@app.delete("/api/cookies", tags=["cookies"])
async def delete_cookies() -> dict[str, Any]:
    if config.COOKIES_FILE.exists():
        config.COOKIES_FILE.unlink()
    extractor.cache.clear()
    return {"loaded": False}


# ---------------------------------------------------------------------------
# history / cache
# ---------------------------------------------------------------------------


@app.get("/api/history", tags=["history"])
async def get_history(limit: int = Query(30, ge=1, le=200)) -> dict[str, Any]:
    return {"items": history.recent(limit)}


@app.delete("/api/history", tags=["history"])
async def clear_history() -> dict[str, Any]:
    return {"deleted": history.clear()}


@app.delete("/api/cache", tags=["meta"])
async def clear_cache() -> dict[str, Any]:
    extractor.cache.clear()
    return {"cleared": True}


# ---------------------------------------------------------------------------
# error handlers
# ---------------------------------------------------------------------------


@app.exception_handler(extractor.RellError)
async def _rell_error_handler(_: Request, exc: extractor.RellError) -> JSONResponse:
    return _timed_error(exc)


@app.exception_handler(429)
async def _rate_limit_handler(_: Request, exc: Any) -> JSONResponse:
    return JSONResponse(status_code=429, content={"detail": "Too many requests – slow down a little."})


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=bool(os.getenv("RELL_RELOAD")),
        log_level=os.getenv("RELL_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
