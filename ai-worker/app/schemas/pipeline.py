"""
Pydantic schemas shared by the FastAPI app and pipeline.

These also act as the server-side validation layer for anything the LLM produces
(clip candidates) — never trust raw LLM JSON.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class PipelineRequest(BaseModel):
    video_id: str
    user_id: str
    storage_path: str
    title: Optional[str] = None
    language: Optional[str] = None


class TranscribeRequest(BaseModel):
    audio_path: str


class AnalyzeVideoRequest(BaseModel):
    video_path: str
    frames: Optional[list[float]] = None


class FindClipsRequest(BaseModel):
    transcript: list[dict]
    visual: list[dict] = Field(default_factory=list)
    duration: float
    max_clips: int = 3
    min_duration: float = 20.0
    max_duration: float = 90.0


class RenderClipRequest(BaseModel):
    video_path: str
    start: float
    end: float
    output_path: str
    captions_ass: Optional[str] = None
    width: int = 1080
    height: int = 1920


# ---------------------------------------------------------------------------
# Pipeline data structures
# ---------------------------------------------------------------------------


class SegmentOut(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str = ""

    @model_validator(mode="after")
    def check_order(self) -> "SegmentOut":
        if self.end <= self.start:
            raise ValueError("segment end must be greater than start")
        return self


class TranscriptOut(BaseModel):
    segments: list[SegmentOut] = Field(default_factory=list)
    text: str = ""
    language: Optional[str] = None


class VisualEvent(BaseModel):
    timestamp: float = Field(ge=0)
    description: str = ""
    speaker_count: int = Field(default=0, ge=0, le=50)
    speaker_position: Optional[str] = None
    scene_type: Optional[str] = None
    visual_interest: float = Field(default=0.0, ge=0.0, le=1.0)


class ClipCandidate(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    score: float = Field(ge=0, le=100)
    hook_score: float = Field(default=0, ge=0, le=100)
    story_score: float = Field(default=0, ge=0, le=100)
    information_score: float = Field(default=0, ge=0, le=100)
    emotion_score: float = Field(default=0, ge=0, le=100)
    visual_score: float = Field(default=0, ge=0, le=100)
    context_independence: float = Field(default=0, ge=0, le=100)
    reason: str = ""

    @model_validator(mode="after")
    def check_order(self) -> "ClipCandidate":
        if self.end <= self.start:
            raise ValueError("clip end must be greater than start")
        return self

    def as_dict(self) -> dict:
        return {
            "start": round(float(self.start), 3),
            "end": round(float(self.end), 3),
            "score": round(float(self.score), 1),
            "hook_score": round(float(self.hook_score), 1),
            "story_score": round(float(self.story_score), 1),
            "information_score": round(float(self.information_score), 1),
            "emotion_score": round(float(self.emotion_score), 1),
            "visual_score": round(float(self.visual_score), 1),
            "context_independence": round(float(self.context_independence), 1),
            "reason": self.reason,
        }


class ClipsOut(BaseModel):
    clips: list[ClipCandidate] = Field(default_factory=list)


class RenderResult(BaseModel):
    output_path: str
    duration: float
    width: int
    height: int


# ---------------------------------------------------------------------------
# Error contract
# ---------------------------------------------------------------------------

class StructuredError(BaseModel):
    status: Literal["failed"] = "failed"
    stage: str
    error_code: str
    message: str

    def as_dict(self) -> dict:
        return self.model_dump()


ERROR_CODES = {
    "UNSUPPORTED_FILE": "File type not supported",
    "MODEL_MISSING": "A required model could not be loaded",
    "CUDA_UNAVAILABLE": "CUDA was requested but is not available on this machine",
    "MODEL_OUT_OF_MEMORY": "Out of memory while running a model",
    "CORRUPT_MEDIA": "The media file could not be read",
    "TRANSCRIPTION_FAILED": "Speech recognition failed",
    "VISION_FAILED": "Visual analysis failed",
    "LLM_INVALID_JSON": "The reasoning model returned invalid JSON",
    "CLIP_VALIDATION_FAILED": "No valid clip candidates after validation",
    "RENDER_FAILED": "FFmpeg could not render the clip",
    "STORAGE_UPLOAD_FAILED": "Uploading the result to storage failed",
    "WRITE_FAILED": "Writing results to the database failed",
    "NOT_FOUND": "Resource not found",
    "FORBIDDEN": "Access denied",
    "BAD_REQUEST": "The request was invalid",
    "PIPELINE_INTERNAL": "Unexpected internal pipeline error",
}


def error(code: str, stage: str, message: str) -> dict:
    return {
        "status": "failed",
        "stage": stage,
        "error_code": code,
        "message": message or ERROR_CODES.get(code, code),
    }