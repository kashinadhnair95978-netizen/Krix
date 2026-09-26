"""
Supabase storage + database bridge (worker runs with the SERVICE ROLE key only
server-side). Every read/write is scoped to the {video_id, user_id} pair the
pipeline request carries — ownership is verified before any operation, so one
user can never touch another user's videos.

Write paths only ever store: stage/status/transcript/segments/duration on the
video row, job records, clip candidates and generated-clip rows — never large
media blobs (media lives in Storage).
"""

from __future__ import annotations

import uuid
from pathlib import Path

from app import config as cfg
from app.config import PipelineError


_client = None


def get_client():
    global _client
    if _client is None:
        if not cfg.SUPABASE_URL or not cfg.SUPABASE_SERVICE_ROLE_KEY:
            raise PipelineError(
                stage="storage",
                code="PIPELINE_INTERNAL",
                message="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured in the worker",
            )
        try:
            from supabase import create_client

            _client = create_client(
                cfg.SUPABASE_URL,
                cfg.SUPABASE_SERVICE_ROLE_KEY,
            )
        except Exception as exc:
            raise PipelineError(
                stage="storage",
                code="PIPELINE_INTERNAL",
                message=f"Could not create Supabase client: {exc}",
            ) from exc
    return _client


# ---------------------------------------------------------------------------
# Ownership / validation
# ---------------------------------------------------------------------------


def fetch_video(video_id: str, user_id: str) -> dict:
    """Fetch a video row, requiring ownership. Never trusts caller-supplied paths."""
    if not video_id or not user_id:
        raise PipelineError(stage="storage", code="FORBIDDEN", message="Missing video_id or user_id")
    client = get_client()
    try:
        data = (
            client.table("videos")
            .select("*")
            .eq("id", video_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
            .data
        )
    except Exception as exc:
        raise PipelineError(
            stage="storage", code="PIPELINE_INTERNAL", message=f"DB query failed: {exc}"
        ) from exc
    if not data:
        raise PipelineError(
            stage="storage",
            code="NOT_FOUND",
            message="Video not found for this user",
        )
    return data[0]


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


def download_video(storage_path: str, dest: str | Path) -> str:
    client = get_client()
    try:
        blob = (
            client.storage.from_(cfg.VIDEOS_BUCKET)
            .download(storage_path)
        )
    except Exception as exc:
        raise PipelineError(
            stage="storage",
            code="NOT_FOUND",
            message=f"Could not download video from storage: {exc}",
        ) from exc
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)
    return str(dest)


def upload_clip(user_id: str, local_path: str | Path, filename: str | None = None) -> dict:
    client = get_client()
    local = Path(local_path).resolve()
    name = filename or f"{uuid.uuid4().hex}.mp4"
    remote_path = f"{user_id}/clips/{name}"

    with local.open("rb") as fh:
        try:
            res = (
                client.storage.from_(cfg.CLIPS_BUCKET)
                .upload(remote_path, fh, {"content-type": "video/mp4"})
            )
        except Exception as exc:
            raise PipelineError(
                stage="storage",
                code="STORAGE_UPLOAD_FAILED",
                message=f"Clip upload to storage failed: {exc}",
            ) from exc
    if getattr(res, "error", None) is not None:
        raise PipelineError(
            stage="storage",
            code="STORAGE_UPLOAD_FAILED",
            message=f"Clip upload to storage failed: {res.error}",
        )
    return {
        "path": remote_path,
        "bucket": cfg.CLIPS_BUCKET,
        "size": local.stat().st_size,
    }


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def create_job(video_id: str, user_id: str) -> str:
    client = get_client()
    job_id = uuid.uuid4().hex
    try:
        row = (
            client.table("video_analysis_jobs")
            .insert(
                {
                    "video_id": video_id,
                    "user_id": user_id,
                    "status": "running",
                    "stage": "transcribing",
                    "job_id": job_id,
                }
            )
            .execute()
            .data
        )
    except Exception as exc:
        raise PipelineError(
            stage="storage", code="WRITE_FAILED", message=f"Could not create job row: {exc}"
        ) from exc
    return row[0]["id"] if row else job_id


