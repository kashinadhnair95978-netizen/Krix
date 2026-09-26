"""
Real-media integration tests (no models, no GPU).

These shell out to the real ffmpeg/ffprobe binaries and generate a tiny clip
with ffmpeg test sources. They are skipped automatically when ffmpeg is missing.
"""

from __future__ import annotations

import shutil

import pytest

from app.services import audio, captions, rendering


@pytest.fixture(scope="module")
def tiny_video(tmp_path_factory):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("ffmpeg not available")
    out = tmp_path_factory.mktemp("media") / "tiny.mp4"
    audio.run_command(
        [
            ffmpeg,
            "-y",
            "-f", "lavfi", "-i", "testsrc2=duration=4:size=1280x720:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", str(out),
        ],
        stage="media",
    )
    return out


def test_real_probe(tiny_video):
    m = audio.probe(str(tiny_video))
    assert round(m["duration"], 0) == 4.0
    assert m["width"] == 1280 and m["height"] == 720
    assert m["has_video"] and m["has_audio"]
    assert m["codec"] == "h264"


def test_real_audio_extract(tiny_video, tmp_path):
    wav = tmp_path / "out.wav"
    audio.extract_audio(str(tiny_video), str(wav))
    assert wav.exists() and wav.stat().st_size > 50_000


def test_real_frame_sampling(tiny_video, tmp_path):
    shots = audio.sample_frames(str(tiny_video), tmp_path, interval=1.0, max_frames=4, start_offset=0.0)
    assert 3 <= len(shots) <= 4
    for _, frame_path in shots:
        import pathlib
        assert pathlib.Path(frame_path).stat().st_size > 1_000


def test_real_9x16_render_with_captions(tiny_video, tmp_path):
    cues = captions.segments_to_cues(
        [
            {"start": 0.5, "end": 1.8, "text": "Caption line one"},
            {"start": 1.8, "end": 3.2, "text": "Caption line two"},
        ]
    )
    ass_path = tmp_path / "caps.ass"
    ass_path.write_text(captions.build_ass(cues), encoding="utf-8")
    out = rendering.render_clip(str(tiny_video), str(tmp_path / "clip.mp4"), 0.5, 3.4,
                                captions_ass=str(ass_path))
    m = audio.probe(str(out))
    assert (m["width"], m["height"]) == (1080, 1920)
    assert m["has_video"] and m["has_audio"]
    assert round(m["duration"], 0) == 3.0


def test_real_ass_srt_output():
    cues = captions.segments_to_cues([{"start": 0.0, "end": 2.0, "text": "hello world here"}])
    ass = captions.build_ass(cues)
    assert "Dialogue: 0,0:00:00.00,0:00:02.00" in ass
    assert "Style: " in ass
    srt = captions.build_srt(cues)
    assert "-->" in srt
    assert "hello world" in srt