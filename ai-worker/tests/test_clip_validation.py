"""Clip candidate validation: bounds, duration, scoring, overlap dedupe, ordering."""

import pytest

from app.services import clip_detection
from app.services.clip_detection import (
    _overlaps_any,
    build_prompt,
    json_lines,
    validate_and_rank,
)
from app.schemas.pipeline import ClipCandidate


def _raw(start, end, score=90, **over):
    return {"start": start, "end": end, "score": score, **over}


def test_rejects_out_of_bounds():
    result = validate_and_rank(
        [_raw(-5, 10), _raw(10, 10), _raw(0, 1000), _raw(95, 200, score=99)],
        duration=100,
        max_clips=5,
        min_duration=0,
        max_duration=0,
        min_score=0,
    )
    assert result == []


def test_rejects_outside_duration_window():
    result = validate_and_rank(
        [_raw(0, 50), _raw(90, 120)],
        duration=110,
        max_clips=5,
        min_duration=0,
        max_duration=0,
        min_score=0,
    )
    assert len(result) == 1
    assert result[0]["end"] <= 110


def test_max_duration_cap():
    result = validate_and_rank(
        [_raw(0, 100, score=99)],
        duration=200,
        max_clips=5,
        min_duration=0,
        max_duration=60,
        min_score=0,
    )
    assert result == []


def test_min_duration_floor():
    result = validate_and_rank(
        [_raw(0, 10, score=99)],
        duration=200,
        max_clips=5,
        min_duration=30,
        max_duration=0,
        min_score=0,
    )
    assert result == []


def test_min_score_filter():
    result = validate_and_rank(
        [_raw(0, 40, score=50)], duration=200, max_clips=5, min_duration=0, max_duration=0, min_score=80
    )
    assert result == []


def test_non_numeric_garbage_is_ignored():
    result = validate_and_rank(
        [{"start": "x", "end": "y", "score": "high"}],
        duration=200,
        max_clips=5,
        min_duration=0,
        max_duration=0,
        min_score=0,
    )
    assert result == []


def test_sorts_by_score_then_dedupes_by_overlap():
    result = validate_and_rank(
        [
            _raw(0, 60, score=50),
            _raw(55, 90, score=99),
            _raw(5, 40, score=98),
            _raw(70, 100, score=80),
        ],
        duration=200,
        max_clips=3,
        min_duration=0,
        max_duration=0,
        min_score=0,
        overlap_tolerance=0,
    )
    # Highest non-overlapping: [55-90], then [5-40] (overlaps 55-90? no, gap), 70-100 overlaps 55-90 -> skipped; 0-60 overlaps both.
    assert [c["start"] for c in result] == [5.0, 55.0]


def test_max_clips_is_respected_in_dedupe_order():
    result = validate_and_rank(
        [_raw(0, 10, score=30), _raw(100, 110, score=99), _raw(50, 60, score=70), _raw(90, 95, score=98)],
        duration=200,
        max_clips=2,
        min_duration=0,
        max_duration=0,
        min_score=0,
        overlap_tolerance=1,
    )
    assert len(result) == 2
    assert result[0]["score"] == 98  # 90-95 is best, picked first despite later start
    assert result[1]["score"] == 99


def test_overlap_tolerance_cuids_near_misses():
    result = validate_and_rank(
        [_raw(10, 50, score=70), _raw(48, 90, score=60)],
        duration=200,
        max_clips=3,
        min_duration=0,
        max_duration=0,
        min_score=0,
        overlap_tolerance=3,
    )
    # 48-50 = 2s gap is allowed within tolerance -> both kept.
    assert len(result) == 2


def test_validate_returns_empty_for_empty_duration():
    assert validate_and_rank([_raw(0, 10)], duration=0, max_clips=3, min_duration=0, max_duration=0, min_score=0) == []


def test_overlaps_any_positive():
    a = ClipCandidate(start=10, end=50, score=1)
    b = ClipCandidate(start=40, end=70, score=1)
    assert _overlaps_any(a, [b], tolerance=5) is True
    assert _overlaps_any(a, [b], tolerance=100) is False


def test_empty_for_invalid_duration():
    assert validate_and_rank([_raw(0, 10)], duration=-1, max_clips=3, min_duration=0, max_duration=0, min_score=0) == []


def test_json_lines_formats_events():
    text = json_lines([{"timestamp": 12.3, "description": "On camera"}, {"text": "no ts"}])
    assert "[12.3s] On camera" in text
    assert "no ts" in text


def test_json_lines_empty():
    assert json_lines([]) == ""


def test_garbage_clip_dicts_are_dropped_not_crash():
    result = validate_and_rank(
        [None, "string", {}, _raw(0, 30, score=10)],
        duration=200,
        max_clips=3,
        min_duration=0,
        max_duration=0,
        min_score=0,
    )
    assert len(result) == 1