def update_job(
    job_row_id: str | None,
    *,
    status: str | None = None,
    stage: str | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    if not job_row_id:
        return
    payload: dict = {"updated_at": "now()"}
    if status:
        payload["status"] = status
    if stage:
        payload["stage"] = stage
    if error_code:
        payload["error_code"] = error_code
    if error_message:
        payload["error_message"] = error_message
    try:
        client = get_client()
        client.table("video_analysis_jobs").update(payload).eq("id", job_row_id).execute()
    except Exception as exc:  # noqa: BLE001 - best-effort bookkeeping
        print(f"[warn] could not update job row: {exc}")


# ---------------------------------------------------------------------------
# Videos
# ---------------------------------------------------------------------------


def update_video(
    video_id: str,
    *,
    stage: str,
    transcript: str | None = None,
    transcript_segments: dict | None = None,
    duration_seconds: float | None = None,
) -> None:
    client = get_client()
    payload: dict = {"processing_stage": stage, "updated_at": "now()"}
    if transcript is not None:
        payload["transcript"] = transcript
    if transcript_segments is not None:
        payload["transcript_segments"] = transcript_segments
    if duration_seconds is not None:
        payload["duration_seconds"] = int(duration_seconds)
    try:
        client.table("videos").update(payload).eq("id", video_id).execute()
    except Exception as exc:
        raise PipelineError(
            stage="storage", code="WRITE_FAILED", message=f"Could not update video row: {exc}"
        ) from exc


def finalize_video(video_id: str, *, completed: bool, error_message: str | None = None) -> None:
    now = "now()"
    payload: dict = {"processing_ended_at": now, "updated_at": "now()"}
    if completed:
        payload["status"] = "completed"
        payload["processing_stage"] = "completed"
    else:
        payload["status"] = "failed"
        payload["processing_stage"] = "failed"
        payload["error_message"] = error_message or "Processing failed"
    try:
        client = get_client()
        client.table("videos").update(payload).eq("id", video_id).execute()
    except Exception as exc:  # noqa: BLE001 - best-effort bookkeeping
        print(f"[warn] could not finalize video row: {exc}")


# ---------------------------------------------------------------------------
# Clips
# ---------------------------------------------------------------------------


def insert_clip_candidates(video_id: str, user_id: str, clips: list[dict]) -> list[str]:
    if not clips:
        return []
    client = get_client()
    rows = [
        {
            "video_id": video_id,
            "user_id": user_id,
            "start_time": c["start"],
            "end_time": c["end"],
            "score": c["score"],
            "hook_score": c.get("hook_score", 0),
            "story_score": c.get("story_score", 0),
            "information_score": c.get("information_score", 0),
            "emotion_score": c.get("emotion_score", 0),
            "visual_score": c.get("visual_score", 0),
            "context_independence": c.get("context_independence", 0),
            "reason": c.get("reason", ""),
        }
        for c in clips
    ]
    try:
        data = (
            client.table("clip_candidates")
            .insert(rows)
            .select("id, start_time, end_time")
            .execute()
            .data
        )
    except Exception as exc:
        raise PipelineError(
            stage="storage", code="WRITE_FAILED", message=f"Could not insert clip candidates: {exc}"
        ) from exc
    return [r["id"] for r in data]


def insert_generated_clip(
    video_id: str,
    user_id: str,
    candidate_id: str | None,
    storage_path: str,
    duration: float,
    aspect_ratio: str,
    caption_style: str,
    thumb_path: str | None = None,
) -> dict:
    client = get_client()
    try:
        data = (
            client.table("generated_clips")
            .insert(
                {
                    "video_id": video_id,
                    "user_id": user_id,
                    "candidate_id": candidate_id,
                    "storage_path": storage_path,
                    "thumb_path": thumb_path,
                    "duration": duration,
                    "aspect_ratio": aspect_ratio,
                    "caption_style": caption_style,
                    "status": "ready",
                }
            )
            .select("*")
            .execute()
            .data
        )
    except Exception as exc:
        raise PipelineError(
            stage="storage", code="WRITE_FAILED", message=f"Could not insert generated clip: {exc}"
        ) from exc
    return data[0] if data else {}