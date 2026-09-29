"""Chunked ASR: chunk planning, token budget, transcript stitching, segments.

All pure functions — no torch, no GPU, no audio file required.
"""

import pytest

from app.config import Segment
from app.models.asr import (
    MIN_WORD_SECONDS,
    Chunk,
    build_segments,
    chunk_token_budget,
    dedupe_words,
    merge_chunk_texts,
    monotonic_words,
    needs_chunking,
    plan_chunks,
    strip_overlap,
)


# ---------------------------------------------------------------------------
# Short audio
# ---------------------------------------------------------------------------


def test_short_audio_is_a_single_chunk():
    chunks = plan_chunks(39.9, chunk_seconds=300.0, overlap_seconds=2.0)
    assert len(chunks) == 1
    assert chunks[0].start == 0.0
    assert chunks[0].end == 39.9


def test_short_audio_does_not_need_chunking():
    assert needs_chunking(39.9, chunk_seconds=300.0) is False
    assert needs_chunking(301.0, chunk_seconds=300.0) is True


def test_zero_duration_still_yields_one_usable_chunk():
    chunks = plan_chunks(0.0)
    assert len(chunks) == 1
    assert chunks[0].duration == 0.0


# ---------------------------------------------------------------------------
# Multi-chunk audio
# ---------------------------------------------------------------------------


def test_multi_chunk_audio_covers_the_whole_range():
    chunks = plan_chunks(700.0, chunk_seconds=300.0, overlap_seconds=2.0)
    assert len(chunks) == 3
    assert chunks[0].start == 0.0
    assert chunks[-1].end == 700.0
    # Windows are contiguous-with-overlap and make forward progress.
    for previous, current in zip(chunks, chunks[1:]):
        assert current.start > previous.start
        assert current.start < previous.end
        assert current.end > previous.end


def test_chunk_windows_never_exceed_the_chunk_size():
    for duration in (301.0, 599.5, 1800.0, 3601.0):
        for chunk in plan_chunks(duration, chunk_seconds=300.0, overlap_seconds=2.0):
            assert chunk.duration <= 300.0 + 1e-6


def test_exact_multiple_of_chunk_size_does_not_produce_a_trailing_empty_chunk():
    chunks = plan_chunks(600.0, chunk_seconds=300.0, overlap_seconds=2.0)
    assert chunks[-1].end == 600.0
    assert all(chunk.duration > 0 for chunk in chunks)


# ---------------------------------------------------------------------------
# Token budget
# ---------------------------------------------------------------------------


def test_token_budget_scales_with_chunk_length():
    short = chunk_token_budget(Chunk(index=0, start=0.0, end=30.0))
    long = chunk_token_budget(Chunk(index=0, start=0.0, end=300.0))
    assert short < long
    assert long <= 4096


def test_token_budget_is_never_below_a_usable_floor():
    assert chunk_token_budget(Chunk(index=0, start=0.0, end=0.1)) >= 64


def test_token_budget_respects_the_configured_ceiling(monkeypatch):
    from app import config as cfg

    monkeypatch.setattr(cfg, "ASR_MAX_NEW_TOKENS", 700)
    monkeypatch.setattr(cfg, "ASR_TOKENS_PER_SECOND", 50.0)
    assert chunk_token_budget(Chunk(index=0, start=0.0, end=600.0)) == 700


# ---------------------------------------------------------------------------
# Chunk boundary merging / duplicate boundary text
# ---------------------------------------------------------------------------


def test_merge_single_chunk_is_verbatim():
    assert merge_chunk_texts(["  Hello and welcome.  "]) == "Hello and welcome."


def test_merge_two_chunks_joins_with_a_space():
    merged = merge_chunk_texts(["Hello there.", "This is the second chunk."])
    assert merged == "Hello there. This is the second chunk."


def test_merge_removes_duplicated_boundary_text():
    # A 2 s overlap makes the tail of chunk 0 repeat at the head of chunk 1.
    merged = merge_chunk_texts(
        [
            "The quick brown fox jumps over the lazy dog and keeps running.",
            "and keeps running. Then the whole idea of the video is explained.",
        ]
    )
    assert merged.count("and keeps running") == 1
    assert merged.startswith("The quick brown fox")
    assert merged.endswith("explained.")


