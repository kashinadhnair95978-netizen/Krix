"""
Video analysis — sample representative frames with ffmpeg and describe them with
Qwen3-VL. Never processes every frame of a long video; sampling is configurable.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from app import config as cfg
from app.config import PipelineError
from app.models import vision
from app.services.audio import sample_frames


def run_video_analysis(
    video_path: str,
    work_dir: str,
    *,
    interval: float | None = None,
    max_frames: int | None = None,
    start_offset: float | None = None,
) -> list[dict]:
    """Sample frames and return timed visual observations for each one."""
    frames = sample_frames(
        video_path,
        work_dir,
        interval=interval if interval is not None else cfg.FRAME_SAMPLE_INTERVAL,
        max_frames=max_frames if max_frames is not None else cfg.MAX_VISION_FRAMES,
        start_offset=start_offset if start_offset is not None else cfg.VISION_START_OFFSET,
    )

    if not frames:
        raise PipelineError(
            stage="analyzing",
            code="CORRUPT_MEDIA",
            message="No frames could be extracted from the video for visual analysis",
        )

    observations: list[dict] = []
    try:
        for timestamp, frame_path in frames:
            try:
                image = Image.open(frame_path).convert("RGB")
                event = vision.describe_frame(timestamp, image)
            except PipelineError as exc:
                # One bad frame (e.g. model hiccup) shouldn't kill the job; skip it.
                print(f"[warn] frame at {timestamp}s skipped: {exc.message}")
                continue
            observations.append(event)
            # Free the cache occasionally to keep peak VRAM low.
            if len(frames) >= 4 and cfg.VISION_QUANTIZATION == "8bit":
                from app.models.manager import free_gpu_cache

                free_gpu_cache()
    finally:
        for _ts, frame_path in frames:
            if not cfg.KEEP_ARTIFACTS:
                Path(frame_path).unlink(missing_ok=True)

    if not observations:
        raise PipelineError(
            stage="analyzing",
            code="VISION_FAILED",
            message="Visual analysis produced no observations",
        )
    return observations