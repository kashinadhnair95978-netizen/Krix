"""
Real long-video ASR matrix.

Transcribes real 1-minute and 10-minute videos on the actual GPU and checks
that chunked ASR + forced alignment hold up: continuous text, monotonic
timestamps that stay inside the media, and no duplicated boundary text.

Skipped unless RUN_REAL_LONG=1. Build the media first:
    python work/make_test_media.py
"""

from __future__ import annotations

import os
import pathlib
import time

import pytest

MEDIA = pathlib.Path("work/testmedia")
SHORT = MEDIA / "short_60s.mp4"
LONG = MEDIA / "long_600s.mp4"
LONGEST = MEDIA / "long_1800s.mp4"
HOUR = MEDIA / "long_3600s.mp4"


@pytest.fixture(scope="module")
def enabled():
    if os.environ.get("RUN_REAL_LONG") != "1":
        pytest.skip("RUN_REAL_LONG=1 not set")
    import torch

    if not torch.cuda.is_available():
        pytest.skip("CUDA not available (run on the worker host)")
    return True


def _transcribe_video(video: str, workdir: str):
    """Extract audio then run the real ASR + aligner pipeline."""
    from app.models import asr as asr_mod
    from app.models.manager import free_gpu_cache, manager
    from app.services import audio as audio_svc

    path = pathlib.Path(workdir)
    path.mkdir(parents=True, exist_ok=True)
    wav = str(path / f"{pathlib.Path(video).stem}.wav")
    audio_svc.extract_audio(video, wav)
    started = time.time()
    try:
        result = asr_mod.transcribe(wav)
    finally:
        manager.unload()
        free_gpu_cache()
    return result, time.time() - started, wav


def _assert_sane(result, duration: float, label: str) -> None:
    assert result.text.strip(), f"{label}: empty transcript"
    assert len(result.text) > 50, f"{label}: suspiciously short transcript"
    assert result.chunk_count >= 1

    if result.words:
        previous_end = -1.0
        for word in result.words:
            assert word["end"] > word["start"], f"{label}: non-positive word {word}"
            assert word["start"] >= previous_end - 0.05, f"{label}: out of order {word}"
            assert word["end"] <= duration + 1.0, (
                f"{label}: word {word} ends past the {duration:.1f}s media"
            )
            previous_end = word["end"]
    for segment in result.segments:
        assert segment.end > segment.start, f"{label}: bad segment {segment}"
        assert segment.end > 0.0


# ---------------------------------------------------------------------------
# 1 minute
# ---------------------------------------------------------------------------


def test_one_minute_video(enabled):
    from app.services.audio import probe

    duration = float(probe(str(SHORT))["duration"])
    result, elapsed, _ = _transcribe_video(str(SHORT), "work/testmedia/long_asr")
    _assert_sane(result, duration, "1min")
    print(f"\n[1min] {len(result.text)} chars, {result.chunk_count} chunk(s), "
          f"{len(result.words)} words, aligner={result.aligner_used}, {elapsed:.1f}s")
    assert "dream" in result.text.lower(), "the real speech was not transcribed"


# ---------------------------------------------------------------------------
# 10 minutes — must exercise chunk stitching
# ---------------------------------------------------------------------------


def test_ten_minute_video(enabled):
    from app import config as cfg
    from app.services.audio import probe

    duration = float(probe(str(LONG))["duration"])
    result, elapsed, _ = _transcribe_video(str(LONG), "work/testmedia/long_asr")
    _assert_sane(result, duration, "10min")
    print(f"\n[10min] {len(result.text)} chars, {result.chunk_count} chunk(s), "
          f"{len(result.words)} words, aligner={result.aligner_used}, {elapsed:.1f}s")

    # 600s of audio with a 300s chunk size must actually be chunked.
    expected_min = max(1, int(duration // cfg.ASR_CHUNK_SECONDS))
    assert result.chunk_count >= expected_min, (
        f"only {result.chunk_count} chunks for {duration}s of audio "
        f"(expected at least {expected_min})"
    )
    for warning in result.warnings:
        print(f"[10min] warning: {warning}")


def test_chunk_stitching_does_not_duplicate_a_boundary_run(enabled):
    """The same sentence repeats in the looped audio, but never twice in a row."""
    from app.models.asr import merge_chunk_texts

    merged = merge_chunk_texts(
        [
            "I have a dream that one day this nation will rise up and live out "
            "the true meaning of its creed",
            "the true meaning of its creed He hoped there would be stew for dinner",
        ]
    )
    assert merged.count("the true meaning of its creed") == 1
    assert merged.startswith("I have a dream")
    assert merged.endswith("stew for dinner")


# ---------------------------------------------------------------------------
# 30 minutes
# ---------------------------------------------------------------------------


def test_thirty_minute_video(enabled):
    from app import config as cfg
    from app.services.audio import probe

    if not LONGEST.exists():
        pytest.skip("long_1800s.mp4 missing (run work/make_long_media.py)")

    duration = float(probe(str(LONGEST))["duration"])
    result, elapsed, _ = _transcribe_video(str(LONGEST), "work/testmedia/long_asr")
    _assert_sane(result, duration, "30min")
    print(f"\n[30min] {len(result.text)} chars, {result.chunk_count} chunk(s), "
          f"{len(result.words)} words, aligner={result.aligner_used}, {elapsed:.1f}s")

    expected_min = max(1, int(duration // cfg.ASR_CHUNK_SECONDS))
    assert result.chunk_count >= expected_min, (
        f"only {result.chunk_count} chunks for {duration}s (expected >= {expected_min})"
    )
    for warning in result.warnings:
        print(f"[30min] warning: {warning}")


# ---------------------------------------------------------------------------
# 60 minutes — the long tail
# ---------------------------------------------------------------------------


def test_sixty_minute_video(enabled):
    from app import config as cfg
    from app.services.audio import probe

    if not HOUR.exists():
        pytest.skip("long_3600s.mp4 missing (run work/make_long_media.py)")

    duration = float(probe(str(HOUR))["duration"])
    result, elapsed, _ = _transcribe_video(str(HOUR), "work/testmedia/long_asr")
    _assert_sane(result, duration, "60min")
    print(f"\n[60min] {len(result.text)} chars, {result.chunk_count} chunk(s), "
          f"{len(result.words)} words, aligner={result.aligner_used}, {elapsed:.1f}s")

    expected_min = max(1, int(duration // cfg.ASR_CHUNK_SECONDS))
    assert result.chunk_count >= expected_min, (
        f"only {result.chunk_count} chunks for {duration}s (expected >= {expected_min})"
    )
    for warning in result.warnings:
        print(f"[60min] warning: {warning}")
