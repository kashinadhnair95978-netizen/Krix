"""
Pipeline orchestrator — the end-to-end job:

    download video → probe → ASR transcribe (+align) → visual analysis →
    Mistral clip selection → validate → render 9:16 clips with captions →
    upload clips+thumbs → write results to Supabase.

Each stage updates the provider state (videos.processing_stage + job row) so the
dashboard's existing polling reflects live progress. A single failure returns a
structured PipelineError without crashing the worker.
"""

from __future__ import annotations

import shutil
import traceback
import uuid
from pathlib import Path

from app import config as cfg
from app.config import PipelineError
from app.models.manager import manager
from app.services import audio, captions, clip_detection, rendering, storage, transcription, video_analysis
from app.schemas.pipeline import PipelineRequest


def run_pipeline(request: PipelineRequest) -> dict:
    """Run the full pipeline for one video. Must raise PipelineError on failure."""
    job_dir = cfg.ensure_work_dir() / f"job-{uuid.uuid4().hex[:8]}"
    job_dir.mkdir(parents=True, exist_ok=True)

    job: dict = {}
    try:
        video = storage.fetch_video(request.video_id, request.user_id)
        if not video.get("storage_path"):
            raise PipelineError(
                stage="storage", code="NOT_FOUND", message="Video has no storage path"
            )

        job["row_id"] = storage.create_job(request.video_id, request.user_id)

        # ---- 1. Download + probe -------------------------------------------------
        source = job_dir / "source_video"
        storage.download_video(video["storage_path"], source)
        meta = audio.probe(str(source))
        if not meta.get("has_video"):
            raise PipelineError(
                stage="media",
                code="UNSUPPORTED_FILE",
                message="Uploaded file has no video stream",
            )
        duration = float(meta.get("duration") or 0.0)
        if duration <= 0:
            raise PipelineError(
                stage="media", code="CORRUPT_MEDIA", message="Could not read video duration"
            )
        storage.update_job(job["row_id"], stage="transcribing")
        storage.update_video(request.video_id, stage="transcribing", duration_seconds=duration)

        # ---- 2. Transcribe (ASR + forced alignment) -----------------------------
        transcript_payload = _transcribe(request, job, source, job_dir)
        storage.update_job(job["row_id"], stage="analyzing")
        storage.update_video(request.video_id, stage="analyzing")

        # ---- 3. Visual analysis -------------------------------------------------
        frames_dir = job_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        observations = video_analysis.run_video_analysis(str(source), str(frames_dir))
        storage.update_job(job["row_id"], stage="finding_clips")
        storage.update_video(request.video_id, stage="finding_clips")

        # ---- 4. Clip selection (Mistral) ----------------------------------------
        clips = clip_detection.find_clip_candidates(
            transcript_payload["segments"], observations, duration
        )
        if not clips:
            raise PipelineError(
                stage="finding_clips",
                code="CLIP_VALIDATION_FAILED",
                message="No valid clip candidates after validation",
            )
        candidate_ids = storage.insert_clip_candidates(
            request.video_id, request.user_id, clips
        )
        storage.update_job(job["row_id"], stage="rendering")
        storage.update_video(request.video_id, stage="rendering")

        # ---- 5. Render + store clips --------------------------------------------
        rendered = _render_and_store(
            request, source, transcripts=transcript_payload, clips=clips,
            candidate_ids=candidate_ids, job_dir=job_dir,
        )
        storage.update_job(job["row_id"], status="completed", stage="completed")
        storage.finalize_video(request.video_id, completed=True)

        return {
            "status": "completed",
            "video_id": request.video_id,
            "duration": duration,
            "transcript": transcript_payload["text"],
            "segments": transcript_payload["segments"],
            "visual_observations": observations,
            "clips": clips,
            "generated_clips": rendered,
        }
    except PipelineError as exc:
        storage.update_job(
            job.get("row_id"),
            status="failed",
            stage=exc.stage,
            error_code=exc.code,
            error_message=exc.message,
        )
        storage.finalize_video(request.video_id, completed=False, error_message=exc.message)
        raise
    except Exception as exc:  # noqa: BLE001 - never let an unknown exception escape raw
        traceback.print_exc()
        message = f"Unexpected pipeline failure: {exc}"
        storage.update_job(
            job.get("row_id"), status="failed", stage="pipeline",
            error_code="PIPELINE_INTERNAL", error_message=message,
        )
        storage.finalize_video(request.video_id, completed=False, error_message=message)
        raise PipelineError(stage="pipeline", code="PIPELINE_INTERNAL", message=message) from exc
    finally:
        manager.unload()
        if not cfg.KEEP_ARTIFACTS:
            shutil.rmtree(job_dir, ignore_errors=True)


