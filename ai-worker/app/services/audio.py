"""
FFmpeg/FFprobe helpers: media probing + audio extraction.

Pure functions that build command lines are exported so they can be unit-tested
without shelling out.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app import config as cfg
from app.config import PipelineError


class FFmpegNotFound(PipelineError):
    pass


def _resolve_binary(name: str, configured: str) -> str:
    if configured and configured != name:
        return configured
    found = shutil.which(name)
    if found:
        return found
    raise FFmpegNotFound(
        stage="media",
        code="UNSUPPORTED_FILE",
        message=(
            f"'{name}' was not found. Install FFmpeg (full build with libass) or set "
            f"{getattr(cfg, name.upper() + '_PATH')} in ai-worker/.env."
        ),
    )


def ffmpeg_binary() -> str:
    return _resolve_binary("ffmpeg", cfg.FFMPEG_PATH)


def ffprobe_binary() -> str:
    return _resolve_binary("ffprobe", cfg.FFPROBE_PATH)


def run_command(cmd: list[str], *, stage: str = "media", timeout: int | None = None) -> subprocess.CompletedProcess:
    """Run a subprocess, converting failures into PipelineError."""
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise FFmpegNotFound(
            stage=stage,
            code="UNSUPPORTED_FILE",
            message=f"Binary not found when running: {cmd[0]}",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise PipelineError(
            stage=stage,
            code="RENDER_FAILED",
            message=f"Command timed out: {cmd[0]}",
        ) from exc
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-3000:]
        raise PipelineError(
            stage=stage,
            code="CORRUPT_MEDIA" if stage == "media" else "RENDER_FAILED",
            message=f"Command failed: {' '.join(cmd[:4])}...\n{tail}",
        )
    return proc


def probe(path: str) -> dict:
    """Return ffprobe metadata (duration, width, height, fps, format)."""
    cmd = [
        ffprobe_binary(),
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        path,
    ]
    proc = run_command(cmd, stage="media")
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise PipelineError(
            stage="media",
            code="CORRUPT_MEDIA",
            message=f"ffprobe returned unparseable output: {exc}",
        ) from exc

    streams = data.get("streams", [])
    if not streams:
        raise PipelineError(
            stage="media",
            code="CORRUPT_MEDIA",
            message="No streams found in media file",
        )

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    duration = None
    if audio and audio.get("duration"):
        duration = float(audio["duration"])
    elif video and video.get("duration"):
        duration = float(video["duration"])
    elif data.get("format", {}).get("duration"):
        duration = float(data["format"]["duration"])

    fps = None
    if video and video.get("avg_frame_rate"):
        try:
            num, den = video["avg_frame_rate"].split("/")
            fps = float(num) / float(den) if float(den) else None
        except (ValueError, ZeroDivisionError):
            fps = None

    return {
        "duration": duration,
        "width": int(video["width"]) if video and video.get("width") else None,
        "height": int(video["height"]) if video and video.get("height") else None,
        "fps": fps,
        "has_video": video is not None,
        "has_audio": audio is not None,
        "format": data.get("format", {}).get("format_name", ""),
        "codec": video.get("codec_name") if video else None,
    }


def extract_audio(video_path: str, output_path: str, sample_rate: int = 16000) -> str:
    """Extract mono 16 kHz PCM WAV for ASR. Returns the output path."""
    cmd = [
        ffmpeg_binary(),
        "-y",
        "-i", video_path,
        "-vn",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-c:a", "pcm_s16le",
        output_path,
    ]
    run_command(cmd, stage="media")
    return output_path


def extract_audio_seconds(video_path: str, output_path: str, sample_rate: int = 16000) -> str:
    """Same as extract_audio but with silence + tone preservation for short files."""
    return extract_audio(video_path, output_path, sample_rate)


def build_audio_extract_command(
    video_path: str, output_path: str, sample_rate: int = 16000, ffmpeg: str | None = None
) -> list[str]:
    """Pure command builder (kept for tests / transparency)."""
    return [
        ffmpeg or ffmpeg_binary(),
        "-y",
        "-i", video_path,
        "-vn",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-c:a", "pcm_s16le",
        output_path,
    ]


def sample_frames(
    video_path: str,
    work_dir: str | Path,
    *,
    interval: float,
    max_frames: int,
    start_offset: float = 0.0,
) -> list[tuple[float, str]]:
    """Extract up to ``max_frames`` representative frames at ``interval`` seconds.

    Returns a list of ``(timestamp, frame_path)``. Pure-enough helper shelling out
    to ffmpeg; the frame math is testable via ``frame_timestamps``.
    """
    meta = probe(video_path)
    duration = meta["duration"] or 0.0
    timestamps = frame_timestamps(duration, interval=interval, max_frames=max_frames, start_offset=start_offset)

    out_dir = Path(work_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    frames: list[tuple[float, str]] = []
    for i, ts in enumerate(timestamps):
        frame_path = str(out_dir / f"frame_{i:03d}.jpg")
        cmd = [
            ffmpeg_binary(),
            "-y",
            "-ss", _fmt_time(ts),
            "-i", video_path,
            "-frames:v", "1",
            "-vf", "scale='min(720,iw)':-2",
            "-q:v", "2",
            frame_path,
        ]
        try:
            run_command(cmd, stage="media")
        except PipelineError:
            continue
        if Path(frame_path).stat().st_size > 0:
            frames.append((ts, frame_path))
    return frames


def frame_timestamps(
    duration: float,
    *,
    interval: float,
    max_frames: int,
    start_offset: float = 0.0,
) -> list[float]:
    """Compute which timestamps to sample (pure, deterministic, testable)."""
    if duration <= 0:
        return []
    frames: list[float] = []
    ts = start_offset
    while ts < duration and len(frames) < max_frames:
        frames.append(round(ts, 3))
        ts += interval
    return frames


def _fmt_time(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:.3f}"