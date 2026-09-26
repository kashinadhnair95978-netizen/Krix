"""Caption building: time formatting, wrapping, ASS/SRT output shape."""

from app.services import captions


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