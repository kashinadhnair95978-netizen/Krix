"""
Real GPU ASR integration test.

Runs Qwen3-ASR-1.7B on an actual audio file (real inference, not mocked).
Skipped unless RUN_REAL_ASR=1 AND the real test speech file is present.
"""

from __future__ import annotations

import os
import pathlib

import pytest

SPEECH = pathlib.Path("work") / "testmedia" / "speech.wav"


@pytest.fixture(scope="module")
def real_speech():
    if os.environ.get("RUN_REAL_ASR") != "1":
        pytest.skip("RUN_REAL_ASR=1 not set")
    if not SPEECH.exists():
        pytest.skip(f"real speech fixture missing: {SPEECH}")
    return str(SPEECH)


def test_real_asr_transcription(real_speech, monkeypatch):
    import torch

    if not torch.cuda.is_available():
        pytest.skip("CUDA not available (run on the worker host)")

    from app import config as cfg
    from app.models import asr as asr_mod
    from app.models.manager import manager, free_gpu_cache

    monkeypatch.setattr(cfg, "ASR_ENABLE_TIMESTAMPS", False)

    try:
        result = asr_mod.transcribe(real_speech)
        assert result.language == "English"
        assert len(result.text) > 50
        assert "dream" in result.text.lower()
    finally:
        manager.unload()
        free_gpu_cache()