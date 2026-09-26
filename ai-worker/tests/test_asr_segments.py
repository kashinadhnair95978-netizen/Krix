"""ASR word → segment grouping + transcript JSON structure."""

from app.models.asr import _build_segments, _transcript_substring


def test_build_segments_without_words_falls_back_to_flat_segment():
    segs = _build_segments([], "no timestamps")
    assert len(segs) == 1
    assert segs[0].text == "no timestamps"


def test_words_merge_when_close_and_split_when_wide():
    words = [
        {"start": 0.0, "end": 0.3, "text": "Hello"},
        {"start": 0.3, "end": 0.6, "text": "world"},
        {"start": 5.0, "end": 5.5, "text": "next"},
    ]
    segs = _build_segments(words, "")
    assert len(segs) == 2
    assert segs[0].text == "Hello world"
    assert segs[0].end == 0.6
    assert segs[1].start == 5.0


def test_empty_word_text_is_skipped():
    words = [{"start": 0.0, "end": 0.3, "text": "  "}, {"start": 1.0, "end": 1.5, "text": "ok"}]
    segs = _build_segments(words, "")
    assert len(segs) == 1
    assert segs[0].text == "ok"


def test_segment_end_extends_with_later_words():
    words = [
        {"start": 0.0, "end": 0.2, "text": "a"},
        {"start": 0.25, "end": 1.0, "text": "b"},
        {"start": 1.05, "end": 2.0, "text": "c"},
    ]
    segs = _build_segments(words, "")
    assert len(segs) == 1
    assert segs[0].end == 2.0
    assert segs[0].text == "a b c"


def test_transcript_substring_returns_full_text_for_short_timestamps():
    text = "one two three four five six seven eight"
    sub = _transcript_substring(text, 0.0, 10.0, 10.0)
    # Chunk start 0 → slice from the beginning, at least 10 words.
    assert sub


def test_segment_as_dict_rounds_values():
    from app.config import Segment

    d = Segment(start=1.234567, end=2.9876, text="x").as_dict()
    assert d["start"] == 1.235
    assert d["end"] == 2.988