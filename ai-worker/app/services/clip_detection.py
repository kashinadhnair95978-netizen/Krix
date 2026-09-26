"""
Clip detection — Mistral finds candidate short-form clips from transcript +
visual observations, then everything is validated server-side.

The validation is deliberately separated from the model call so it can be unit
tested and so we NEVER blindly trust LLM JSON.
"""

from __future__ import annotations

from app import config as cfg
from app.models import mistral
from app.schemas.pipeline import ClipCandidate, error

SYSTEM_PROMPT = """You are Krix's clip-selection engine. You choose the BEST short-form vertical
clip candidates from a long video based on a transcript, timestamps and visual
observations.

Rule: return ONLY valid JSON, no markdown fences, no commentary. Use this exact shape:
{"clips": [
  {"start": 12.4, "end": 48.2, "score": 93,
   "hook_score": 96, "story_score": 91, "information_score": 95,
   "emotion_score": 87, "visual_score": 83, "context_independence": 95,
   "reason": "Strong opening hook followed by a complete story."}
]}

Guidance:
- Prefer clips with a strong hook in the first 5 seconds, a self-contained
  story, high information/emotion density, and usable visuals.
- A clip must make sense to a viewer who never saw the full video
  (context independence).
- Keep every clip between {min_dur}s and {max_dur}s.
- "score" is called the Krix Clip Quality Score (0-100). It is an estimate of
  clip quality for short-form; it is NOT a prediction of guaranteed virality.
- Return up to {max_clips} candidate clips, sorted by score (highest first).
"""

USER_PROMPT = """Video duration: {duration:.1f}s

TIMESTAMPED TRANSCRIPT (ASR):
{transcript}

VISUAL OBSERVATIONS (sampled frames):
{visual}

Return valid JSON only."""


def build_prompt(segments: list[dict], visual: list[dict], duration: float) -> tuple[str, str]:
    ordered_segments = sorted(segments, key=lambda s: s.get("start", 0.0))
    transcript_parts = [
        f"[{seg.get('start', 0.0):.1f}s-{seg.get('end', 0.0):.1f}s] {seg.get('text', '')}"
        for seg in ordered_segments
    ]
    transcript_text = "\n".join(transcript_parts) or "(no transcript)"
    visual_text = json_lines(visual) or "(no visual observations)"

    system = SYSTEM_PROMPT.format(
        min_dur=int(cfg.MIN_CLIP_DURATION),
        max_dur=int(cfg.MAX_CLIP_DURATION),
        max_clips=int(cfg.MAX_CLIPS * 2),
    )
    user = USER_PROMPT.format(duration=duration, transcript=transcript_text, visual=visual_text)
    return system, user


def json_lines(items: list[dict]) -> str:
    lines = []
    for item in items:
        ts = item.get("timestamp")
        if ts is None:
            ts = item.get("start")
        prefix = f"[{ts:.1f}s]" if ts is not None else ""
        desc = item.get("description", item.get("text", ""))
        lines.append(f"{prefix} {desc}".strip())
    return "\n".join(lines)


def find_clip_candidates(
    segments: list[dict],
    visual: list[dict],
    duration: float,
    *,
    max_clips: int | None = None,
    min_duration: float | None = None,
    max_duration: float | None = None,
    min_score: float | None = None,
) -> list[dict]:
    """Run Mistral, validate, dedupe, sort, and return clip candidate dicts."""
    clips = _run_mistral(segments, visual, duration)
    return validate_and_rank(
        clips,
        duration=duration,
        max_clips=max_clips or cfg.MAX_CLIPS,
        min_duration=min_duration if min_duration is not None else cfg.MIN_CLIP_DURATION,
        max_duration=max_duration if max_duration is not None else cfg.MAX_CLIP_DURATION,
        min_score=min_score if min_score is not None else cfg.MIN_SCORE,
    )


def _run_mistral(segments: list[dict], visual: list[dict], duration: float) -> list[dict]:
    system, user = build_prompt(segments, visual, duration)
    payload = mistral.generate_json(system, user)
    clips = payload.get("clips", [])
    if not isinstance(clips, list):
        return []
    return [c for c in clips if isinstance(c, dict)]


def validate_and_rank(
    clips: list[dict],
    *,
    duration: float,
    max_clips: int,
    min_duration: float,
    max_duration: float,
    min_score: float,
    overlap_tolerance: float = 1.0,
) -> list[dict]:
    """Validate raw candidate dicts, drop overlaps, sort by score, clamp to max_clips.

    Pure function (unit tested).
    """
    if duration <= 0:
        return []

    valid: list[ClipCandidate] = []
    for raw in clips:
        try:
            candidate = ClipCandidate(**raw)
        except Exception:
            continue
        if candidate.start < 0 or candidate.end <= candidate.start:
            continue
        if candidate.end > duration + 0.5:
            continue
        if max_duration > 0 and (candidate.end - candidate.start) > max_duration:
            continue
        if (candidate.end - candidate.start) < min_duration:
            continue
        if candidate.score < min_score:
            continue
        valid.append(candidate)

    valid.sort(key=lambda c: c.score, reverse=True)

    selected: list[ClipCandidate] = []
    for candidate in valid:
        if len(selected) >= max_clips:
            break
        if _overlaps_any(candidate, selected, tolerance=overlap_tolerance):
            continue
        selected.append(candidate)

    selected.sort(key=lambda c: c.start)
    return [c.as_dict() for c in selected]


def _overlaps_any(candidate: ClipCandidate, selected: list[ClipCandidate], tolerance: float) -> bool:
    for other in selected:
        # Overlap if ranges intersect by more than `tolerance` seconds.
        intersection = min(candidate.end, other.end) - max(candidate.start, other.start)
        if intersection > tolerance:
            return True
    return False