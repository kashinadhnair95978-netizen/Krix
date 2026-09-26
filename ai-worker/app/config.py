"""
Krix AI worker — centralized configuration.

Everything model/pipeline related is driven from environment variables so you can
swap models or tune the pipeline without touching code. Defaults below are safe
for an NVIDIA RTX 4060 (8 GB VRAM): models are loaded ONE AT A TIME by
``models/managers.ModelManager``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Load ai-worker/.env regardless of the process working directory. Default
# override=False so pre-exported environment variables / pytest fixtures win.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # pragma: no cover - python-dotenv is a hard dependency
    pass

# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    return value.strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

SERVER_HOST = _env("AI_WORKER_HOST", "127.0.0.1")
SERVER_PORT = _env_int("AI_WORKER_PORT", 8741)

# Bearer token Next.js sends. Set AI_WORKER_AUTH=disabled only for local dev.
AI_WORKER_API_KEY = _env("AI_WORKER_API_KEY", "")
AI_WORKER_AUTH_ENABLED = _env_bool("AI_WORKER_AUTH", True)


# ---------------------------------------------------------------------------
# Supabase (worker runs server-side with the service role key)
# ---------------------------------------------------------------------------

SUPABASE_URL = _env("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")

VIDEOS_BUCKET = _env("SUPABASE_VIDEOS_BUCKET", "videos")
CLIPS_BUCKET = _env("SUPABASE_CLIPS_BUCKET", "generated_clips")

# Timeout for the internal Supabase HTTP client (seconds).
SUPABASE_TIMEOUT = _env_int("SUPABASE_TIMEOUT", 120)

# Local scratch dir where media is downloaded / rendered before upload.
WORK_DIR = Path(_env("AI_WORKER_WORK_DIR", "ai-worker/work")).resolve()

# Keep source video files after a job for debugging. Default off.
KEEP_ARTIFACTS = _env_bool("AI_WORKER_KEEP_ARTIFACTS", False)


# ---------------------------------------------------------------------------
# FFmpeg / FFprobe
# ---------------------------------------------------------------------------

FFMPEG_PATH = _env("FFMPEG_PATH", "ffmpeg")
FFPROBE_PATH = _env("FFPROBE_PATH", "ffprobe")

# Rendering defaults — 9:16 vertical shorts.
OUTPUT_WIDTH = _env_int("RENDER_WIDTH", 1080)
OUTPUT_HEIGHT = _env_int("RENDER_HEIGHT", 1920)
OUTPUT_FPS = _env_int("RENDER_FPS", 30)
H264_CRF = _env_int("RENDER_CRF", 23)
AUDIO_BITRATE = _env("RENDER_AUDIO_BITRATE", "128k")


# ---------------------------------------------------------------------------
# Models (centralized — change these to swap models)
# ---------------------------------------------------------------------------

ASR_MODEL = _env("ASR_MODEL", "Qwen/Qwen3-ASR-1.7B-hf")
ASR_ALIGNER_MODEL = _env("ASR_ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B-hf")
ASR_DEVICE = _env("ASR_DEVICE", "cuda")  # "cuda" | "cpu"
ASR_LANGUAGE = _env("ASR_LANGUAGE", "")  # empty = auto-detect
ASR_MAX_NEW_TOKENS = _env_int("ASR_MAX_NEW_TOKENS", 512)
# Set false to skip the forced aligner (timestamps) entirely — transcript only.
ASR_ENABLE_TIMESTAMPS = _env_bool("ASR_ENABLE_TIMESTAMPS", True)
# Max seconds per forced-alignment chunk (the aligner is designed for ~5 min).
ASR_ALIGN_CHUNK_SECONDS = _env_float("ASR_ALIGN_CHUNK_SECONDS", 240.0)

VISION_MODEL = _env("VISION_MODEL", "Qwen/Qwen3-VL-4B-Instruct")
VISION_DEVICE = _env("VISION_DEVICE", "cuda")
# "8bit" (bitsandbytes) | "fp16" (may not fit with large batches)
VISION_QUANTIZATION = _env("VISION_QUANTIZATION", "8bit")
VISION_MAX_NEW_TOKENS = _env_int("VISION_MAX_NEW_TOKENS", 256)
# Comma separated extra args you may want for the future VL class is handled by code.

MISTRAL_MODEL = _env("MISTRAL_MODEL", "mistralai/Mistral-7B-Instruct-v0.3")
MISTRAL_DEVICE = _env("MISTRAL_DEVICE", "cuda")
# "4bit" (NF4 BitsAndBytes, default) | "8bit" | "fp16"
MISTRAL_QUANTIZATION = _env("MISTRAL_QUANTIZATION", "4bit")
MISTRAL_MAX_NEW_TOKENS = _env_int("MISTRAL_MAX_NEW_TOKENS", 900)
MISTRAL_TEMPERATURE = _env_float("MISTRAL_TEMPERATURE", 0.1)
# Comma separated list of languages allowed by the aligner (English, Chinese, ...).
# If empty the aligner uses the ASR-detected language when supported.
ALIGNER_LANGUAGES = [
    "Chinese", "Cantonese", "English", "French", "German", "Italian",
    "Japanese", "Korean", "Portuguese", "Russian", "Spanish",
]

# Hugging Face local cache dir + optional token (only for gated models — not required).
HF_HOME = _env("HF_HOME", "")
HF_TOKEN = _env("HF_TOKEN", "")


# ---------------------------------------------------------------------------
# Pipeline tuning
# ---------------------------------------------------------------------------

MAX_CLIPS = _env_int("MAX_CLIPS", 3)
MIN_CLIP_DURATION = _env_float("MIN_CLIP_DURATION", 20.0)
MAX_CLIP_DURATION = _env_float("MAX_CLIP_DURATION", 90.0)
MIN_SCORE = _env_float("MIN_SCORE", 0.0)

# Frame sampling for visual analysis (seconds between candidate frames).
FRAME_SAMPLE_INTERVAL = _env_float("FRAME_SAMPLE_INTERVAL", 10.0)
# Maximum number of frames sent to the vision model in a single job.
MAX_VISION_FRAMES = _env_int("MAX_VISION_FRAMES", 12)
# Skip the first N seconds of frame extraction (intro/title cards).
VISION_START_OFFSET = _env_float("VISION_START_OFFSET", 0.0)

# Caption style (one excellent default; swap text + colors to make more).
CAPTION_FONT_SIZE = _env_int("CAPTION_FONT_SIZE", 72)
CAPTION_FONT_COLOR = _env("CAPTION_FONT_COLOR", "&HFFFFFF")
CAPTION_OUTLINE_COLOR = _env("CAPTION_OUTLINE_COLOR", "&H000000")
CAPTION_OUTLINE_WIDTH = _env_int("CAPTION_OUTLINE_WIDTH", 3)
CAPTION_MARGIN_BOTTOM = _env_int("CAPTION_MARGIN_BOTTOM", 120)
CAPTION_MAX_CHARS = _env_int("CAPTION_MAX_CHARS", 32)
CAPTION_STYLE_NAME = _env("CAPTION_STYLE_NAME", "Krix")


# ---------------------------------------------------------------------------
# Derived / shared
# ---------------------------------------------------------------------------

@dataclass
class Segment:
    start: float
    end: float
    text: str

    def as_dict(self) -> dict:
        return {"start": round(float(self.start), 3), "end": round(float(self.end), 3), "text": self.text}


@dataclass
class PipelineError(Exception):
    """Structured pipeline failure. Code map lives in schemas/pipeline.py."""
    stage: str
    code: str
    message: str
    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        base = {
            "status": "failed",
            "stage": self.stage,
            "error_code": self.code,
            "message": self.message,
        }
        base.update(self.extra)
        return base

    @staticmethod
    def from_payload(payload: dict) -> "PipelineError":
        return PipelineError(
            stage=payload.get("stage", "pipeline"),
            code=payload.get("error_code", "PIPELINE_INTERNAL"),
            message=payload.get("message", "Unknown pipeline failure"),
            extra={k: v for k, v in payload.items() if k not in {"status", "stage", "error_code", "message"}},
        )


def ensure_work_dir() -> Path:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    return WORK_DIR