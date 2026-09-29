"""Unit tests for the Mistral JSON extraction hardening."""

from __future__ import annotations

import json

import pytest

from app.models.mistral import _extract_json, _strip_code_fence

CLIP = {
    "start": 1.0,
    "end": 12.0,
    "score": 0.8,
    "hook_score": 0.7,
    "story_score": 0.6,
    "information_score": 0.5,
    "emotion_score": 0.9,
    "visual_score": 0.4,
    "context_independence": 0.8,
    "reason": "strong hook",
}


def test_clean_json_round_trips():
    assert _extract_json(json.dumps({"clips": [CLIP]})) == {"clips": [CLIP]}


def test_trailing_prose_with_braces_is_ignored():
    """The production failure: valid object, then commentary containing braces.

    Old code sliced first '{' to last '}' and raised "Extra data".
    """
    raw = (
        json.dumps({"clips": [CLIP]}, indent=2)
        + "\n\nI chose 1 clip because it has a strong hook. "
        + "Here is my reasoning: {hook: high, story: medium}\n"
    )
    assert _extract_json(raw) == {"clips": [CLIP]}


def test_second_object_after_first_is_ignored():
    raw = json.dumps({"clips": [CLIP]}) + "\n" + json.dumps({"clips": []})
    assert _extract_json(raw) == {"clips": [CLIP]}


def test_leading_prose_before_json():
    raw = "Sure! Here are the clips:\n" + json.dumps({"clips": [CLIP]})
    assert _extract_json(raw) == {"clips": [CLIP]}


def test_markdown_fence_is_stripped():
    raw = "```json\n" + json.dumps({"clips": [CLIP]}) + "\n```"
    assert _extract_json(raw) == {"clips": [CLIP]}


def test_fence_with_trailing_commentary():
    raw = (
        "```json\n"
        + json.dumps({"clips": [CLIP]})
        + "\n```\n\nThat is the best clip. {note: ok}"
    )
    assert _extract_json(raw) == {"clips": [CLIP]}


def test_bare_fence_tag():
    raw = "```\n" + json.dumps({"clips": [CLIP]}) + "\n```"
    assert _extract_json(raw) == {"clips": [CLIP]}


def test_top_level_array_is_wrapped():
    assert _extract_json(json.dumps([CLIP])) == {"clips": [CLIP]}


def test_truncated_output_still_raises():
    """A cut-off object must NOT be accepted or auto-closed."""
    from app.config import PipelineError

    with pytest.raises(PipelineError) as exc:
        _extract_json('{"clips": [{"start": 1.0, "end":')
    assert exc.value.code == "LLM_INVALID_JSON"


def test_non_json_text_raises():
    from app.config import PipelineError

    with pytest.raises(PipelineError) as exc:
        _extract_json("I'm sorry, I cannot help with that request.")
    assert exc.value.code == "LLM_INVALID_JSON"


def test_empty_response_raises():
    from app.config import PipelineError

    with pytest.raises(PipelineError):
        _extract_json("")


def test_strip_code_fence_passthrough():
    assert _strip_code_fence("no fences here") == "no fences here"
