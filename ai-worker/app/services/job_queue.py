"""
Single-GPU job queue.

The RTX 4060 Laptop has ONE 8 GB VRAM budget, and the pipeline swaps between
Qwen3-ASR, the forced aligner, Qwen3-VL and Mistral. ``ModelManager`` already
guarantees only one *model* is resident; this module guarantees only one *job*
is using the GPU at a time, which is what actually prevents:

  * a second job evicting / corrupting the first job's model,
  * CUDA OOM caused by two concurrent inference jobs,
  * non-deterministic model churn between stages.

Design (deliberately a local queue, not a distributed broker):

  * ``submit()`` enqueues a callable and returns immediately, so ``POST /pipeline``
    answers ``202`` immediately and the FastAPI event loop is never blocked.
  * A single daemon worker thread drains the queue. Job 1 runs, jobs 2..N wait.
  * ``gpu_lease()`` is a context manager holding the same lock the worker uses.
    Debug endpoints (``/transcribe``, ``/analyze-video``, ``/find-clips``,
    ``/render-clip``) run in a threadpool and take this lease, so they can never
    steal the GPU from a running pipeline job — they simply wait.
  * Job state is exposed for ``GET /status``, ``GET /jobs`` and
    ``GET /jobs/{job_id}``.

Queue state is in-memory only: it lives for the lifetime of the worker process,
which is the correct scope for a single-GPU box.
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from collections import OrderedDict, deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

from app import config as cfg
from app.config import PipelineError

# Terminal states. Anything else is considered active.
TERMINAL_STATES = frozenset({"completed", "failed"})


@dataclass
class Job:
    """One queued unit of GPU work."""

    id: str
    kind: str
    video_id: str | None = None
    status: str = "queued"
    stage: str | None = None
    submitted_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    error: dict | None = None
    result: Any = None

    def as_dict(self) -> dict:
        return {
            "job_id": self.id,
            "kind": self.kind,
            "video_id": self.video_id,
            "status": self.status,
            "stage": self.stage,
            "queued_for_seconds": round((self.started_at or time.time()) - self.submitted_at, 3),
            "running_for_seconds": (
                round(time.time() - self.started_at, 3)
                if self.started_at and self.finished_at is None
                else 0.0
            ),
            "total_seconds": (
                round((self.finished_at or time.time()) - self.submitted_at, 3)
            ),
            "error": self.error,
        }


class GpuJobQueue:
    """A one-worker FIFO queue that hands out exclusive GPU leases."""

    def __init__(self, max_pending: int | None = None) -> None:
        self._max_pending = (
            max_pending if max_pending is not None else cfg.GPU_QUEUE_MAX_PENDING
        )
        self._lock = threading.Lock()
        self._gpu = threading.Lock()  # the actual GPU lease
        self._not_empty = threading.Condition(self._lock)
        self._pending: deque[tuple[Job, Callable[[Job], Any]]] = deque()
        self._jobs: "OrderedDict[str, Job]" = OrderedDict()
        self._current: Job | None = None
        # Jobs accepted but not finished yet. Tracked explicitly so the capacity
        # check never races the dispatcher thread picking up its first item.
        self._outstanding = 0
        self._thread: threading.Thread | None = None
        self._stopping = False

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Start the worker thread. Idempotent."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stopping = False
            self._thread = threading.Thread(
                target=self._run, name="krix-gpu-queue", daemon=True
            )
            self._thread.start()

    def shutdown(self, timeout: float = 5.0) -> None:
        with self._lock:
            self._stopping = True
            self._not_empty.notify_all()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=timeout)

    # -- submission --------------------------------------------------------

    def submit(
        self,
        func: Callable[[Job], Any],
        *,
        kind: str = "pipeline",
        video_id: str | None = None,
    ) -> Job:
        """Enqueue ``func`` for exclusive GPU execution. Returns immediately."""
        job = Job(id=uuid.uuid4().hex, kind=kind, video_id=video_id)
        with self._not_empty:
            # ``max_pending`` is the total backlog: the job holding the GPU plus
            # the ones waiting behind it.
            if self._outstanding >= self._max_pending:
                raise PipelineError(
                    stage="pipeline",
                    code="BUSY",
                    message=(
                        f"GPU queue is full ({self._max_pending} jobs in progress or "
                        "waiting). Retry once the current video finishes."
                    ),
                )
            self._outstanding += 1
            self._jobs[job.id] = job
            self._trim_history_locked()
            self._pending.append((job, func))
            self._not_empty.notify()
        # Start the dispatcher outside the lock so it can grab the lock we are
        # about to release.
        self.start()
        return job

    def _trim_history_locked(self) -> None:
        """Bound the in-memory job history."""
        limit = max(cfg.GPU_QUEUE_STATUS_LIMIT, self._max_pending)
        while len(self._jobs) > limit:
            # Never evict something still active.
            for key, job in list(self._jobs.items()):
                if job.status not in TERMINAL_STATES:
                    continue
                del self._jobs[key]
                break
            else:
                return

    # -- GPU lease ---------------------------------------------------------

    @contextmanager
    def gpu_lease(self) -> Iterator[None]:
        """Exclusive access to the GPU. Used by the debug endpoints."""
        acquired = self._gpu.acquire(timeout=_lease_timeout())
        if not acquired:
            raise PipelineError(
                stage="pipeline",
                code="BUSY",
                message="Could not acquire the GPU lease (another job is running)",
            )
        try:
            yield
        finally:
            self._gpu.release()

    # -- introspection -----------------------------------------------------

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def snapshot(self) -> dict:
        with self._lock:
            pending = len(self._pending)
            return {
                "worker_running": bool(self._thread and self._thread.is_alive()),
                "pending": pending,
                "outstanding": self._outstanding,
                "running": self._current.kind if self._current else None,
                "running_job_id": self._current.id if self._current else None,
                "running_video_id": self._current.video_id if self._current else None,
                "gpu_busy": self._gpu.locked(),
                "max_pending": self._max_pending,
            }

    def list_jobs(self, limit: int = 25) -> list[dict]:
        with self._lock:
            jobs = list(self._jobs.values())[-max(1, limit):]
            out = [j.as_dict() for j in jobs]
        for item, job in zip(out, jobs):
            if job.result is not None and isinstance(job.result, dict):
                item["has_result"] = True
        return out

    def wait(self, job_id: str, timeout: float | None = None) -> Job | None:
        """Block until a job leaves the non-terminal states (test helper)."""
        deadline = None if timeout is None else time.time() + timeout
        while True:
            job = self.get(job_id)
            if job is None or job.status in TERMINAL_STATES:
                return job
            if deadline is not None and time.time() > deadline:
                return job
            time.sleep(0.02)

    # -- worker ------------------------------------------------------------

    def _run(self) -> None:
        while True:
            with self._not_empty:
                while not self._pending:
                    if self._stopping:
                        return
                    self._not_empty.wait(timeout=1.0)
                    if self._stopping and not self._pending:
                        return
                job, func = self._pending.popleft()
                self._current = job
                job.status = "running"
                job.started_at = time.time()

            error: PipelineError | None = None
            try:
                with self._gpu:
                    job.result = func(job)
                job.status = "completed"
            except PipelineError as exc:
                error = exc
            except Exception as exc:  # noqa: BLE001 - queue must never die
                traceback.print_exc()
                error = PipelineError(
                    stage="pipeline",
                    code="PIPELINE_INTERNAL",
                    message=f"Unexpected pipeline failure: {exc}",
                )
            finally:
                if error is not None:
                    job.status = "failed"
                    job.error = error.as_dict()
                job.finished_at = time.time()
                with self._lock:
                    self._current = None
                    self._outstanding = max(0, self._outstanding - 1)


def _lease_timeout() -> float:
    """How long a debug endpoint waits for a free GPU before giving up."""
    return max(1.0, cfg.GPU_LEASE_TIMEOUT)


queue = GpuJobQueue()
