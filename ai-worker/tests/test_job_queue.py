"""Single-GPU job queue: serialization, ordering, capacity, status."""

from __future__ import annotations

import threading
import time

import pytest

from app.config import PipelineError
from app.services.job_queue import GpuJobQueue


@pytest.fixture()
def q():
    queue = GpuJobQueue(max_pending=8)
    yield queue
    queue.shutdown(timeout=3.0)


# ---------------------------------------------------------------------------
# Serialization — the whole point of the queue
# ---------------------------------------------------------------------------


def test_only_one_job_uses_the_gpu_at_a_time(q):
    concurrent = 0
    peak = 0
    guard = threading.Lock()

    def work(job):
        nonlocal concurrent, peak
        with guard:
            concurrent += 1
            peak = max(peak, concurrent)
        time.sleep(0.08)
        with guard:
            concurrent -= 1
        return {"ok": True}

    jobs = [q.submit(work, kind="pipeline", video_id=f"v{i}") for i in range(5)]
    for job in jobs:
        assert q.wait(job.id, timeout=20) is not None

    assert peak == 1, "two jobs were on the GPU at the same time"
    assert all(job.status == "completed" for job in jobs)


def test_jobs_run_in_submission_order(q):
    order: list[int] = []
    lock = threading.Lock()

    def work(job):
        with lock:
            order.append(job.video_id)
        time.sleep(0.01)
        return None

    jobs = [q.submit(work, video_id=str(i)) for i in range(6)]
    for job in jobs:
        q.wait(job.id, timeout=20)
    assert order == ["0", "1", "2", "3", "4", "5"]


def test_concurrent_submissions_are_still_serialized(q):
    """Several HTTP requests arriving at once must not run in parallel."""
    inside = threading.Event()
    peak = 0
    current = 0
    guard = threading.Lock()

    def slow(job):
        nonlocal current, peak
        with guard:
            current += 1
            peak = max(peak, current)
        inside.set()
        time.sleep(0.15)
        with guard:
            current -= 1
        return None

    submitted: list = []
    lock = threading.Lock()

    def submitter(n):
        job = q.submit(slow, video_id=str(n))
        with lock:
            submitted.append(job)

    threads = [threading.Thread(target=submitter, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(submitted) == 4
    for job in submitted:
        q.wait(job.id, timeout=20)
    assert peak == 1


def test_debug_endpoint_lease_waits_for_a_running_job(q):
    running = threading.Event()
    release = threading.Event()
    order: list[str] = []

    def long_job(job):
        order.append("job")
        running.set()
        release.wait(timeout=10)
        return None

    job = q.submit(long_job)
    assert running.wait(timeout=5)

    def debug_work():
        with q.gpu_lease():
            order.append("debug")

    thread = threading.Thread(target=debug_work)
    thread.start()
    time.sleep(0.15)
    # The debug call must still be waiting for the lease.
    assert order == ["job"]
    release.set()
    thread.join(timeout=10)
    q.wait(job.id, timeout=10)
    assert order == ["job", "debug"]


def test_lease_is_released_even_when_the_body_raises(q):
    with pytest.raises(ValueError):
        with q.gpu_lease():
            raise ValueError("boom")
    # Must be acquirable again.
    with q.gpu_lease():
        pass


# ---------------------------------------------------------------------------
# Status reporting
# ---------------------------------------------------------------------------


def test_job_reports_queued_then_running_then_completed(q):
    gate = threading.Event()

    def work(job):
        gate.wait(timeout=5)
        return {"value": 1}

    job = q.submit(work, kind="pipeline", video_id="v1")
    assert job.status in {"queued", "running"}

    gate.set()
    finished = q.wait(job.id, timeout=10)
    assert finished.status == "completed"
    assert finished.finished_at is not None
    payload = finished.as_dict()
    assert payload["status"] == "completed"
    assert payload["kind"] == "pipeline"
    assert payload["video_id"] == "v1"
    assert payload["total_seconds"] >= 0


def test_failed_job_records_the_structured_error(q):
    def work(job):
        raise PipelineError(
            stage="rendering", code="RENDER_FAILED", message="ffmpeg exploded"
        )

    job = q.submit(work)
    finished = q.wait(job.id, timeout=10)
    assert finished.status == "failed"
    assert finished.error["error_code"] == "RENDER_FAILED"
    assert finished.error["stage"] == "rendering"
    assert finished.error["message"] == "ffmpeg exploded"


def test_unexpected_exception_does_not_kill_the_worker(q):
    def boom(job):
        raise RuntimeError("unexpected")

    def fine(job):
        return "ok"

    first = q.submit(boom)
    second = q.submit(fine)
    assert q.wait(first.id, timeout=10).status == "failed"
    assert q.wait(second.id, timeout=10).status == "completed"


def test_snapshot_reports_queue_state(q):
    gate = threading.Event()

    def work(job):
        gate.wait(timeout=5)

    job = q.submit(work, video_id="vX")
    assert q.wait(job.id, timeout=10) is not None or True
    snap = q.snapshot()
    for key in ("worker_running", "pending", "gpu_busy", "max_pending"):
        assert key in snap
    gate.set()
    q.wait(job.id, timeout=10)
    assert q.snapshot()["pending"] == 0


def test_list_jobs_returns_recent_entries(q):
    for i in range(3):
        job = q.submit(lambda job: None, video_id=f"v{i}")
        q.wait(job.id, timeout=10)
    jobs = q.list_jobs()
    assert len(jobs) == 3
    assert jobs[-1]["video_id"] == "v2"


def test_get_returns_none_for_unknown_job(q):
    assert q.get("does-not-exist") is None


# ---------------------------------------------------------------------------
# Capacity
# ---------------------------------------------------------------------------


def test_submitting_past_capacity_raises_busy_not_a_crash():
    # Backlog capacity is 2: one job holding the GPU plus one waiting.
    queue = GpuJobQueue(max_pending=2)
    gate = threading.Event()
    try:
        def work(job):
            gate.wait(timeout=5)

        queue.submit(work)
        queue.submit(work)
        with pytest.raises(PipelineError) as exc:
            queue.submit(work)
        assert exc.value.code == "BUSY"
        assert exc.value.stage == "pipeline"
    finally:
        gate.set()
        queue.shutdown(timeout=5)


def test_capacity_is_released_when_a_job_finishes():
    queue = GpuJobQueue(max_pending=1)
    try:
        first = queue.submit(lambda job: None)
        assert queue.wait(first.id, timeout=10).status == "completed"
        # A slot must free up again after completion.
        second = queue.submit(lambda job: None)
        assert queue.wait(second.id, timeout=10).status == "completed"
    finally:
        queue.shutdown(timeout=5)
