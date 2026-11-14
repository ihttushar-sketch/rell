"""Background job engine.

Video work is long-running, so every request returns a job id immediately. Jobs
run on a small thread pool and expose granular steps, progress and a log tail
that the studio polls. This keeps the studio UI responsive without needing a
Celery/Redis dependency for a local production box.
"""

from __future__ import annotations

import logging
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("nexus.jobs")

STEP_LABELS = {
    "ingest": "Ingest & probe",
    "scene": "Scene cut detection",
    "visuals": "Motion, grade & effect extraction",
    "audio": "Audio fingerprint & beat grid",
    "stems": "3-stem audio isolation",
    "build": "Five-pillar retention mapping",
    "prepare": "Prepare render job",
    "graph": "Build FFmpeg filtergraph",
    "render": "Render frames",
    "mux": "Mux audio & watermark",
    "finalize": "Finalise deliverable",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class JobStep:
    key: str
    label: str
    status: str = "pending"
    progress: float = 0.0
    detail: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "status": self.status,
            "progress": round(self.progress, 4),
            "detail": self.detail,
        }


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"
    progress: float = 0.0
    steps: List[JobStep] = field(default_factory=list)
    logs: List[str] = field(default_factory=list)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=_now)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def to_dict(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "id": self.id,
                "kind": self.kind,
                "status": self.status,
                "progress": round(self.progress, 4),
                "steps": [step.to_dict() for step in self.steps],
                "logs": list(self.logs[-120:]),
                "result": self.result,
                "error": self.error,
                "created_at": self.created_at,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
            }

    # ---- producer API used by analyzer/renderer -------------------------
    def begin(self, key: str, detail: str = "") -> None:
        with self.lock:
            for step in self.steps:
                if step.key == key:
                    step.status = "running"
                    step.progress = max(step.progress, 0.01)
                    if detail:
                        step.detail = detail
                    break
            self.status = "running"
            if not self.started_at:
                self.started_at = _now()
        if detail:
            self.log(detail)

    def step_progress(self, key: str, value: float, detail: str = "", *, log_detail: bool = False) -> None:
        with self.lock:
            for step in self.steps:
                if step.key == key:
                    step.progress = max(0.0, min(1.0, value))
                    if detail:
                        step.detail = detail
                    break
            finished = sum(1 for step in self.steps if step.status == "done")
            current = next((step.progress for step in self.steps if step.status == "running"), 0.0)
            self.progress = max(0.0, min(0.99, (finished + current) / max(1, len(self.steps))))
        if detail and log_detail:
            self.log(detail)

    def complete_step(self, key: str, detail: str = "") -> None:
        with self.lock:
            for step in self.steps:
                if step.key == key:
                    step.status = "done"
                    step.progress = 1.0
                    if detail:
                        step.detail = detail
                    break
            finished = sum(1 for step in self.steps if step.status == "done")
            self.progress = min(0.99, finished / max(1, len(self.steps)))
        if detail:
            self.log(detail)

    def skip_step(self, key: str, detail: str = "") -> None:
        with self.lock:
            for step in self.steps:
                if step.key == key:
                    step.status = "skipped"
                    step.progress = 1.0
                    step.detail = detail
                    break
        if detail:
            self.log(f"{detail} (skipped)")

    def fail_step(self, key: str, detail: str) -> None:
        with self.lock:
            for step in self.steps:
                if step.key == key:
                    step.status = "error"
                    step.detail = detail
                    break
            self.error = detail
            self.status = "error"
            self.finished_at = _now()

    def log(self, message: str) -> None:
        logger.info("[%s] %s", self.id, message)
        with self.lock:
            self.logs.append(message)
            if len(self.logs) > 400:
                del self.logs[:200]

    def succeed(self, result: Dict[str, Any]) -> None:
        with self.lock:
            self.result = result
            self.status = "done"
            self.progress = 1.0
            for step in self.steps:
                if step.status in {"pending", "running"}:
                    step.status = "done"
                    step.progress = 1.0
            self.finished_at = _now()

    def fail(self, message: str) -> None:
        with self.lock:
            self.error = message
            self.status = "error"
            self.finished_at = _now()
            for step in self.steps:
                if step.status == "running":
                    step.status = "error"
        self.log(f"FAILED {message}")


class JobManager:
    def __init__(self, workers: int = 2) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="nexus-job")

    def create(self, kind: str, step_keys: List[str]) -> Job:
        job = Job(
            id=uuid.uuid4().hex[:12],
            kind=kind,
            steps=[JobStep(key=key, label=STEP_LABELS.get(key, key.title())) for key in step_keys],
        )
        with self._lock:
            self._jobs[job.id] = job
            # keep memory bounded on long-running nodes
            if len(self._jobs) > 200:
                oldest = sorted(self._jobs.values(), key=lambda j: j.created_at)[:50]
                for stale in oldest:
                    if stale.status in {"done", "error"}:
                        self._jobs.pop(stale.id, None)
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def submit(self, job: Job, runner: Callable[[Job], Optional[Dict[str, Any]]]) -> Job:
        def execute() -> None:
            try:
                job.status = "running"
                job.started_at = _now()
                result = runner(job)
                job.succeed(result or {})
            except Exception as exc:  # noqa: BLE001 - surface any failure to the studio
                logger.exception("job %s failed", job.id)
                job.fail(str(exc))
                job.log(traceback.format_exc(limit=4))

        self._pool.submit(execute)
        return job

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


MANAGER = JobManager(workers=2)
