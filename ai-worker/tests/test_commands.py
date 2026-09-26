"""FFmpeg command building + frame sampling math (no binaries required)."""

from app.services.audio import build_audio_extract_command, frame_timestamps
from app.services.rendering import build_render_command, escape_filter_path


def test_build_audio_extract_command_includes_wav_flags():
    cmd = build_audio_extract_command("in.mp4", "out.wav", 16000, ffmpeg="ffmpeg-custom")
    assert cmd[0] == "ffmpeg-custom"
    assert "-vn" in cmd
    assert "-ac" in cmd and "1" in cmd
    assert "-ar" in cmd and "16000" in cmd
    assert "pcm_s16le" in cmd
    assert cmd[-1] == "out.wav"


def test_frame_timestamps_honors_interval():
    timestamps = frame_timestamps(30.0, interval=10.0, max_frames=10)
    assert timestamps == [0.0, 10.0, 20.0]


def test_frame_timestamps_honors_max_frames():
    timestamps = frame_timestamps(300.0, interval=1.0, max_frames=5)
    assert len(timestamps) == 5


def test_frame_timestamps_respects_start_offset():
    timestamps = frame_timestamps(30.0, interval=10.0, max_frames=5, start_offset=5.0)
    assert timestamps == [5.0, 15.0, 25.0]


def test_frame_timestamps_empty_for_zero_duration():
    assert frame_timestamps(0.0, interval=10.0, max_frames=5) == []


def test_build_render_command_vertical_short():
    cmd = build_render_command(
        "movie.mp4", "out.mp4", 10.0, 40.0,
        width=1080, height=1920, fps=30, crf=23,
        ffmpeg="ffmpeg",
    )
    joined = " ".join(cmd)
    assert cmd[0] == "ffmpeg"
    assert "-ss" in cmd and "10.000" in cmd
    assert "-t" in cmd and "30.000" in cmd
    assert "scale=1080:1920:force_original_aspect_ratio=increase" in joined
    assert "crop=1080:1920" in joined
    assert "-c:v libx264" in joined
    assert "out.mp4" == cmd[-1]


def test_build_render_command_with_captions_adds_subtitles_filter():
    cmd = build_render_command(
        "m.mp4", "o.mp4", 0.0, 10.0, captions_ass="C:/tmp/caps.ass", ffmpeg="ffmpeg"
    )
    joined = " ".join(cmd)
    assert "subtitles=" in joined
    assert "subtitles='C\\:/tmp/caps.ass'" in joined


def test_build_render_command_base_is_idempotent():
    a = build_render_command("m.mp4", "o.mp4", 1.0, 2.0, ffmpeg="ffmpeg")
    b = build_render_command("m.mp4", "o.mp4", 1.0, 2.0, ffmpeg="ffmpeg")
    assert a == b


def test_escape_filter_path_windows_drive():
    escaped = escape_filter_path(r"C:\Users\me\captions.ass")
    assert escaped == "'C\\:/Users/me/captions.ass'"