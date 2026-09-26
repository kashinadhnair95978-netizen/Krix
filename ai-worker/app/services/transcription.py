"""
Transcription service — turns ASR output into validated transcript structures.
"""

from __future__ import annotations

from app.config import Segment
from app.models.asr import AsrResult, transcribe
from app.schemas.pipeline import SegmentOut, TranscriptOut


def transcribe_audio(audio_path: str) -> AsrResult:
    return transcribe(audio_path)


def to_transcript_out(result: AsrResult) -> TranscriptOut:
    return TranscriptOut(
        segments=[_to_segment_out(s) for s in result.segments],
        text=result.text,
        language=result.language,
    )


def to_transcript_out_dict(result: AsrResult) -> dict:
    out = to_transcript_out(result)
    return out.model_dump()


def _to_segment_out(segment: Segment) -> SegmentOut:
    return SegmentOut(start=segment.start, end=segment.end, text=segment.text)


def transcript_segments_json(result: AsrResult) -> dict:
    """Structure persisted to ``videos.transcript_segments`` (jsonb)."""
    return {
        "language": result.language,
        "segments": [s.as_dict() for s in result.segments],
        "words": result.words,
    }