# ---------------------------------------------------------------------------
# Prompt bounds: a 60s video must never be told "clips up to 90s"
# ---------------------------------------------------------------------------


def test_prompt_clamps_max_clip_length_to_the_video_duration():
    system, _ = build_prompt([], [], 60.0)
    assert "at most 60 seconds" in system
    assert "at most 90 seconds" not in system
    assert "end <= 60.0" in system
    assert "at least 20 seconds" in system


def test_prompt_keeps_configured_maximum_for_long_videos():
    system, _ = build_prompt([], [], 3600.0)
    assert "at most 90 seconds" in system
    assert "end <= 3600.0" in system


def test_prompt_contains_no_unrendered_placeholder():
    system, user = build_prompt(
        [{"start": 0.0, "end": 5.0, "text": "hello"}],
        [{"timestamp": 1.0, "description": "a face"}],
        300.0,
    )
    for text in (system, user):
        assert "{" not in text.split("Rule:")[-1] or "{{" not in text
        assert "{min_dur}" not in text
        assert "{max_clips}" not in text
        assert "{duration" not in text
    assert "hello" in user and "a face" in user


# ---------------------------------------------------------------------------
# One bounded corrective retry
# ---------------------------------------------------------------------------


class _FakeMistral:
    """Stands in for the model; records every prompt it was given."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def generate_json(self, system, user):
        self.calls.append((system, user))
        return self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]


def test_valid_first_answer_is_not_retried(monkeypatch):
    fake = _FakeMistral([{"clips": [_raw(0, 40, score=95)]}])
    monkeypatch.setattr(clip_detection.mistral, "generate_json", fake.generate_json)
    result = clip_detection.find_clip_candidates([], [], 300.0)
    assert len(result) == 1
    assert len(fake.calls) == 1, "a good answer must cost exactly one model call"


def test_short_clips_trigger_exactly_one_retry(monkeypatch):
    # First answer is the real failure seen on a 60s video: a 4.7s clip.
    fake = _FakeMistral(
        [
            {"clips": [_raw(0.0, 4.7, score=90)]},
            {"clips": [_raw(0.0, 55.0, score=88)]},
        ]
    )
    monkeypatch.setattr(clip_detection.mistral, "generate_json", fake.generate_json)
    result = clip_detection.find_clip_candidates([], [], 60.0)
    assert len(result) == 1
    assert result[0]["end"] - result[0]["start"] >= 20.0
    assert len(fake.calls) == 2
    # The retry must be told what was wrong.
    assert "4.7s" in fake.calls[1][1]
    assert "rejected" in fake.calls[1][1]


def test_retry_is_bounded_to_one_extra_call(monkeypatch):
    fake = _FakeMistral([{"clips": [_raw(0.0, 4.7, score=90)]}])
    monkeypatch.setattr(clip_detection.mistral, "generate_json", fake.generate_json)
    assert clip_detection.find_clip_candidates([], [], 60.0) == []
    assert len(fake.calls) == 2, "must not loop forever on a hopeless answer"


def test_retry_on_past_the_end_clip(monkeypatch):
    fake = _FakeMistral(
        [
            {"clips": [_raw(0.0, 400.0, score=99)]},
            {"clips": [_raw(10.0, 50.0, score=80)]},
        ]
    )
    monkeypatch.setattr(clip_detection.mistral, "generate_json", fake.generate_json)
    result = clip_detection.find_clip_candidates([], [], 60.0)
    assert len(result) == 1
    assert "past the 60.0s end" in fake.calls[1][1]


def test_empty_model_list_is_retried(monkeypatch):
    fake = _FakeMistral([{"clips": []}, {"clips": [_raw(5.0, 45.0, score=70)]}])
    monkeypatch.setattr(clip_detection.mistral, "generate_json", fake.generate_json)
    result = clip_detection.find_clip_candidates([], [], 300.0)
    assert len(result) == 1
    assert "empty" in fake.calls[1][1]


def test_unparseable_payload_is_retried(monkeypatch):
    fake = _FakeMistral(["I cannot help with that", {"clips": [_raw(5.0, 45.0, score=70)]}])
    monkeypatch.setattr(clip_detection.mistral, "generate_json", fake.generate_json)
    assert len(clip_detection.find_clip_candidates([], [], 300.0)) == 1
    assert len(fake.calls) == 2


def test_describe_violations_names_the_minimum():
    problems = clip_detection._describe_violations(
        [_raw(0.0, 4.7, score=90)],
        duration=60.0,
        max_clips=3,
        min_duration=20.0,
        max_duration=90.0,
        min_score=0.0,
    )
    assert "4.7s" in problems
    assert "20s minimum" in problems
    assert "60s long" in problems
