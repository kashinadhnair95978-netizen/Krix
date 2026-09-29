"""
Clip detection — Mistral finds candidate short-form clips from transcript +
visual observations, then everything is validated server-side.

The validation is deliberately separated from the model call so it can be unit
tested and so we NEVER blindly trust LLM JSON.
"""

from __future__ import annotations

from app import config as cfg
from app.config import PipelineError
from app.models import mistral
from app.schemas.pipeline import ClipCandidate, error

SYSTEM_PROMPT = """You are Krix's clip-selection engine. You choose the BEST short-form vertical
clip candidates from a long video based on a transcript, timestamps and visual
observations.

Rule: return ONLY valid JSON, no markdown fences, no commentary. Use this exact shape:
{{"clips": [
  {{"start": 12.4, "end": 48.2, "score": 93,
   "hook_score": 96, "story_score": 91, "information_score": 95,
   "emotion_score": 87, "visual_score": 83, "context_independence": 95,
   "reason": "Strong opening hook followed by a complete story."}}
]}}

HARD CONSTRAINTS (violating these discards the clip entirely):
- The clip length (end - start) MUST be at least {min_dur:.0f} seconds and at most {effective_max_dur:.0f} seconds.
- The clip MUST lie entirely inside the video: 0 <= start, and end <= {duration:.1f}.
- Every field above is REQUIRED. Use only the keys shown.
- Return between 1 and {max_clips:.0f} clips. Never return an empty list.

Guidance:
- Prefer clips with a strong hook in the first 5 seconds, a self-contained
  story, high information/emotion density, and usable visuals.
- A clip must make sense to a viewer who never saw the full video
  (context independence).
- Expand the clip to fill at least {min_dur:.0f} seconds of real content rather than
  isolating one short sentence.
- "score" is called the Krix Clip Quality Score (0-100). It is an estimate of
  clip quality for short-form; it is NOT a prediction of guaranteed virality.
- Return the {max_clips:.0f} highest-scoring candidate clips, sorted by score
  (highest first).
"""

USER_PROMPT = """Video duration: {duration:.1f}s

TIMESTAMPED TRANSCRIPT (ASR):
{transcript}

VISUAL OBSERVATIONS (sampled frames):
{visual}

Return valid JSON only."""

RETRY_USER_SUFFIX = """

IMPORTANT — your previous answer was rejected. {problems}

Try again with DIFFERENT, longer time ranges that satisfy every constraint.
Return valid JSON only."""


def _effective_max_duration(duration: float, max_duration: float) -> float:
    """The longest clip this video can actually hold.

    Telling the model to keep clips under 90s on a 60s video invites it to
    propose ranges that run past the end of the media, which are then discarded.
    """
    return float(max(0.0, min(max_duration, duration)))


