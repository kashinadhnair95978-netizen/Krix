"""
Krix AI worker — FastAPI service.

The Next.js app calls ONLY the worker's ``/pipeline`` endpoint (behind a shared
bearer token). The stage endpoints (``/transcribe``, ``/analyze-video``,
``/find-clips``, ``/render-clip``) are for local debugging and integration tests.

Three properties this module guarantees:

1. **Nothing heavy runs on the event loop.** Every endpoint that touches torch
   or FFmpeg is dispatched with ``run_in_threadpool``, so ``/health`` and
   ``/status`` stay answerable while a video is being processed.
2. **Only one job uses the GPU.** ``/pipeline`` work is executed by
   ``services.job_queue`` (a single worker thread), and the debug endpoints take
   the same exclusive GPU lease — they wait rather than competing.
3. **Every failure is structured.** A global exception handler converts raw
   FileNotFoundError / pydantic / CUDA / model errors into the PipelineError
   contract with a stable ``error_code``, and sanitizes the message.

Browser traffic NEVER reaches this service directly.
"""

from __future__ import annotations

import threading
import traceback
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app import config as cfg
from app.config import PipelineError
from app.errors import STAGE_VALIDATION, http_status_for, to_pipeline_error
from app.models.manager import cuda_available, manager
from app.pipeline import run_pipeline
from app.schemas.pipeline import (
    AnalyzeVideoRequest,
    FindClipsRequest,
    PipelineRequest,
    RenderClipRequest,
    TranscribeRequest,
    error,
)
from app.services.job_queue import queue as gpu_queue


def _unauthorized() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={
            "status": "failed",
            "stage": "auth",
            "error_code": "FORBIDDEN",
            "message": "Unauthorized",
        },
    )


def _check_auth(request: Request) -> None:
    if not cfg.AI_WORKER_AUTH_ENABLED:
        return
    if not cfg.AI_WORKER_API_KEY or cfg.AI_WORKER_API_KEY == "changeme":
        raise PipelineError(
            stage="auth",
            code="PIPELINE_INTERNAL",
            message="AI_WORKER_API_KEY is not set on the worker",
        )
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {cfg.AI_WORKER_API_KEY}":
        raise PipelineError(
            stage="auth", code="FORBIDDEN", message="Invalid or missing worker token"
        )


def _error_response(exc: PipelineError) -> JSONResponse:
    return JSONResponse(status_code=http_status_for(exc), content=exc.as_dict())


