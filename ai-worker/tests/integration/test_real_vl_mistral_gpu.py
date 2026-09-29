"""
Real GPU video analysis + clip detection on actual media.

Runs Qwen3-VL-4B-Instruct (8-bit) over frames extracted from a real video and
then Mistral-7B (4-bit NF4) over the real analysis output. No mocks, no stubs.

Skipped unless RUN_REAL_VL=1 AND work/testmedia/short_60s.mp4 is present
(build it with ``python work/make_test_media.py``).
"""

from __future__ import annotations

import os
import pathlib

import pytest

VIDEO = pathlib.Path("work/testmedia/short_60s.mp4")


@pytest.fixture(scope="module")
def real_media():
    if os.environ.get("RUN_REAL_VL") != "1":
        pytest.skip("RUN_REAL_VL=1 not set")
    if not VIDEO.exists():
        pytest.skip(f"test video missing: {VIDEO} (run work/make_test_media.py)")
    import torch

    if not torch.cuda.is_available():
        pytest.skip("CUDA not available (run on the worker host)")
    return str(VIDEO)


@pytest.fixture(scope="module")
def visual_analysis(real_media):
    from app.models.manager import free_gpu_cache, manager
    from app.services import video_analysis

    try:
        yield video_analysis.run_video_analysis(
            real_media, "work/testmedia/real_analysis", interval=8.0, max_frames=4
        )
    finally:
        manager.unload()
        free_gpu_cache()


# ---------------------------------------------------------------------------
# Qwen3-VL, 8-bit
# ---------------------------------------------------------------------------


def test_vision_model_loads_8bit(real_media):
    import torch

    from app.models import vision as vision_mod
    from app.models.manager import free_gpu_cache, manager

    try:
        bundle = vision_mod.load_vision()
        model = bundle["model"]
        params = list(model.parameters())
        assert params, "model has no parameters"
        assert any(p.dtype in (torch.float16, torch.bfloat16) for p in params)
        vram = torch.cuda.memory_allocated() / 1e9
        assert vram < 7.0, f"vision model reserved {vram:.2f} GB"
    finally:
        manager.unload()
        free_gpu_cache()


def test_video_analysis_produces_real_observations(visual_analysis):
    assert visual_analysis, "no visual analysis returned"
    for first in visual_analysis:
        assert "timestamp" in first, f"missing timestamp in {list(first)}"
        assert "description" in first, f"missing description in {list(first)}"
        assert first["description"].strip(), "empty frame description"
        assert float(first["timestamp"]) >= 0


def test_frame_timestamps_are_inside_the_real_video(visual_analysis, real_media):
    from app.services.audio import probe

    duration = float(probe(real_media)["duration"])
    for frame in visual_analysis:
        assert float(frame["timestamp"]) <= duration, (
            f"frame timestamp {frame['timestamp']} is past the {duration}s video"
        )


def test_frame_descriptions_are_not_identical_placeholders(visual_analysis):
    """Guards against a stubbed/cached model returning one canned string."""
    descriptions = [f.get("description", "").strip().lower() for f in visual_analysis]
    assert len(descriptions) >= 2
    assert len(set(descriptions)) >= 2, (
        "every frame got the same description — the model is not really running"
    )


# ---------------------------------------------------------------------------
# Mistral 7B, 4-bit NF4
# ---------------------------------------------------------------------------


def test_mistral_is_loaded_in_4bit(real_media):
    import torch

    from app.models import mistral as mistral_mod
    from app.models.manager import free_gpu_cache, manager

    try:
        bundle = mistral_mod.load_mistral()
        model = bundle["model"]
        vram = torch.cuda.memory_allocated() / 1e9
        # 4-bit 7B lands well under 8 GB; bf16 would need ~14 GB and would OOM.
        assert vram < 7.0, f"Mistral reserved {vram:.2f} GB — it does not look 4-bit"
        dtypes = {p.dtype for p in model.parameters()}
        assert torch.float16 in dtypes or torch.bfloat16 in dtypes, (
            f"no compute dtype found, only {dtypes}"
        )
    finally:
        manager.unload()
        free_gpu_cache()


def test_clip_prompt_embeds_a_parsable_json_shape():
    from app.services import clip_detection

    system, user = clip_detection.build_prompt(
        [{"start": 0.0, "end": 30.0, "text": "A strong opening hook here."}],
        [{"timestamp": 0.0, "description": "A person talking to camera"}],
        60.0,
    )
    # The template embeds a literal JSON example. If the braces are not escaped
    # this raises KeyError('"clips"') and every clip request dies.
    assert '{"clips"' in system
    assert "{{" not in system
    assert "60.0s" in user


def test_mistral_generates_validated_clip_candidates(visual_analysis):
    from app.models.manager import free_gpu_cache, manager
    from app.services import clip_detection

    duration = 60.0
    segments = [
        {"start": 0.0, "end": 24.0, "text": "I have a dream that one day this nation will rise up."},
        {"start": 24.0, "end": 48.0, "text": "He hoped there would be stew for dinner that night."},
        {"start": 48.0, "end": 60.0, "text": "And the whole family gathered around the table."},
    ]
    visual = [
        {
            "timestamp": float(f.get("timestamp", 0.0)),
            "description": f.get("description", ""),
            "observation": f.get("observation", ""),
        }
        for f in visual_analysis
    ]
    try:
        raw = clip_detection._run_mistral(segments, visual, duration)
        assert isinstance(raw, list), f"model returned {type(raw).__name__}, not a list"
        assert raw, "Mistral produced no clip candidates for real input"
        for candidate in raw:
            assert "start" in candidate and "end" in candidate
            assert float(candidate["end"]) > float(candidate["start"])

        ranked = clip_detection.find_clip_candidates(segments, visual, duration)
        assert ranked, "no candidate survived validation"
        for candidate in ranked:
            assert float(candidate["end"]) > float(candidate["start"])
            assert float(candidate["end"]) <= duration + 0.5
            assert 0.0 <= float(candidate["start"]) <= duration
            length = float(candidate["end"]) - float(candidate["start"])
            assert length >= clip_detection.cfg.MIN_CLIP_DURATION
            assert length <= clip_detection.cfg.MAX_CLIP_DURATION
        # No two selected clips may overlap.
        for a, b in zip(ranked, ranked[1:]):
            assert min(a["end"], b["end"]) - max(a["start"], b["start"]) <= 1.0
    finally:
        manager.unload()
        free_gpu_cache()
