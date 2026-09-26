"""Clip candidate validation: bounds, duration, scoring, overlap dedupe, ordering."""

import pytest

from app.services.clip_detection import _overlaps_any, json_lines, validate_and_rank
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