def _transcribe(request: PipelineRequest, job: dict, source: Path, job_dir: Path) -> dict:
    audio_path = job_dir / "audio.wav"
    audio.extract_audio(str(source), str(audio_path))
    result = transcription.transcribe_audio(str(audio_path))
    payload = transcription.transcript_segments_json(result)

    storage.update_video(
        request.video_id,
        stage="transcribing",
        transcript=result.text,
        transcript_segments=payload,
        duration_seconds=None,
    )
    return {
        "text": result.text,
        "segments": payload["segments"],
        "words": payload.get("words", []),
    }


def _render_and_store(
    request: PipelineRequest,
    source: Path,
    *,
    transcripts: dict,
    clips: list[dict],
    candidate_ids: list[str],
    job_dir: Path,
) -> list[dict]:
    out: list[dict] = []
    for index, (clip, candidate_id) in enumerate(
        zip(clips, candidate_ids + [None] * (len(clips) - len(candidate_ids)))
    ):
        start, end = clip["start"], clip["end"]

        ass_path = _write_captions(
            transcripts.get("words", []),
            transcripts.get("segments", []),
            start,
            end,
            job_dir / f"captions_{index}.ass",
        )

        render_path = job_dir / f"clip_{index}.mp4"
        rendering.render_clip(
            str(source),
            str(render_path),
            start,
            end,
            captions_ass=str(ass_path) if ass_path else None,
        )

        meta = audio.probe(str(render_path))
        duration = float(meta.get("duration") or (end - start))
        aspect = f"{cfg.OUTPUT_WIDTH}:{cfg.OUTPUT_HEIGHT}"

        thumb_path = _write_thumbnail(str(source), start, job_dir / f"thumb_{index}.jpg")

        remote = storage.upload_clip(
            request.user_id,
            render_path,
            filename=f"{request.video_id}-clip-{index + 1}.mp4",
        )
        thumb_remote = None
        if thumb_path:
            thumb_remote = storage.upload_clip(
                request.user_id,
                thumb_path,
                filename=f"{request.video_id}-clip-{index + 1}-thumb.jpg",
            )

        row = storage.insert_generated_clip(
            request.video_id,
            request.user_id,
            candidate_id=candidate_id,
            storage_path=remote["path"],
            duration=duration,
            aspect_ratio=aspect,
            caption_style=cfg.CAPTION_STYLE_NAME,
            thumb_path=thumb_remote["path"] if thumb_remote else None,
        )
        out.append(
            {
                "id": row.get("id"),
                "clip_index": index + 1,
                "start": start,
                "end": end,
                "score": clip.get("score"),
                "storage_path": remote["path"],
                "thumb_path": thumb_remote["path"] if thumb_remote else None,
                "duration": duration,
            }
        )
    return out


def _segments_inside(segments: list[dict], start: float, end: float) -> list[dict]:
    selected: list[dict] = []
    for seg in segments:
        s = float(seg.get("start", 0.0))
        e = float(seg.get("end", s + 1.0))
        if e <= start or s >= end:
            continue
        clip_start = max(s, start) - start
        clip_end = min(e, end) - start
        selected.append(
            {"start": max(0.0, clip_start), "end": max(clip_start + 0.3, clip_end), "text": seg.get("text", "")}
        )
    return selected


def _write_captions(words: list[dict], segments: list[dict], start: float, end: float, dest: Path) -> Path | None:
    """Build the ASS burn-in file for a clip, timed relative to the clip start."""
    cues = captions.segments_to_cues(_segments_inside(segments, start, end))
    if not cues and words:
        # Fall back to word-level cues when no ASR segments overlap the window.
        word_cues = []
        for w in words:
            ws = float(w["start"]); we = float(w["end"])
            if we <= start or ws >= end:
                continue
            word_cues.append(
                {"start": max(0.0, ws - start), "end": max(0.2, we - start), "text": w.get("text", "")}
            )
        cues = captions.segments_to_cues(word_cues)
    if not cues:
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(captions.build_ass(cues), encoding="utf-8")
    return dest


def _write_thumbnail(source: str, at_seconds: float, dest: Path) -> Path:
    cmd = [
        audio.ffmpeg_binary(),
        "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{at_seconds:.3f}",
        "-i", source,
        "-frames:v", "1",
        "-vf", "scale=480:-2",
        "-q:v", "3",
        str(dest),
    ]
    try:
        audio.run_command(cmd, stage="rendering")
    except PipelineError:
        return dest
    if not dest.exists():
        return dest
    return dest