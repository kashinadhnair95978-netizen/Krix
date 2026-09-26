"""
Krix AI worker — FastAPI service.

The Next.js app calls ONLY the worker's /pipeline endpoint (behind a shared
bearer token). The stage endpoints (/transcribe, /analyze-video, /find-clips,
/render-clip) are for local debugging and integration tests. Models are loaded
once per stage via ModelManager and freed between stages.

Browser traffic NEVER reaches this service directly.
"""

from __future__ import annotations

import threading
import traceback
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from app import config as cfg
from app.config import PipelineError
from app.models.manager import cuda_available, manager
from app.pipeline import run_pipeline
from app.schemas.pipeline import (
    AnalyzeVideoRequest,
    FindClipsRequest,
    PipelineRequest,
    RenderClipRequest,
    TranscribeRequest,
)


def _unauthorized() -> JSONResponse:
    return JSONResponse(status_code=401, content={"status": "failed", "error_code": "FORBIDDEN", "message": "Unauthorized"})


def _check_auth(request: Request) -> None:
    if not cfg.AI_WORKER_AUTH_ENABLED:
        return
    if not cfg.AI_WORKER_API_KEY or cfg.AI_WORKER_API_KEY == "changeme":
        raise PipelineError(stage="auth", code="PIPELINE_INTERNAL", message="AI_WORKER_API_KEY is not set on the worker")
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {cfg.AI_WORKER_API_KEY}":
        raise PipelineError(stage="auth", code="FORBIDDEN", message="Invalid or missing worker token")


def _handle(result):
    if isinstance(result, dict) and result.get("status") == "failed":
        return JSONResponse(status_code=500, content=result)
    return result


def run_in_thread(func):
    thread = threading.Thread(target=func, daemon=True)
    thread.start()


def create_app() -> FastAPI:
    app = FastAPI(title="Krix AI Worker", version="0.1.0")

    # ---- health / meta -------------------------------------------------

    @app.api_route("/health", methods=["GET", "POST"], include_in_schema=False)
    async def health():
        return {
            "status": "ok",
            "cuda_available": cuda_available(),
            "model_loaded": manager.current,
            "pipeline": True,
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
            "pipeline": {
                "max_clips": cfg.MAX_CLIPS,
                "min_clip_duration": cfg.MIN_CLIP_DURATION,
                "max_clip_duration": cfg.MAX_CLIP_DURATION,
            },
        }

    # ---- pipeline (main integration point) ------------------------------

    @app.post("/pipeline")
    async def start_pipeline(
        payload: PipelineRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        def background() -> None:
            try:
                run_pipeline(payload)
            except PipelineError as exc:
                print(f"[pipeline] failed: {exc.stage} {exc.code}: {exc.message}")
            except Exception:  # noqa: BLE001
                traceback.print_exc()

        run_in_thread(background)
        return {"status": "started", "video_id": payload.video_id}

    # ---- stage endpoints (debug / integration tests) ---------------------

    @app.post("/transcribe")
    async def transcribe_endpoint(
        payload: TranscribeRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        try:
            from app.models.asr import transcribe
            from app.services.transcription import to_transcript_out_dict

            result = transcribe(payload.audio_path)
            return to_transcript_out_dict(result)
        except PipelineError as exc:
            return _handle(exc.as_dict())

    @app.post("/analyze-video")
    async def analyze_endpoint(
        payload: AnalyzeVideoRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        try:
            work_dir = cfg.ensure_work_dir() / "analysis"
            work_dir.parent.mkdir(parents=True, exist_ok=True)
            from app.services.video_analysis import run_video_analysis
            from app.services.audio import probe

            events = run_video_analysis(payload.video_path, str(work_dir))
            return {"status": "ok", "duration": (probe(payload.video_path) or {}).get("duration"), "events": events}
        except PipelineError as exc:
            return _handle(exc.as_dict())

    @app.post("/find-clips")
    async def find_clips_endpoint(
        payload: FindClipsRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        try:
            from app.services.clip_detection import find_clip_candidates

            clips = find_clip_candidates(
                payload.transcript,
                payload.visual,
                payload.duration,
                max_clips=payload.max_clips,
                min_duration=payload.min_duration,
                max_duration=payload.max_duration,
            )
            return {"status": "ok", "clips": clips}
        except PipelineError as exc:
            return _handle(exc.as_dict())

    @app.post("/render-clip")
    async def render_clip_endpoint(
        payload: RenderClipRequest,
        _auth: Annotated[None, Depends(_check_auth)],
    ):
        try:
            from app.services.rendering import render_clip

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
        except PipelineError as exc:
            return _handle(exc.as_dict())

    # ---- structured error handling for uncaught PipelineError -------------

    @app.exception_handler(PipelineError)
    async def pipeline_error_handler(_request: Request, exc: PipelineError):
        status = 401 if exc.code == "FORBIDDEN" else 403 if exc.code == "NOT_FOUND" else 500
        return JSONResponse(status_code=status, content=exc.as_dict())

    return app


app = create_app()