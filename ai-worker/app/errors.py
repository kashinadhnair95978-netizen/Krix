"""
Structured error mapping + message sanitization.

Every failure that leaves the worker must match the PipelineError contract::

    {"status": "failed", "stage": "...", "error_code": "...", "message": "..."}

Raw Python/CUDA/pydantic errors must never escape as an ad-hoc response shape.
:func:`to_pipeline_error` maps them onto that contract, and :func:`sanitize`
strips anything credential-shaped out of the message before it is stored on a
video row or returned to the browser.
"""

from __future__ import annotations

import re

from app.config import PipelineError

# Stages used for a request-validation failure (before any stage has run).
STAGE_VALIDATION = "request"

# Substrings that identify an error class, most specific first.
_OUT_OF_MEMORY = ("out of memory", "cuda oom", "cuda error: out of memory", "oom")
_CUDA = ("cuda", "cublas", "cudnn", "nccl", "no kernel image", "device-side assert")
_CORRUPT = ("invalid data found", "moov atom not found", "could not find codec",
            "invalid argument", "truncated", "end of file", "unrecognized")


def sanitize(message: str) -> str:
    """Redact credential-shaped substrings from a message.

    Keeps the diagnostic value ("HTTP 401 from https://…") while making sure a
    token, JWT or key can never reach a client, a log, or the database.
    """
    if not message:
        return ""
    text = str(message)
    # JWTs (header.payload.signature)
    text = re.sub(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+", "[redacted-token]", text)
    # Common provider / Supabase key shapes.
    text = re.sub(
        r"\b(sk|pk|rk|sb|sb_secret|hf|api|key|token|secret)[-_][A-Za-z0-9_\-]{8,}",
        "[redacted-key]",
        text,
        flags=re.IGNORECASE,
    )
    # Authorization headers.
    text = re.sub(r"(?i)(bearer|basic)\s+[A-Za-z0-9._\-]{8,}", r"\1 [redacted]", text)
    # key=value assignments for anything secret-looking.
    text = re.sub(
        r"(?i)\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*[=:]\s*\S+",
        r"\1=[redacted]",
        text,
    )
    return text


def to_pipeline_error(exc: BaseException, *, stage: str = "pipeline") -> PipelineError:
    """Wrap any exception in the structured contract, preserving the cause."""
    if isinstance(exc, PipelineError):
        exc.message = sanitize(exc.message)
        for key in list(exc.extra):
            if isinstance(exc.extra[key], str):
                exc.extra[key] = sanitize(exc.extra[key])
        return exc

    message = sanitize(str(exc) or exc.__class__.__name__)
    lowered = message.lower()

    # torch CUDA OOM surfaces as torch.cuda.OutOfMemoryError, a RuntimeError
    # subclass, or (on some driver paths) a bare RuntimeError.
    if isinstance(exc, MemoryError) or any(token in lowered for token in _OUT_OF_MEMORY):
        return PipelineError(
            stage=stage,
            code="MODEL_OUT_OF_MEMORY",
            message=f"GPU ran out of memory: {message}",
        )

    if isinstance(exc, (FileNotFoundError, IsADirectoryError, NotADirectoryError, PermissionError)):
        code = "RENDER_FAILED" if stage == "rendering" else "NOT_FOUND"
        return PipelineError(stage=stage, code=code, message=message)

    if isinstance(exc, (ConnectionError, TimeoutError)):
        return PipelineError(
            stage=stage,
            code="STORAGE_UPLOAD_FAILED" if stage == "storage" else "PIPELINE_INTERNAL",
            message=message,
        )

    if exc.__class__.__name__ == "ValidationError":
        return PipelineError(stage=STAGE_VALIDATION, code="BAD_REQUEST", message=message)

    if exc.__class__.__name__ == "HTTPError":
        return PipelineError(stage=stage, code="STORAGE_UPLOAD_FAILED", message=message)

    if any(token in lowered for token in _CORRUPT):
        return PipelineError(stage="media", code="CORRUPT_MEDIA", message=message)

    if any(token in lowered for token in _CUDA):
        return PipelineError(
            stage="models", code="CUDA_UNAVAILABLE", message=f"CUDA failure: {message}"
        )

    return PipelineError(
        stage=stage,
        code="PIPELINE_INTERNAL",
        message=f"{exc.__class__.__name__}: {message}",
    )


def http_status_for(exc: PipelineError) -> int:
    """HTTP status for a structured error.

    The PipelineError contract itself is a 500 for genuine pipeline failures;
    auth/ownership failures map to 401/403 so Next.js can react correctly.
    """
    if exc.code == "FORBIDDEN":
        return 401
    if exc.code == "NOT_FOUND":
        return 403
    if exc.code == "BAD_REQUEST":
        return 400
    if exc.code == "BUSY":
        return 429
    if exc.stage == STAGE_VALIDATION:
        return 400
    return 500
