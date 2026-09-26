"""
Shared pytest fixtures/configuration.

Sets a deterministic env (auth disabled, small captions) BEFORE app.config is
first imported so tests are fast and hermetic.
"""

from __future__ import annotations

import os

os.environ["AI_WORKER_AUTH"] = "disabled"
os.environ["AI_WORKER_WORK_DIR"] = "ai-worker/work-test"
os.environ["KEEP_ARTIFACTS"] = "false"
os.environ["CAPTION_MAX_CHARS"] = "12"

import pytest  # noqa: E402


@pytest.fixture()
def sample_visual_events() -> list[dict]:
    return [
        {
            "timestamp": 0.0,
            "description": "Single speaker talking directly to camera",
            "speaker_count": 1,
            "speaker_position": "center",
            "scene_type": "podcast",
            "visual_interest": 0.8,
        },
        {
            "timestamp": 30.0,
            "description": "Screen recording of code editor",
            "speaker_count": 0,
            "speaker_position": "none",
            "scene_type": "screen_content",
            "visual_interest": 0.5,
        },
    ]


@pytest.fixture()
def sample_segments() -> list[dict]:
    return [
        {"start": 0.0, "end": 4.0, "text": "Hello and welcome to this video."},
        {"start": 4.0, "end": 12.0, "text": "Today we're talking about AI clipping."},
        {"start": 12.0, "end": 20.0, "text": "Here is the main point you need to remember."},
        {"start": 20.0, "end": 25.0, "text": "Share this with a friend."},
    ]