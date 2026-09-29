"""Structured error contract: raw exception mapping + secret redaction."""

from __future__ import annotations

import pytest

from app.config import PipelineError
from app.errors import http_status_for, sanitize, to_pipeline_error


# ---------------------------------------------------------------------------
# Raw exception → PipelineError
# ---------------------------------------------------------------------------


def test_pipeline_error_passes_through_unchanged():
    original = PipelineError(stage="transcription", code="TRANSCRIPTION_FAILED", message="x")
    assert to_pipeline_error(original) is original


def test_file_not_found_during_rendering_becomes_render_failed():
    mapped = to_pipeline_error(FileNotFoundError("no such file"), stage="rendering")
    assert mapped.code == "RENDER_FAILED"
    assert mapped.stage == "rendering"


def test_file_not_found_outside_rendering_is_not_found():
    mapped = to_pipeline_error(FileNotFoundError("gone"), stage="storage")
    assert mapped.code == "NOT_FOUND"


def test_cuda_out_of_memory_is_mapped():
    mapped = to_pipeline_error(RuntimeError("CUDA error: out of memory"))
    assert mapped.code == "MODEL_OUT_OF_MEMORY"


def test_memory_error_is_mapped():
    assert to_pipeline_error(MemoryError()).code == "MODEL_OUT_OF_MEMORY"


def test_generic_cuda_failure_is_mapped_to_cuda_unavailable():
    mapped = to_pipeline_error(RuntimeError("CUDA error: device-side assert triggered"))
    assert mapped.code == "CUDA_UNAVAILABLE"
    assert mapped.stage == "models"


def test_pydantic_validation_error_is_mapped_to_bad_request():
    from pydantic import BaseModel, ValidationError

    class _Model(BaseModel):
        end: float

    try:
        _Model(end="not-a-number")
    except ValidationError as exc:
        mapped = to_pipeline_error(exc)
    assert mapped.code == "BAD_REQUEST"
    assert mapped.stage == "request"


def test_corrupt_media_message_is_mapped():
    mapped = to_pipeline_error(RuntimeError("moov atom not found"), stage="media")
    assert mapped.code == "CORRUPT_MEDIA"


def test_http_error_during_storage_is_mapped():
    exc = type("HTTPError", (Exception,), {})
    mapped = to_pipeline_error(exc("500 Server Error"), stage="storage")
    assert mapped.code == "STORAGE_UPLOAD_FAILED"


def test_connection_error_during_storage_is_mapped():
    mapped = to_pipeline_error(ConnectionError("connection refused"), stage="storage")
    assert mapped.code == "STORAGE_UPLOAD_FAILED"


def test_unknown_exception_falls_back_to_pipeline_internal():
    mapped = to_pipeline_error(ValueError("something odd"), stage="rendering")
    assert mapped.code == "PIPELINE_INTERNAL"
    assert "ValueError" in mapped.message


def test_every_mapped_error_serialises_to_the_contract():
    for exc in (
        FileNotFoundError("x"),
        RuntimeError("CUDA error: out of memory"),
        ValueError("nope"),
        ConnectionError("refused"),
    ):
        payload = to_pipeline_error(exc, stage="transcription").as_dict()
        assert payload["status"] == "failed"
        assert set(payload) >= {"status", "stage", "error_code", "message"}
        assert payload["error_code"] in _KNOWN_CODES


# ---------------------------------------------------------------------------
# Status codes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code,expected",
    [
        ("FORBIDDEN", 401),
        ("NOT_FOUND", 403),
        ("BAD_REQUEST", 400),
        ("BUSY", 429),
        ("RENDER_FAILED", 500),
        ("MODEL_OUT_OF_MEMORY", 500),
    ],
)
def test_http_status_mapping(code, expected):
    assert http_status_for(PipelineError(stage="pipeline", code=code, message="x")) == expected


# ---------------------------------------------------------------------------
# Secret redaction
# ---------------------------------------------------------------------------


def test_sanitize_redacts_jwts():
    token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123signature"
    out = sanitize(f"request failed with Authorization {token}")
    assert token not in out
    assert "[redacted" in out


def test_sanitize_redacts_bearer_headers():
    out = sanitize("Authorization: Bearer sk-super-secret-value-123")
    assert "sk-super-secret-value-123" not in out


def test_sanitize_redacts_provider_keys():
    for key in (
        "sk-abcdefghijklmnop",
        "hf_abcdefghijklmnop",
        "sb_secret_abcdefghijklmnop",
        "rk_live_abcdefghijklmnop",
    ):
        assert key not in sanitize(f"failed using {key}")


def test_sanitize_redacts_env_style_secret_assignments():
    out = sanitize("SUPABASE_SERVICE_ROLE_KEY=sb_secret_zzz_top_secret_value")
    assert "zzz_top_secret_value" not in out
    assert "SUPABASE_SERVICE_ROLE_KEY" in out


def test_sanitize_keeps_useful_diagnostics():
    out = sanitize("HTTP 401 from https://project.supabase.co/rest/v1/videos")
    assert "401" in out
    assert "supabase.co" in out


def test_sanitize_handles_empty_input():
    assert sanitize("") == ""
    assert sanitize(None) == ""


def test_pipeline_error_message_is_sanitized_in_place():
    exc = PipelineError(
        stage="storage",
        code="PIPELINE_INTERNAL",
        message="failed with Bearer sk-abcdefghijklmnop",
    )
    mapped = to_pipeline_error(exc)
    assert "sk-abcdefghijklmnop" not in mapped.as_dict()["message"]


def test_pipeline_error_extra_strings_are_sanitized():
    exc = PipelineError(
        stage="storage",
        code="PIPELINE_INTERNAL",
        message="boom",
        extra={"url": "https://x?key=sk-abcdefghijklmnop"},
    )
    mapped = to_pipeline_error(exc)
    assert "sk-abcdefghijklmnop" not in mapped.as_dict()["url"]


_KNOWN_CODES = {
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
    "BUSY",
    "PIPELINE_INTERNAL",
}
