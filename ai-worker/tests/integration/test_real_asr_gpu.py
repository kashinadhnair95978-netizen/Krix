"""
Real GPU ASR + forced-aligner integration test.

Runs Qwen3-ASR-1.7B and Qwen/Qwen3-ForcedAligner-0.6B-hf on a real audio file.
No mocks, no fabricated timestamps: every assertion is checked against the
audio that actually exists on disk.

Skipped unless RUN_REAL_ASR=1 AND work/testmedia/speech.wav is present.
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


@pytest.fixture(scope="module")
def aligned_result(real_speech):
    """Transcribe with timestamps enabled and the real aligner loaded."""
    import torch

    if not torch.cuda.is_available():
        pytest.skip("CUDA not available (run on the worker host)")

    from app.models import asr as asr_mod
    from app.models.manager import free_gpu_cache, manager

    try:
        yield asr_mod.transcribe(real_speech)
    finally:
        manager.unload()
        free_gpu_cache()


# ---------------------------------------------------------------------------
# Plain ASR
# ---------------------------------------------------------------------------


def test_real_asr_transcription(real_speech, monkeypatch):
    import torch

    if not torch.cuda.is_available():
        pytest.skip("CUDA not available (run on the worker host)")

    from app import config as cfg
    from app.models import asr as asr_mod
    from app.models.manager import free_gpu_cache, manager

    monkeypatch.setattr(cfg, "ASR_ENABLE_TIMESTAMPS", False)
    try:
        result = asr_mod.transcribe(real_speech)
        assert result.language == "English"
        assert len(result.text) > 50
        assert "dream" in result.text.lower()
    finally:
        manager.unload()
        free_gpu_cache()


# ---------------------------------------------------------------------------
# Forced alignment — the real model, real word timings
# ---------------------------------------------------------------------------


def test_forced_aligner_produces_real_word_timestamps(aligned_result):
    assert aligned_result.aligner_used is True, (
        "the aligner was loaded but returned no words: "
        + "; ".join(aligned_result.warnings)
    )
    assert len(aligned_result.words) > 20, "suspiciously few aligned words"


def test_word_timestamps_are_monotonic_and_ordered(aligned_result):
    previous_end = -1.0
    for word in aligned_result.words:
        start, end = word["start"], word["end"]
        assert end > start, f"non-positive duration for {word!r}"
        assert start >= previous_end - 0.05, f"words out of order at {word!r}"
        assert start >= 0.0
        previous_end = end


def test_word_timestamps_stay_inside_the_real_audio(aligned_result):
    import soundfile as sf

    info = sf.info(str(SPEECH))
    duration = info.duration
    for word in aligned_result.words:
        assert word["end"] <= duration + 0.5, (
            f"timestamp {word['end']}s is past the end of a {duration:.2f}s file: {word!r}"
        )


def test_aligned_words_reconstruct_the_transcript(aligned_result):
    """The aligned words must actually cover the transcript, not be a stub."""
    words = " ".join(w["text"] for w in aligned_result.words).lower()
    # Tokens that are genuinely spoken in work/testmedia/speech.wav.
    for token in ("dream", "nation", "creed"):
        assert token in words, f"'{token}' missing from aligned words"


def test_alignment_covers_most_of_the_transcript(aligned_result):
    aligned = " ".join(w["text"] for w in aligned_result.words).lower().split()
    transcript = aligned_result.text.lower().split()
    assert len(aligned) >= len(transcript) * 0.5, (
        f"only {len(aligned)} aligned words for a {len(transcript)}-word transcript"
    )


def test_segments_are_built_from_the_aligned_words(aligned_result):
    assert aligned_result.segments
    for seg in aligned_result.segments:
        assert seg.end > seg.start
        assert seg.end > 0.0
        assert seg.text.strip()
    # Segments must span the real audio, not a placeholder window.
    assert aligned_result.segments[-1].end > 1.0


def test_alignment_does_not_run_when_timestamps_are_disabled(real_speech, monkeypatch):
    import torch

    if not torch.cuda.is_available():
        pytest.skip("CUDA not available")

    from app import config as cfg
    from app.models import asr as asr_mod
    from app.models.manager import free_gpu_cache, manager

    monkeypatch.setattr(cfg, "ASR_ENABLE_TIMESTAMPS", False)
    try:
        result = asr_mod.transcribe(real_speech)
        assert result.aligner_used is False
        assert result.words == []
        # A flat segment that still has a real end time.
        assert len(result.segments) == 1
        assert result.segments[0].end > 0.0
    finally:
        manager.unload()
        free_gpu_cache()
