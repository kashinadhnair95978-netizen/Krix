"""Storage ownership + structured error contract (hermetic — no Supabase)."""

import pytest

from app.config import PipelineError
from app.services import storage


class _FakeTable:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *args, **kwargs):
        return self

    def eq(self, field, value):
        self._rows = [r for r in self._rows if r.get(field) == value]
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def execute(self):
        class _R:
            data = self._rows
        return _R()


class _FakeClient:
    def __init__(self, rows):
        self._rows = rows
        self.table_name = None
        self.storage = None

    def table(self, name):
        self.table_name = name
        return _FakeTable(self._rows)


def test_fetch_video_requires_ids(monkeypatch):
    monkeypatch.setattr(storage, "get_client", lambda: _FakeClient([]))
    with pytest.raises(PipelineError) as exc:
        storage.fetch_video("", "")
    assert exc.value.code == "FORBIDDEN"


def test_fetch_video_rejects_wrong_owner(monkeypatch):
    rows = [{"id": "v1", "user_id": "alice", "storage_path": "alice/1.mp4"}]
    monkeypatch.setattr(storage, "get_client", lambda: _FakeClient(rows))
    with pytest.raises(PipelineError) as exc:
        storage.fetch_video("v1", "mallory")
    assert exc.value.code == "NOT_FOUND"


def test_fetch_video_accepts_owner(monkeypatch):
    rows = [{"id": "v1", "user_id": "alice", "storage_path": "alice/1.mp4"}]
    monkeypatch.setattr(storage, "get_client", lambda: _FakeClient(rows))
    result = storage.fetch_video("v1", "alice")
    assert result["id"] == "v1"


def test_pipeline_error_as_dict_contract():
    exc = PipelineError(stage="rendering", code="RENDER_FAILED", message="boom", extra={"duration": 60})
    d = exc.as_dict()
    assert d["status"] == "failed"
    assert d["stage"] == "rendering"
    assert d["error_code"] == "RENDER_FAILED"
    assert d["message"] == "boom"
    assert d["duration"] == 60


def test_pipeline_error_roundtrip_from_payload():
    exc = PipelineError.from_payload(
        {"status": "failed", "stage": "transcription", "error_code": "TRANSCRIPTION_FAILED", "message": "x", "video_id": "v"}
    )
    assert exc.stage == "transcription"
    assert exc.code == "TRANSCRIPTION_FAILED"
    assert exc.extra == {"video_id": "v"}


@pytest.mark.parametrize(
    "code",
    [
        "UNSUPPORTED_FILE",
        "MODEL_MISSING",
        "CUDA_UNAVAILABLE",
        "MODEL_OUT_OF_MEMORY",
        "CORRUPT_MEDIA",
        "TRANSCRIPTION_FAILED",
        "VISION_FAILED",
        "LLM_INVALID_JSON",
        "CLIP_VALIDATION_FAILED",
        "RENDER_FAILED",
        "STORAGE_UPLOAD_FAILED",
        "WRITE_FAILED",
        "NOT_FOUND",
        "FORBIDDEN",
        "BAD_REQUEST",
        "PIPELINE_INTERNAL",
    ],
)
def test_all_error_codes_are_documented(code):
    from app.schemas.pipeline import ERROR_CODES

    assert code in ERROR_CODES