def create_app() -> FastAPI:
    app = FastAPI(title="Krix AI Worker", version="1.0.0")

    # ---- health / meta -------------------------------------------------

    @app.api_route("/health", methods=["GET", "POST"], include_in_schema=False)
    async def health():
        """Liveness. Must answer while a pipeline job holds the GPU."""
        return {
            "status": "ok",
            "cuda_available": cuda_available(),
            "model_loaded": manager.current,
            "pipeline": True,
            "queue": gpu_queue.snapshot(),
        }

    @app.get("/status")
    async def status():
        return {
            "status": "ok",
            "cuda_available": cuda_available(),
            "device": "cuda" if (cuda_available() and cfg.ASR_DEVICE != "cpu") else "cpu",
            "current_model": manager.current,
            "models": {
                "asr": cfg.ASR_MODEL,
                "aligner": cfg.ASR_ALIGNER_MODEL,
                "vision": cfg.VISION_MODEL,
                "mistral": cfg.MISTRAL_MODEL,
            },
            "quantization": {
                "asr": "bf16",
                "aligner": "bf16",
                "vision": cfg.VISION_QUANTIZATION,
                "mistral": cfg.MISTRAL_QUANTIZATION,
            },
            "pipeline": {
                "max_clips": cfg.MAX_CLIPS,
                "min_clip_duration": cfg.MIN_CLIP_DURATION,
                "max_clip_duration": cfg.MAX_CLIP_DURATION,
                "min_score": cfg.MIN_SCORE,
                "asr_chunk_seconds": cfg.ASR_CHUNK_SECONDS,
                "asr_max_new_tokens": cfg.ASR_MAX_NEW_TOKENS,
                "asr_timestamps": cfg.ASR_ENABLE_TIMESTAMPS,
                "frame_sample_interval": cfg.FRAME_SAMPLE_INTERVAL,
                "max_vision_frames": cfg.MAX_VISION_FRAMES,
                "repurpose_on_complete": cfg.REPURPOSE_ON_COMPLETE,
            },
            "queue": gpu_queue.snapshot(),
        }

    @app.get("/jobs")
    async def list_jobs():
        return {"status": "ok", "queue": gpu_queue.snapshot(), "jobs": gpu_queue.list_jobs()}

    @app.get("/jobs/{job_id}")
    async def get_job(job_id: str):
        job = gpu_queue.get(job_id)
        if job is None:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "failed",
                    "stage": "pipeline",
                    "error_code": "NOT_FOUND",
                    "message": "Unknown job id",
                },
            )
        payload = job.as_dict()
        if isinstance(job.result, dict):
            payload["result"] = {
                k: v
                for k, v in job.result.items()
                if k not in {"transcript", "segments", "words"}
            }
        # The top-level status mirrors the JOB status, not the HTTP status, so a
        # failed job is visible without unwrapping the body.
        return {"status": job.status, "job": payload}

    # ---- pipeline (main integration point) ------------------------------

    @app.post("/pipeline")
    async def start_pipeline(
        payload: PipelineRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        """Queue the full pipeline. Returns immediately; work runs on the queue."""

        def run(job) -> dict:
            # The queue already holds the GPU lease; the pipeline unloads models
            # between stages via ModelManager.
            return run_pipeline(payload)

        try:
            job = gpu_queue.submit(run, kind="pipeline", video_id=payload.video_id)
        except PipelineError as exc:
            return _error_response(exc)

        return {
            "status": "started",
            "video_id": payload.video_id,
            "job_id": job.id,
            "queue_position": gpu_queue.snapshot()["pending"],
        }

    # ---- stage endpoints (debug / integration tests) ---------------------

    @app.post("/transcribe")
    async def transcribe_endpoint(
        payload: TranscribeRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        def work() -> dict:
            from app.models.asr import transcribe
            from app.services.transcription import to_transcript_out_dict

            with gpu_queue.gpu_lease():
                result = transcribe(payload.audio_path)
            out = to_transcript_out_dict(result)
            out["word_count"] = len(result.words)
            out["chunk_count"] = result.chunk_count
            out["aligner_used"] = result.aligner_used
            return out

        try:
            return await run_in_threadpool(work)
        except Exception as exc:  # noqa: BLE001
            return _error_response(to_pipeline_error(exc, stage="transcription"))

    @app.post("/analyze-video")
    async def analyze_endpoint(
        payload: AnalyzeVideoRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        def work() -> dict:
            from app.services.audio import probe
            from app.services.video_analysis import run_video_analysis

            work_dir = cfg.ensure_work_dir() / "analysis"
            work_dir.mkdir(parents=True, exist_ok=True)
            with gpu_queue.gpu_lease():
                events = run_video_analysis(payload.video_path, str(work_dir))
            return {
                "status": "ok",
                "duration": (probe(payload.video_path) or {}).get("duration"),
                "events": events,
            }

        try:
            return await run_in_threadpool(work)
        except Exception as exc:  # noqa: BLE001
            return _error_response(to_pipeline_error(exc, stage="analyzing"))

    @app.post("/find-clips")
    async def find_clips_endpoint(
        payload: FindClipsRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        def work() -> dict:
            from app.services.clip_detection import find_clip_candidates

            with gpu_queue.gpu_lease():
                clips = find_clip_candidates(
                    payload.transcript,
                    payload.visual,
                    payload.duration,
                    max_clips=payload.max_clips,
                    min_duration=payload.min_duration,
                    max_duration=payload.max_duration,
                )
            return {"status": "ok", "clips": clips}

        try:
            return await run_in_threadpool(work)
        except Exception as exc:  # noqa: BLE001
            return _error_response(to_pipeline_error(exc, stage="finding_clips"))

    @app.post("/render-clip")
    async def render_clip_endpoint(
        payload: RenderClipRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        def work() -> dict:
            from app.services.rendering import render_clip

            # Rendering is CPU/FFmpeg only, but it is still part of one clip's
            # production, so it takes the lease to keep timings predictable.
            with gpu_queue.gpu_lease():
                path = render_clip(
                    payload.video_path,
                    payload.output_path,
                    payload.start,
                    payload.end,
                    width=payload.width,
                    height=payload.height,
                    captions_ass=payload.captions_ass,
                )
            return {"status": "ok", "output_path": str(path)}

        try:
            return await run_in_threadpool(work)
        except Exception as exc:  # noqa: BLE001
            return _error_response(to_pipeline_error(exc, stage="rendering"))

    # ---- structured error handling ---------------------------------------

    @app.exception_handler(PipelineError)
    async def pipeline_error_handler(_request: Request, exc: PipelineError):
        return _error_response(to_pipeline_error(exc))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError):
        """FastAPI's default 422 body is not the PipelineError contract."""
        fields = []
        for item in exc.errors():
            location = ".".join(str(part) for part in item.get("loc", ()) if part != "body")
            fields.append(f"{location or 'body'}: {item.get('msg', 'invalid')}")
        return JSONResponse(
            status_code=400,
            content=error(
                "BAD_REQUEST",
                STAGE_VALIDATION,
                "Invalid request — " + "; ".join(fields) if fields else "Invalid request",
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        """Nothing raw ever leaves the worker."""
        traceback.print_exc()
        structured = to_pipeline_error(exc, stage="pipeline")
        print(f"[error] {request.url.path} -> {structured.code}: {structured.message}")
        return _error_response(structured)

    # Start the queue worker eagerly so the first submission does not race it.
    gpu_queue.start()

    return app


app = create_app()