def build_prompt(segments: list[dict], visual: list[dict], duration: float) -> tuple[str, str]:
    """Build the (system, user) prompt pair.

    ``SYSTEM_PROMPT`` contains a literal JSON example, so every brace in it is
    doubled — ``str.format`` would otherwise raise KeyError on ``"clips"``.
    """
    ordered_segments = sorted(segments, key=lambda s: s.get("start", 0.0))
    transcript_parts = [
        f"[{seg.get('start', 0.0):.1f}s-{seg.get('end', 0.0):.1f}s] {seg.get('text', '')}"
        for seg in ordered_segments
    ]
    transcript_text = "\n".join(transcript_parts) or "(no transcript)"
    visual_text = json_lines(visual) or "(no visual observations)"

    try:
        system = SYSTEM_PROMPT.format(
            min_dur=cfg.MIN_CLIP_DURATION,
            max_dur=cfg.MAX_CLIP_DURATION,
            effective_max_dur=_effective_max_duration(duration, cfg.MAX_CLIP_DURATION),
            duration=duration,
            max_clips=cfg.MAX_CLIPS,
        )
    except (KeyError, IndexError, ValueError) as exc:
        raise PipelineError(
            stage="clips",
            code="CLIP_VALIDATION_FAILED",
            message=f"Clip prompt template is malformed: {exc}",
        ) from exc
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
    """Run Mistral, validate, dedupe, sort, and return clip candidate dicts.

    A 7B model will occasionally answer with ranges that violate the hard
    constraints (most often clips far shorter than the minimum). Rather than
    failing the whole video, we re-ask once with the specific violations spelled
    out. The retry is bounded to a single extra call and can only ever return
    model-proposed timestamps that pass the same validation — nothing is
    invented or widened server-side.
    """
    limits = {
        "duration": duration,
        "max_clips": max_clips if max_clips is not None else cfg.MAX_CLIPS,
        "min_duration": min_duration if min_duration is not None else cfg.MIN_CLIP_DURATION,
        "max_duration": max_duration if max_duration is not None else cfg.MAX_CLIP_DURATION,
        "min_score": min_score if min_score is not None else cfg.MIN_SCORE,
    }

    raw = _run_mistral(segments, visual, duration)
    selected = validate_and_rank(raw, **limits)
    if selected:
        return selected

    problems = _describe_violations(raw, **limits)
    if not problems:
        return []

    print(f"[warn] clip model returned no usable clips, retrying once: {problems}")
    retry_raw = _run_mistral(
        segments, visual, duration, extra_user_suffix=RETRY_USER_SUFFIX.format(problems=problems)
    )
    selected = validate_and_rank(retry_raw, **limits)
    if not selected and retry_raw:
        print(
            f"[warn] clip retry also produced no usable clips "
            f"({len(retry_raw)} candidate(s) rejected)"
        )
    return selected


def _describe_violations(clips: list[dict], **limits) -> str:
    """Explain, in model-readable terms, why each candidate was discarded."""
    duration = limits["duration"]
    effective_max = _effective_max_duration(duration, limits["max_duration"])
    reasons: list[str] = []
    for raw in clips or []:
        try:
            candidate = ClipCandidate(**raw)
        except Exception:
            reasons.append("one candidate was missing required fields or malformed")
            continue
        span = candidate.end - candidate.start
        if candidate.end > duration + 0.5:
            reasons.append(
                f"end {candidate.end:.1f} is past the {duration:.1f}s end of the video"
            )
        elif span < limits["min_duration"]:
            reasons.append(
                f"clip {candidate.start:.1f}-{candidate.end:.1f} was only {span:.1f}s, "
                f"under the {limits['min_duration']:.0f}s minimum"
            )
        elif span > limits["max_duration"]:
            reasons.append(
                f"clip {candidate.start:.1f}-{candidate.end:.1f} was {span:.1f}s, "
                f"over the {limits['max_duration']:.0f}s maximum"
            )
        elif candidate.score < limits["min_score"]:
            reasons.append(
                f"score {candidate.score:.0f} was under the minimum {limits['min_score']:.0f}"
            )
    if not clips:
        return "you returned an empty or unparseable list of clips"
    if not reasons:
        return "every candidate duplicated a time range you had already used"
    return (
        "; ".join(dict.fromkeys(reasons))
        + f". Each clip must be {limits['min_duration']:.0f}-{effective_max:.0f}s long "
        f"and end at or before {duration:.1f}s."
    )


def _run_mistral(
    segments: list[dict],
    visual: list[dict],
    duration: float,
    *,
    extra_user_suffix: str = "",
) -> list[dict]:
    system, user = build_prompt(segments, visual, duration)
    if extra_user_suffix:
        user = user + extra_user_suffix
    try:
        payload = mistral.generate_json(system, user)
    except PipelineError:
        raise
    except Exception as exc:
        # A malformed model response must not lose the whole video.
        raise PipelineError(
            stage="clips",
            code="LLM_INVALID_JSON",
            message=f"Clip model returned something unusable: {exc}",
        ) from exc
    if not isinstance(payload, dict):
        return []
    clips = payload.get("clips")
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