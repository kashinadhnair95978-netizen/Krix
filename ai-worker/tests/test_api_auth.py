"""API auth + structured failure responses (FastAPI TestClient; skipped if fastapi/httpx missing)."""

import pytest

fastapi = pytest.importorskip("fastapi")
httpx = pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app import config as cfg  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def auth_enabled(monkeypatch):
    monkeypatch.setattr(cfg, "AI_WORKER_AUTH_ENABLED", True)
    monkeypatch.setattr(cfg, "AI_WORKER_API_KEY", "secret-key")
    yield
    monkeypatch.setattr(cfg, "AI_WORKER_AUTH_ENABLED", False)


def test_health_unauthenticated_succeeds(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_health_is_json_ok_without_cuda_models(client):
    # cuda_available() must not crash when torch is absent.
    resp = client.get("/status")
    assert resp.status_code == 200
    assert resp.json()["cuda_available"] in (True, False)


def test_pipeline_requires_bearer_token(client, auth_enabled):
    resp = client.post("/pipeline", json={"video_id": "v", "user_id": "u", "storage_path": "u/x.mp4"})
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "FORBIDDEN"


def test_pipeline_rejects_wrong_token(client, auth_enabled):
    resp = client.post(
        "/pipeline",
        headers={"authorization": "Bearer wrong"},
        json={"video_id": "v", "user_id": "u", "storage_path": "u/x.mp4"},
    )
    assert resp.status_code == 401


def test_pipeline_accepts_valid_token(client, auth_enabled, monkeypatch):
    # Avoid touching real Supabase in the background thread.
    monkeypatch.setattr(cfg, "SUPABASE_URL", "")  # get_client() fails fast → jobs fail fast
    resp = client.post(
        "/pipeline",
        headers={"authorization": "Bearer secret-key"},
        json={"video_id": "v", "user_id": "u", "storage_path": "u/x.mp4"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "started"


def test_stage_endpoints_also_require_auth(client, auth_enabled):
    resp = client.post("/transcribe", json={"audio_path": "x.wav"})
    assert resp.status_code == 401


def test_auth_is_noop_when_disabled(monkeypatch):
    from app.main import _check_auth as check

    monkeypatch.setattr(cfg, "AI_WORKER_AUTH_ENABLED", False)
    monkeypatch.setattr(cfg, "AI_WORKER_API_KEY", "")
    check(None)  # must not raise / not touch request


def test_pipeline_rejects_missing_auth_config(monkeypatch):
    from app.config import PipelineError
    from app.main import _check_auth as check

    monkeypatch.setattr(cfg, "AI_WORKER_AUTH_ENABLED", True)
    monkeypatch.setattr(cfg, "AI_WORKER_API_KEY", "")
    with pytest.raises(PipelineError):
        check(None)