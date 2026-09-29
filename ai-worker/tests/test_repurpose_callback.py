"""Worker -> Next.js /api/repurpose callback: idempotency, secrets, failures."""

from __future__ import annotations

import threading

import pytest

from app import config as cfg
from app.services import repurpose_callback as rc


@pytest.fixture(autouse=True)
def _reset_locks():
    with rc._inflight_guard:
        rc._inflight.clear()
    yield
    with rc._inflight_guard:
        rc._inflight.clear()


def _configure(monkeypatch, **kwargs):
    monkeypatch.setattr(cfg, "REPURPOSE_ON_COMPLETE", kwargs.get("enabled", True))
    monkeypatch.setattr(cfg, "INTERNAL_SERVICE_KEY", kwargs.get("key", "secret-service-key"))
    monkeypatch.setattr(cfg, "APP_BASE_URL", kwargs.get("base", "http://127.0.0.1:9"))
    monkeypatch.setattr(cfg, "REPURPOSE_TIMEOUT", 5.0)


# ---------------------------------------------------------------------------
# Configuration gating
# ---------------------------------------------------------------------------


def test_disabled_callback_does_nothing(monkeypatch):
    _configure(monkeypatch, enabled=False)
    result = rc.trigger_repurpose("v1")
    assert result["triggered"] is False
    assert "disabled" in result["reason"]


def test_missing_service_key_disables_the_callback(monkeypatch):
    _configure(monkeypatch, key="")
    result = rc.trigger_repurpose("v1")
    assert result["triggered"] is False
    assert "INTERNAL_SERVICE_KEY" in result["reason"]


def test_unreachable_app_is_reported_not_raised(monkeypatch):
    _configure(monkeypatch, base="http://127.0.0.1:9")  # discard port
    result = rc.trigger_repurpose("v1")
    assert result["triggered"] is False
    assert "Could not reach" in result["reason"]


# ---------------------------------------------------------------------------
# Request shape — server-to-server auth only
# ---------------------------------------------------------------------------


def test_callback_sends_the_service_key_and_never_a_user_supplied_one(monkeypatch):
    _configure(monkeypatch, base="http://app.internal")
    seen = {}

    class _Response:
        status_code = 200
        text = "{}"

    class _Client:
        def __init__(self, *a, **kw):
            seen["timeout"] = kw.get("timeout")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None, headers=None):
            seen["url"] = url
            seen["json"] = json
            seen["headers"] = headers
            return _Response()

    import sys
    import types

    fake = types.ModuleType("httpx")
    fake.Client = _Client
    monkeypatch.setitem(sys.modules, "httpx", fake)

    result = rc.trigger_repurpose("video-123")
    assert result["triggered"] is True
    assert seen["url"] == "http://app.internal/api/repurpose"
    assert seen["json"] == {"videoId": "video-123"}
    assert seen["headers"]["x-service-key"] == "secret-service-key"
    # No secret ever comes from the caller.
    assert set(seen["headers"]) == {"Content-Type", "x-service-key"}


def test_callback_reports_a_non_2xx_status(monkeypatch):
    _configure(monkeypatch, base="http://app.internal")

    class _Response:
        status_code = 500
        text = "AI provider returned invalid JSON"

    class _Client:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None, headers=None):
            return _Response()

    import sys
    import types

    fake = types.ModuleType("httpx")
    fake.Client = _Client
    monkeypatch.setitem(sys.modules, "httpx", fake)

    result = rc.trigger_repurpose("v1")
    assert result["triggered"] is False
    assert result["status"] == 500
    assert "invalid JSON" in result["detail"]


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def test_repeated_calls_for_one_video_are_serialised(monkeypatch):
    _configure(monkeypatch, base="http://app.internal")
    concurrent = 0
    peak = 0
    guard = threading.Lock()

    class _Response:
        status_code = 200
        text = "{}"

    class _Client:
        def __init__(self, *a, **kw):
            nonlocal concurrent, peak
            with guard:
                concurrent += 1
                peak = max(peak, concurrent)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            nonlocal concurrent
            with guard:
                concurrent -= 1
            return False

        def post(self, url, json=None, headers=None):
            import time

            time.sleep(0.1)
            return _Response()

    import sys
    import types

    fake = types.ModuleType("httpx")
    fake.Client = _Client
    monkeypatch.setitem(sys.modules, "httpx", fake)

    results = []

    def call():
        results.append(rc.trigger_repurpose("same-video"))

    threads = [threading.Thread(target=call) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)

    assert peak == 1, "two repurpose calls for one video overlapped"
    assert len(results) == 3


def test_locks_are_per_video_not_global(monkeypatch):
    _configure(monkeypatch, base="http://127.0.0.1:9")
    a = rc._lock_for("video-a")
    b = rc._lock_for("video-b")
    assert a is not b
    assert rc._lock_for("video-a") is a


def test_lock_registry_is_bounded(monkeypatch):
    monkeypatch.setattr(cfg, "REPURPOSE_ON_COMPLETE", True)
    for i in range(200):
        rc._lock_for(f"video-{i}")
    assert len(rc._inflight) <= 65
