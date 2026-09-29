"""Caption building: time formatting, wrapping, word grouping, ASS/SRT output shape."""

from app.services import captions
from app.services.captions import words_to_cues


def test_ass_time_formats_zero():
    assert captions.ass_time(0.0) == "0:00:00.00"


def test_ass_time_handles_seconds_and_subsecond():
    assert captions.ass_time(61.5) == "0:01:01.50"
    assert captions.ass_time(3600 + 120 + 3.25) == "1:02:03.25"


def test_ass_time_never_negative():
    assert captions.ass_time(-5) == "0:00:00.00"


def test_srt_time_format():
    assert captions.srt_time(61.5) == "00:01:01,500"


def test_ass_color_converts_six_digit():
    assert captions.ass_color("FFFFFF") == "&H00FFFFFF"
    assert captions.ass_color("#FF0000") == "&H000000FF"


def test_unknown_color_falls_back_to_white():
    assert captions.ass_color("zz") == "&H00FFFFFF"


def test_wrap_text_breaks_lines_within_limit():
    wrapped = captions.wrap_text("a b c d e f g", max_chars=8)
    lines = wrapped.split("\x85")
    assert all(len(line) <= 8 for line in lines)
    assert lines[0] == "a b c d"


def test_wrap_text_single_long_word_is_truncated():
    wrapped = captions.wrap_text("abcdefghijklmnopqrstuvwxyz", max_chars=10)
    assert len(wrapped) <= 10


def test_segments_to_cues_filters_empty_text_and_orders():
    cues = captions.segments_to_cues(
        [
            {"start": 5.0, "end": 6.0, "text": " no "},
            {"start": 1.0, "end": 2.0, "text": ""},
            {"start": 0.5, "end": 1.0, "text": "hi"},
        ],
        max_chars=10,
    )
    assert [c["start"] for c in cues] == [0.5, 5.0]
    assert "hi" in cues[0]["text"]


def test_segments_to_cues_guarantees_min_end():
    cues = captions.segments_to_cues([{"start": 2.0, "end": 2.05, "text": "ok"}])
    assert cues[0]["end"] >= cues[0]["start"] + 0.3


def test_build_ass_output_shape():
    ass = captions.build_ass([{"start": 0.0, "end": 2.0, "text": "hello world"}], width=1080, height=1920)
    assert "[Script Info]" in ass
    assert "PlayResX: 1080" in ass
    assert "Dialogue: 0,0:00:00.00,0:00:02.00," in ass
    assert "Dialogue" not in ass.split("Dialogue: 0,")[0]


def test_build_srt_orders_and_prefixes():
    srt = captions.build_srt([{"start": 2.0, "end": 3.0, "text": "second"}, {"start": 0.0, "end": 1.0, "text": "first"}])
    assert srt.index("first") < srt.index("second")
    assert "00:00:00,000 --> 00:00:01,000" in srt


def test_dialogue_text_escapes_ass_parens():
    ass = captions.build_ass([{"start": 0.0, "end": 1.0, "text": "a {b} c"}])
    assert "(b)" in ass
    assert "{b}" not in ass


# ---------------------------------------------------------------------------
# Word-level cue grouping (the real captions path)
# ---------------------------------------------------------------------------


def _w(text, start, end):
    return {"text": text, "start": start, "end": end}


def test_words_group_into_short_readable_cues():
    words = [
        _w("I", 0.0, 0.2), _w("have", 0.2, 0.4), _w("a", 0.4, 0.5), _w("dream", 0.5, 0.8),
        _w("that", 0.8, 1.0), _w("one", 1.0, 1.2), _w("day", 1.2, 1.4), _w("this", 1.4, 1.6),
        _w("nation", 1.6, 1.9), _w("will", 1.9, 2.1), _w("rise", 2.1, 2.3), _w("up", 2.3, 2.5),
    ]
    cues = words_to_cues(words, max_chars=32, max_words=6, max_duration=4.0)
    assert len(cues) == 2, "12 words at 6 per cue is exactly two cues"
    for cue in cues:
        assert cue["end"] > cue["start"]
        assert len(cue["text"].replace("\x85", " ")) <= 32
        assert len(cue["text"].split("\x85")[0].split()) <= 6
    joined = " ".join(c["text"].replace("\x85", " ") for c in cues)
    for text in ("I", "have", "dream", "nation", "rise", "up"):
        assert text in joined


def test_long_word_run_splits_proportionally():
    words = [_w(f"w{i}", i * 0.3, i * 0.3 + 0.2) for i in range(60)]
    cues = words_to_cues(words, max_chars=32, max_words=6, max_duration=4.0)
    assert len(cues) >= 10
    # No cue may be a wall of text.
    for cue in cues:
        assert len(cue["text"].replace("\x85", " ")) <= 32


def test_words_break_on_sentence_punctuation():
    words = [_w("Yes", 0.0, 0.3), _w("truly.", 0.3, 0.6), _w("However", 0.6, 0.9),
             _w("this", 0.9, 1.1), _w("changes", 1.1, 1.4)]
    # Wide limits, so the only possible break is the sentence-ending period.
    cues = words_to_cues(words, max_words=99, max_chars=999, max_duration=60.0)
    assert len(cues) == 2
    assert cues[0]["text"].replace("\x85", " ").endswith("truly.")
    assert cues[1]["text"].startswith("However")


def test_words_group_on_the_configured_char_limit():
    # conftest pins CAPTION_MAX_CHARS=12 for the suite, so a 3-word run cannot
    # stay in one cue no matter how few words it holds.
    words = [_w("one", 0.0, 0.3), _w("two", 0.3, 0.6), _w("three", 0.6, 0.9)]
    assert len(words_to_cues(words, max_chars=12, max_words=99)) > 1


def test_words_break_on_a_long_pause():
    words = [_w("before", 0.0, 0.4), _w("after", 3.0, 3.4)]
    cues = words_to_cues(words)
    assert len(cues) == 2
    assert cues[1]["start"] == 3.0


def test_words_ignore_short_gaps():
    words = [_w("a", 0.0, 0.2), _w("b", 0.25, 0.45), _w("c", 0.5, 0.7)]
    assert len(words_to_cues(words, max_words=6, max_chars=200)) == 1


def test_word_cue_never_exceeds_max_duration():
    words = [_w(f"w{i}", i * 0.4, i * 0.4 + 0.3) for i in range(40)]
    cues = words_to_cues(words, max_words=99, max_chars=999, max_duration=2.0)
    assert len(cues) > 1
    for cue in cues:
        assert cue["end"] - cue["start"] <= 2.0 + 1e-6


def test_word_cue_respects_max_chars():
    words = [_w("extraordinarily", 0.0, 0.5), _w("long", 0.5, 0.8), _w("words", 0.8, 1.1)]
    cues = words_to_cues(words, max_words=99, max_chars=12)
    for cue in cues:
        for line in cue["text"].split("\x85"):
            assert len(line) <= 12


def test_words_skip_malformed_and_empty_entries():
    words = [
        {"text": "", "start": 0.0, "end": 0.4},
        {"text": "ok", "start": 0.4, "end": 0.4},
        {"text": "kept", "start": 1.0, "end": 1.4},
        {"start": 2.0, "end": 2.4},
    ]
    cues = words_to_cues(words, max_words=99, max_chars=200)
    assert cues
    assert "kept" in cues[0]["text"].replace("\x85", " ")
    for cue in cues:
        assert cue["end"] > cue["start"], "zero-length cues are unusable for burn-in"


def test_words_to_cues_empty_input():
    assert words_to_cues([]) == []