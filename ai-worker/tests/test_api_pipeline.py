"""
FastAPI behaviour tests: auth, structured errors, the single-GPU queue and
endpoint responsiveness. No models are loaded and no Supabase is touched — the
pipeline body is stubbed so only the HTTP/queue layer is under test.
"""

import time

import pytest

fastapi = pytest.importorskip("fastapi")
httpx = pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app import config as cfg  # noqa: E402
from app.config import PipelineError  # noqa: E402
from app.main import app  # noqa: E402
from app.services.job_queue import queue as gpu_queue  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def auth_enabled(monkeypatch):
    monkeypatch.setattr(cfg, "AI_WORKER_AUTH_ENABLED", True)
    monkeypatch.setattr(cfg, "AI_WORKER_API_KEY", "secret-key")
    yield
    monkeypatch.setattr(cfg, "AI_WORKER_AUTH_ENABLED", False)


def _drain():
    """Wait until the queue is empty so tests do not bleed into each other."""
    deadline = time.time() + 20
    while time.time() < deadline:
        if gpu_queue.snapshot()["outstanding"] == 0:
            return
        time.sleep(0.05)


# ---------------------------------------------------------------------------
# Health / status
# ---------------------------------------------------------------------------


def test_health_reports_queue_state(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert "queue" in body


def test_status_is_available_unauthenticated(client):
    body = client.get("/status").json()
    assert "cuda_available" in body
    assert isinstance(body["cuda_available"], bool)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_pipeline_requires_the_bearer_token(client, auth_enabled):
    resp = client.post(
        "/pipeline", json={"video_id": "v", "user_id": "u", "storage_path": "u/x.mp4"}
    )
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "FORBIDDEN"


def test_pipeline_rejects_a_wrong_token(client, auth_enabled):
    resp = client.post(
        "/pipeline",
        headers={"authorization": "Bearer wrong"},
        json={"video_id": "v", "user_id": "u", "storage_path": "u/x.mp4"},
    )
    assert resp.status_code == 401


def test_stage_endpoints_also_require_auth(client, auth_enabled):
    for path, payload in (
        ("/transcribe", {"audio_path": "x.wav"}),
        ("/analyze-video", {"video_path": "x.mp4", "work_dir": "w"}),
        ("/find-clips", {"segments": [], "visual": [], "duration": 10}),
        ("/render-clip", {"video_path": "x.mp4", "start": 0, "end": 5}),
    ):
        assert client.post(path, json=payload).status_code == 401, path


# ---------------------------------------------------------------------------
# Structured errors
# ---------------------------------------------------------------------------


def test_validation_error_is_structured_not_a_500(client, auth_enabled):
    resp = client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v"},  # missing user_id / storage_path
    )
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "BAD_REQUEST"


def test_unknown_job_returns_404(client):
    resp = client.get("/jobs/nope")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Queueing
# ---------------------------------------------------------------------------


def test_pipeline_returns_immediately_and_runs_in_the_background(
    client, auth_enabled, monkeypatch
):
    import app.main as main_mod

    started = time.time()

    def slow_pipeline(_request):
        time.sleep(0.6)
        return {"ok": True}

    monkeypatch.setattr(main_mod, "run_pipeline", slow_pipeline)
    resp = client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v-queued", "user_id": "u", "storage_path": "u/x.mp4"},
    )
    elapsed = time.time() - started

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "started"
    assert body["job_id"]
    # The HTTP call must not have waited for the work to finish.
    assert elapsed < 0.4, f"/pipeline blocked the event loop for {elapsed:.2f}s"

    job = gpu_queue.wait(body["job_id"], timeout=20)
    assert job is not None
    assert job.status == "completed"
    _drain()


def test_status_endpoint_stays_responsive_while_a_job_runs(
    client, auth_enabled, monkeypatch
):
    import app.main as main_mod

    running = time.time()

    def slow_pipeline(_request):
        time.sleep(1.0)
        return {"ok": True}

    monkeypatch.setattr(main_mod, "run_pipeline", slow_pipeline)
    start = client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v-busy", "user_id": "u", "storage_path": "u/x.mp4"},
    ).json()

    # While the GPU job runs, /health and /status must still answer instantly.
    for path in ("/health", "/status", "/jobs"):
        t0 = time.time()
        resp = client.get(path)
        elapsed = time.time() - t0
        assert resp.status_code == 200, path
        assert elapsed < 0.3, f"{path} took {elapsed:.2f}s while a job held the GPU"

    gpu_queue.wait(start["job_id"], timeout=30)
    _drain()


def test_job_failure_is_reported_with_the_structured_contract(
    client, auth_enabled, monkeypatch
):
    import app.main as main_mod

    def failing(_request):
        raise PipelineError(
            stage="rendering", code="RENDER_FAILED", message="ffmpeg exited 1"
        )

    monkeypatch.setattr(main_mod, "run_pipeline", failing)
    job_id = client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v-fail", "user_id": "u", "storage_path": "u/x.mp4"},
    ).json()["job_id"]

    job = gpu_queue.wait(job_id, timeout=20)
    assert job.status == "failed"
    assert job.error["error_code"] == "RENDER_FAILED"
    assert job.error["stage"] == "rendering"

    body = client.get(f"/jobs/{job_id}").json()
    assert body["status"] == "failed"
    assert body["job"]["status"] == "failed"
    assert body["job"]["error"]["error_code"] == "RENDER_FAILED"
    _drain()


def test_unexpected_exception_does_not_kill_the_worker(
    client, auth_enabled, monkeypatch
):
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "run_pipeline", lambda _r: 1 / 0)
    first = client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v-boom", "user_id": "u", "storage_path": "u/x.mp4"},
    ).json()["job_id"]
    assert gpu_queue.wait(first, timeout=20).status == "failed"

    monkeypatch.setattr(main_mod, "run_pipeline", lambda _r: {"ok": 1})
    second = client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v-ok", "user_id": "u", "storage_path": "u/x.mp4"},
    ).json()["job_id"]
    # The queue worker must still be alive and accept new work.
    assert gpu_queue.wait(second, timeout=20).status == "completed"
    _drain()


def test_jobs_listing_includes_recent_jobs(client, auth_enabled, monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "run_pipeline", lambda _r: {"ok": 1})
    client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v-list", "user_id": "u", "storage_path": "u/x.mp4"},
    )
    _drain()
    body = client.get("/jobs").json()
    assert body["jobs"]
    assert any(j.get("video_id") == "v-list" for j in body["jobs"])


def test_full_queue_returns_structured_busy(client, auth_enabled, monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "run_pipeline", lambda _r: time.sleep(0.5))
    # Force a tiny backlog for this test.
    original = gpu_queue._max_pending
    gpu_queue._max_pending = 1
    try:
        client.post(
            "/pipeline",
            headers={"authorization": "Bearer secret-key"},
            json={"video_id": "busy-1", "user_id": "u", "storage_path": "u/x.mp4"},
        )
        client.post(
            "/pipeline",
            headers={"authorization": "Bearer secret-key"},
            json={"video_id": "busy-2", "user_id": "u", "storage_path": "u/x.mp4"},
        )
        resp = client.post(
            "/pipeline",
            headers={"authorization": "Bearer secret-key"},
            json={"video_id": "busy-3", "user_id": "u", "storage_path": "u/x.mp4"},
        )
        assert resp.status_code == 429
        assert resp.json()["error_code"] == "BUSY"
    finally:
        gpu_queue._max_pending = original
        _drain()