def test_merge_removes_a_longer_duplicated_boundary_run():
    merged = merge_chunk_texts(
        [
            "one two three four five six seven eight nine ten",
            "seven eight nine ten eleven twelve",
        ]
    )
    assert merged == "one two three four five six seven eight nine ten eleven twelve"


def test_merge_drops_a_fully_duplicated_chunk():
    merged = merge_chunk_texts(["all of this was already said", "all of this was already said"])
    assert merged == "all of this was already said"


def test_merge_removes_a_repeated_word_across_a_chunk_boundary():
    # Chunk 0 ends on "simple," and chunk 1 restates "simple:" — that is the
    # duplicated boundary word, so only the first copy survives.
    merged = merge_chunk_texts(["...so the answer is simple,", "simple: ship it."])
    assert merged == "...so the answer is simple, ship it."
    assert merged.count("simple") == 1


def test_merge_joins_a_hyphenated_word_without_inserting_a_space():
    merged = merge_chunk_texts(["we were state-", "of-the-art models"])
    assert merged == "we were state-of-the-art models"


def test_merge_skips_empty_chunks():
    merged = merge_chunk_texts(["first part", "", "   ", "second part"])
    assert merged == "first part second part"


def test_merge_of_nothing_is_empty():
    assert merge_chunk_texts([]) == ""
    assert merge_chunk_texts(["", "  "]) == ""


def test_strip_overlap_returns_the_original_when_there_is_none():
    assert strip_overlap("alpha beta", "gamma delta") == "gamma delta"


def test_strip_overlap_is_case_and_punctuation_insensitive():
    assert strip_overlap("...the Quick, brown", "quick brown fox") == "fox"

# ---------------------------------------------------------------------------
# Timestamp offsets
# ---------------------------------------------------------------------------


def test_merge_of_many_chunks_has_no_repeated_boundary_run():
    chunks = [
        "alpha bravo charlie delta echo",
        "echo foxtrot golf hotel india",
        "india juliet kilo lima mike",
    ]
    merged = merge_chunk_texts(chunks)
    assert merged == "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike"


# ---------------------------------------------------------------------------
# Word dedupe (chunk overlap produces overlapping word timings)
# ---------------------------------------------------------------------------


def test_dedupe_words_drops_overlapping_repeats():
    words = [
        {"text": "hello", "start": 0.0, "end": 0.3},
        {"text": "world", "start": 0.3, "end": 0.6},
        # Same word again because the next chunk overlapped by 0.1 s.
        {"text": "world", "start": 0.5, "end": 0.8},
        {"text": "again", "start": 0.9, "end": 1.2},
    ]
    deduped = dedupe_words(words)
    assert [w["text"] for w in deduped] == ["hello", "world", "again"]
    assert deduped[1]["end"] == 0.8  # kept the wider timing


def test_dedupe_words_keeps_genuine_repeats_far_apart():
    words = [
        {"text": "very", "start": 0.0, "end": 0.3},
        {"text": "very", "start": 4.0, "end": 4.3},
    ]
    assert len(dedupe_words(words)) == 2


def test_dedupe_words_sorts_by_start_time():
    words = [
        {"text": "b", "start": 5.0, "end": 5.4},
        {"text": "a", "start": 1.0, "end": 1.4},
    ]
    assert [w["text"] for w in dedupe_words(words)] == ["a", "b"]


def test_dedupe_words_strips_blank_tokens():
    words = [{"text": "  ", "start": 0.0, "end": 0.2}, {"text": "ok", "start": 1.0, "end": 1.2}]
    assert [w["text"] for w in dedupe_words(words)] == ["ok"]


# ---------------------------------------------------------------------------
# Segments
# ---------------------------------------------------------------------------


def test_build_segments_without_words_uses_the_audio_duration():
    segs = build_segments([], "no timestamps", duration=42.5)
    assert len(segs) == 1
    assert segs[0].text == "no timestamps"
    assert segs[0].start == 0.0
    assert segs[0].end == 42.5


