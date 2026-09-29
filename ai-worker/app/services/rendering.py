"""
Rendering — FFmpeg vertical (9:16) clip extraction with optional burned captions.

Design is modular: `build_render_command` is a pure function (unit-tested). The
fulter chain currently center-crops to 9:16; future phases add smart reframing,
B-roll and multiple caption templates without changing the rest of the pipeline.
"""

from __future__ import annotations

from pathlib import Path

from app import config as cfg
from app.config import PipelineError
from app.services.audio import ffmpeg_binary, run_command


def escape_filter_path(path: str) -> str:
    """Escape a file path for use inside an ffmpeg filter argument (Windows-safe)."""
    p = Path(path).as_posix()
    escaped = p.replace(":", "\\:").replace("'", "\\'")
    return f"'{escaped}'"


def build_render_command(
    video_path: str,
    output_path: str,
    start: float,
    end: float,
    *,
    width: int = 1080,
    height: int = 1920,
    fps: int = 30,
    crf: int = 23,
    audio_bitrate: str = "128k",
    captions_ass: str | None = None,
    fastseek: bool = True,
    ffmpeg: str | None = None,
) -> list[str]:
    """Pure command builder. Returns an ffmpeg argv list."""
    duration = end - start
    cmd = [
        ffmpeg or ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel", "error",
    ]
    if fastseek:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", video_path]
    cmd += ["-t", f"{duration:.3f}"]

    vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    if captions_ass:
        vf += f",subtitles={escape_filter_path(captions_ass)}"

    cmd += [
        "-vf", vf,
        "-r", str(fps),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", str(crf),
        "-c:a", "aac",
        "-b:a", audio_bitrate,
        "-shortest",
        "-movflags", "+faststart",
        output_path,
    ]
    return cmd


def render_clip(
    video_path: str,
    output_path: str,
    start: float,
    end: float,
    *,
    width: int | None = None,
    height: int | None = None,
    fps: int | None = None,
    crf: int | None = None,
    audio_bitrate: str | None = None,
    captions_ass: str | None = None,
) -> Path:
    """Render one vertical clip. Returns the output path."""
    cmd = build_render_command(
        video_path,
        output_path,
        start,
        end,
        width=width or cfg.OUTPUT_WIDTH,
        height=height or cfg.OUTPUT_HEIGHT,
        fps=fps or cfg.OUTPUT_FPS,
        crf=crf or cfg.H264_CRF,
        audio_bitrate=audio_bitrate or cfg.AUDIO_BITRATE,
        captions_ass=captions_ass,
    )
    run_command(cmd, stage="rendering")
    out = Path(output_path)
    if not out.exists():
        # Structured contract — a bare FileNotFoundError would escape as a raw
        # 500 with no error_code.
        raise PipelineError(
            stage="rendering",
            code="RENDER_FAILED",
            message=f"Render completed but produced no file at {output_path}",
        )
    if out.stat().st_size == 0:
        raise PipelineError(
            stage="rendering",
            code="RENDER_FAILED",
            message=f"Render produced an empty file at {output_path}",
        )
    return out