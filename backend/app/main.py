"""NEXUS FRAME production node — FastAPI application.

Endpoints
---------
GET    /api/health                 engine capabilities
GET    /api/frameworks             production vault contents
POST   /api/frameworks             upsert a Framework DNA
DELETE /api/frameworks/{id}        remove a blueprint
POST   /api/frameworks/import      bulk import
POST   /api/analyze                multipart file or URL → deconstruction job
POST   /api/produce                plan + clips (+ BGM) → FFmpeg render job
GET    /api/jobs/{id}              job status / steps / logs / result
GET    /api/files/{path}           Range-enabled media streaming
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from . import __version__, store
from .analyzer import analyze_reference
from .capabilities import snapshot
from .config import (
    ALLOWED_ORIGINS,
    DATA_DIR,
    MAX_TARGET_SEC,
    MAX_UPLOAD_BYTES,
    RENDER_DIR,
    UPLOAD_DIR,
    YTDLP_ENABLED,
)
from .jobs import MANAGER, Job
from .renderer import render_plan
from .schemas import FrameworkDna, ProduceOptions, RenderPlan

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("nexus.api")

ANALYZE_STEPS = ["ingest", "scene", "visuals", "audio", "stems", "build"]
PRODUCE_STEPS = ["prepare", "graph", "render", "finalize"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.init_db()
    logger.info("NEXUS FRAME production node %s ready · data=%s", __version__, DATA_DIR)
    yield
    MANAGER.shutdown()


app = FastAPI(title="NEXUS FRAME Production Node", version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _slug(value: str, fallback: str = "asset") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value or "").strip("-.")
    return (cleaned or fallback)[:80]


async def _save_upload(upload: UploadFile, directory: Path, prefix: str = "") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    suffix = Path(upload.filename or "").suffix.lower() or ".bin"
    target = directory / f"{prefix}{uuid.uuid4().hex[:12]}-{_slug(Path(upload.filename or 'upload').stem)}{suffix}"
    written = 0
    with target.open("wb") as handle:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                handle.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"Upload exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
            handle.write(chunk)
    if written == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty upload")
    return target


def download_remote(url: str, directory: Path, job: Job) -> Path:
    """Fetch a remote video with yt-dlp (YouTube, Shorts, Reels, TikTok, FB…)."""
    if not YTDLP_ENABLED:
        raise RuntimeError("Remote ingestion is disabled on this node (NEXUS_YTDLP=off)")
    try:
        import yt_dlp  # type: ignore
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("yt-dlp is not installed on this node") from exc

    directory.mkdir(parents=True, exist_ok=True)
    template = str(directory / f"remote-{uuid.uuid4().hex[:10]}-%(id)s.%(ext)s")
    options = {
        "outtmpl": {"default": template},
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "socket_timeout": 30,
        "retries": 2,
    }
    job.log(f"Resolving remote stream {url}")
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        if info is None:
            raise RuntimeError("yt-dlp returned no media")
        if "entries" in info:
            info = next((entry for entry in info["entries"] if entry), None)
            if not info:
                raise RuntimeError("Playlist contained no downloadable entry")
        path = Path(ydl.prepare_filename(info))
    if not path.exists():
        candidates = sorted(directory.glob(f"remote-*-{info.get('id', '')}.*"), key=lambda p: p.stat().st_size, reverse=True)
        if not candidates:
            raise RuntimeError("Downloaded media file could not be located")
        path = candidates[0]
    job.log(f"Downloaded {path.name} ({path.stat().st_size / (1024 * 1024):.1f} MB)")
    return path


def _parse_json_field(value: Optional[str], field_name: str) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a JSON object")
    return parsed


# --------------------------------------------------------------------------- #
# health & vault
# --------------------------------------------------------------------------- #
@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "name": "NEXUS FRAME Production Node",
        "version": __version__,
        "docs": "/docs",
        "health": "/api/health",
        "watermark": "top-left 24:24 (enforced)",
    }


@app.get("/api/health")
def health() -> Dict[str, Any]:
    capabilities = snapshot()
    capabilities["vault_count"] = store.count_frameworks()
    capabilities["max_target_sec"] = MAX_TARGET_SEC
    return capabilities


@app.get("/api/frameworks")
def frameworks_index() -> Dict[str, Any]:
    return {"frameworks": store.list_frameworks()}


@app.post("/api/frameworks", status_code=201)
def frameworks_upsert(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        framework = FrameworkDna.model_validate(payload)
    except Exception as exc:  # noqa: BLE001 - pydantic errors are user-facing
        raise HTTPException(status_code=422, detail=f"Invalid Framework DNA: {exc}") from exc
    document = framework.model_dump(mode="json")
    store.upsert_framework(document)
    return document


@app.get("/api/frameworks/{framework_id}")
def frameworks_show(framework_id: str) -> Dict[str, Any]:
    framework = store.get_framework(framework_id)
    if not framework:
        raise HTTPException(status_code=404, detail="Framework not found")
    return framework


@app.delete("/api/frameworks/{framework_id}")
def frameworks_delete(framework_id: str) -> Dict[str, Any]:
    if not store.delete_framework(framework_id):
        raise HTTPException(status_code=404, detail="Framework not found")
    return {"ok": True, "id": framework_id}


@app.post("/api/frameworks/import")
def frameworks_import(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("frameworks") if isinstance(payload.get("frameworks"), list) else [payload]
    stored: List[Dict[str, Any]] = []
    errors: List[str] = []
    for index, item in enumerate(raw):
        try:
            framework = FrameworkDna.model_validate(item)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"item {index}: {exc}")
            continue
        document = framework.model_dump(mode="json")
        document.setdefault("origin", "import")
        store.upsert_framework(document)
        stored.append(document)
    if not stored:
        raise HTTPException(status_code=422, detail="No valid frameworks in payload: " + "; ".join(errors[:3]))
    return {"frameworks": stored, "errors": errors}


# --------------------------------------------------------------------------- #
# analysis
# --------------------------------------------------------------------------- #
@app.post("/api/analyze")
async def analyze(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    framework_name: Optional[str] = Form(default=None),
) -> Dict[str, Any]:
    if not snapshot()["ffmpeg"]:
        raise HTTPException(status_code=503, detail="This node has no ffmpeg binary; analysis unavailable")
    if file is None and not (url and url.strip()):
        raise HTTPException(status_code=422, detail="Provide a video file or a URL")

    saved: Optional[Path] = None
    if file is not None:
        saved = await _save_upload(file, UPLOAD_DIR, prefix="ref-")
        logger.info("Stored reference %s", saved)

    remote_url = (url or "").strip() or None
    job = MANAGER.create("analyze", ANALYZE_STEPS)
    name = (framework_name or "").strip()

    def runner(active: Job) -> Dict[str, Any]:
        source_path = saved
        source_label = saved.name if saved else remote_url or "reference"
        kind = "upload"
        if remote_url and saved is None:
            if not snapshot()["ytdlp"]:
                raise RuntimeError("yt-dlp is not available on this node; upload a file instead")
            active.begin("ingest", "Downloading remote reference with yt-dlp")
            source_path = download_remote(remote_url, UPLOAD_DIR, active)
            source_label = remote_url
            kind = "url"
        assert source_path is not None
        result = analyze_reference(
            active,
            str(source_path),
            framework_name=name,
            source_kind=kind,
            source_label=source_label,
        )
        framework = result["framework"]
        store.upsert_framework(framework)
        active.log(f"Framework saved to vault · {framework['framework_name']}")
        return result

    MANAGER.submit(job, runner)
    return job.to_dict()


# --------------------------------------------------------------------------- #
# production
# --------------------------------------------------------------------------- #
@app.post("/api/produce")
async def produce(
    plan: str = Form(...),
    clips: Optional[List[UploadFile]] = File(default=None),
    clip_urls: Optional[str] = Form(default=None),
    bg_audio: Optional[UploadFile] = File(default=None),
    sfx_audio: Optional[UploadFile] = File(default=None),
    voice_audio: Optional[UploadFile] = File(default=None),
    options: Optional[str] = Form(default=None),
) -> Dict[str, Any]:
    if not snapshot()["ffmpeg"]:
        raise HTTPException(status_code=503, detail="This node has no ffmpeg binary; rendering unavailable")

    plan_payload = _parse_json_field(plan, "plan")
    options_payload = _parse_json_field(options, "options")
    try:
        validated = RenderPlan.model_validate(plan_payload)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Invalid render plan: {exc}") from exc
    if validated.target_duration_sec > MAX_TARGET_SEC:
        raise HTTPException(status_code=422, detail=f"Target duration exceeds {MAX_TARGET_SEC}s limit")

    clip_paths: List[str] = []
    for upload in clips or []:
        if upload and upload.filename:
            clip_paths.append(str(await _save_upload(upload, UPLOAD_DIR, prefix="clip-")))
    remote_urls: List[str] = []
    if clip_urls:
        try:
            parsed_urls = json.loads(clip_urls)
            if isinstance(parsed_urls, list):
                remote_urls = [str(item) for item in parsed_urls if str(item).strip()][:12]
        except json.JSONDecodeError:
            remote_urls = [line.strip() for line in clip_urls.splitlines() if line.strip()][:12]

    bg_path: Optional[str] = None
    if bg_audio is not None and bg_audio.filename:
        bg_path = str(await _save_upload(bg_audio, UPLOAD_DIR, prefix="bgm-"))
    sfx_path: Optional[str] = None
    if sfx_audio is not None and sfx_audio.filename:
        sfx_path = str(await _save_upload(sfx_audio, UPLOAD_DIR, prefix="sfx-"))
    voice_path: Optional[str] = None
    if voice_audio is not None and voice_audio.filename:
        voice_path = str(await _save_upload(voice_audio, UPLOAD_DIR, prefix="voice-"))

    if not clip_paths and not remote_urls:
        raise HTTPException(status_code=422, detail="Provide at least one clip file or clip URL")

    job = MANAGER.create("produce", PRODUCE_STEPS)

    def runner(active: Job) -> Dict[str, Any]:
        resolved = list(clip_paths)
        for remote in remote_urls:
            if len(resolved) >= 12:
                break
            try:
                resolved.append(str(download_remote(remote, UPLOAD_DIR, active)))
            except Exception as exc:  # noqa: BLE001 - keep going with other clips
                active.log(f"Clip URL failed ({remote}): {exc}")
        if not resolved:
            raise RuntimeError("No clips could be resolved")
        active.begin("prepare", f"{len(resolved)} clip(s) ready")
        return render_plan(
            active,
            validated.model_dump(mode="json"),
            resolved,
            bg_audio=bg_path,
            sfx_audio=sfx_path,
            voice_audio=voice_path,
            options=options_payload,
        )

    MANAGER.submit(job, runner)
    return job.to_dict()


# --------------------------------------------------------------------------- #
# jobs & media
# --------------------------------------------------------------------------- #
@app.get("/api/jobs/{job_id}")
def jobs_show(job_id: str) -> Dict[str, Any]:
    job = MANAGER.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


@app.get("/api/files/{path:path}")
def files(path: str, request: Request) -> Response:
    root = DATA_DIR.resolve()
    try:
        target = (DATA_DIR / path).resolve()
        target.relative_to(root)
    except (ValueError, OSError):
        raise HTTPException(status_code=404, detail="File not found") from None
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    size = target.stat().st_size
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    range_header = request.headers.get("range")
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}

    if not range_header:
        return StreamingResponse(_file_chunks(target, 0, size - 1), media_type=media_type, headers={**headers, "Content-Length": str(size)})

    match = _RANGE_RE.match(range_header)
    if not match:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})

    start_raw, end_raw = match.groups()
    if start_raw:
        start = int(start_raw)
        end = int(end_raw) if end_raw else size - 1
    else:
        suffix = int(end_raw or 0)
        start = max(0, size - suffix)
        end = size - 1
    end = min(end, size - 1)
    if start > end or start >= size:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})

    chunk_size = end - start + 1
    return StreamingResponse(
        _file_chunks(target, start, end),
        status_code=206,
        media_type=media_type,
        headers={
            **headers,
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(chunk_size),
        },
    )


def _file_chunks(path: Path, start: int, end: int, block: int = 1024 * 256) -> Iterable[bytes]:
    remaining = end - start + 1
    with path.open("rb") as handle:
        handle.seek(start)
        while remaining > 0:
            chunk = handle.read(min(block, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Internal production node error"})


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=False)