def test_build_segments_without_words_and_without_duration_still_has_a_positive_end():
    """The old fallback produced end=0, which fails SegmentOut (end > 0)."""
    segs = build_segments([], "no timestamps")
    assert segs[0].end > 0


def test_build_segments_end_always_passes_the_transcript_schema():
    from app.schemas.pipeline import SegmentOut, TranscriptOut

    for duration in (0.0, 0.4, 1.0, 3600.0):
        segs = build_segments([], "text only", duration=duration)
        out = TranscriptOut(
            segments=[SegmentOut(start=s.start, end=s.end, text=s.text) for s in segs],
            text="text only",
        )
        assert out.segments[0].end > out.segments[0].start


def test_words_merge_when_close_and_split_when_wide():
    words = [
        {"start": 0.0, "end": 0.3, "text": "Hello"},
        {"start": 0.3, "end": 0.6, "text": "world"},
        {"start": 5.0, "end": 5.5, "text": "next"},
    ]
    segs = build_segments(words, "")
    assert len(segs) == 2
    assert segs[0].text == "Hello world"
    assert segs[0].end == 0.6
    assert segs[1].start == 5.0


def test_empty_word_text_is_skipped():
    words = [{"start": 0.0, "end": 0.3, "text": "  "}, {"start": 1.0, "end": 1.5, "text": "ok"}]
    segs = build_segments(words, "")
    assert len(segs) == 1
    assert segs[0].text == "ok"


def test_segment_end_extends_with_later_words():
    words = [
        {"start": 0.0, "end": 0.2, "text": "a"},
        {"start": 0.25, "end": 1.0, "text": "b"},
        {"start": 1.05, "end": 2.0, "text": "c"},
    ]
    segs = build_segments(words, "")
    assert len(segs) == 1
    assert segs[0].end == 2.0
    assert segs[0].text == "a b c"


def test_segment_times_are_preserved_from_the_word_offsets():
    words = [
        {"start": 312.4, "end": 312.9, "text": "late"},
        {"start": 313.0, "end": 313.6, "text": "chunk"},
    ]
    segs = build_segments(words, "")
    assert segs[0].start == 312.4
    assert segs[0].end == 313.6


def test_segment_as_dict_rounds_values():
    d = Segment(start=1.234567, end=2.9876, text="x").as_dict()
    assert d["start"] == 1.235
    assert d["end"] == 2.988


# ---------------------------------------------------------------------------
# monotonic_words: the aligner can emit start == end and overlapping words
# ---------------------------------------------------------------------------


def test_monotonic_words_gives_a_zero_length_word_a_real_duration():
    fixed = monotonic_words([{"text": "a", "start": 1.0, "end": 1.0}])
    assert fixed[0]["end"] > fixed[0]["start"]
    assert fixed[0]["end"] - fixed[0]["start"] == pytest.approx(MIN_WORD_SECONDS)


def test_monotonic_words_respects_a_normal_word():
    fixed = monotonic_words([{"text": "hello", "start": 1.0, "end": 1.4}])
    assert fixed == [{"text": "hello", "start": 1.0, "end": 1.4}]


def test_monotonic_words_clamps_an_overlap():
    fixed = monotonic_words(
        [
            {"text": "one", "start": 0.0, "end": 1.0},
            {"text": "two", "start": 0.5, "end": 1.5},
        ]
    )
    assert fixed[1]["start"] >= fixed[0]["end"]
    assert fixed[1]["end"] > fixed[1]["start"]


def test_monotonic_words_sorts_out_of_order_input():
    fixed = monotonic_words(
        [
            {"text": "late", "start": 5.0, "end": 5.5},
            {"text": "early", "start": 1.0, "end": 1.5},
        ]
    )
    assert [w["text"] for w in fixed] == ["early", "late"]


def test_monotonic_words_is_always_strictly_ordered():
    raw = [
        {"text": f"w{i}", "start": i * 0.1, "end": i * 0.1 + 0.2} for i in range(20)
    ]
    fixed = monotonic_words(raw)
    for a, b in zip(fixed, fixed[1:]):
        assert a["end"] <= b["start"]
        assert a["end"] > a["start"]


def test_monotonic_words_handles_an_empty_list():
    assert monotonic_words([]) == []
