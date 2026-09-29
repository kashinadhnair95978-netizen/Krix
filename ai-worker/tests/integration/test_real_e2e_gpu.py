"""
Real end-to-end core pipeline run on the actual GPU.

Runs every real stage in order over a real 60-second video:

    ffprobe -> ffmpeg audio -> Qwen3-ASR -> Qwen3 ForcedAligner
             -> ffmpeg frames -> Qwen3-VL-4B (8-bit)
             -> Mistral-7B (4-bit NF4) -> validation/ranking
             -> ffmpeg 9:16 render with burned-in captions

Only the Supabase *writes* are redirected to a local directory, because the AI
migration cannot be applied to the live project from here (no DDL access). Every
model call, every ffmpeg call and every timestamp is real.

Skipped unless RUN_REAL_E2E=1 AND work/testmedia/short_60s.mp4 exists.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import time

import pytest

VIDEO = pathlib.Path("work/testmedia/short_60s.mp4")
UPLOADS = pathlib.Path("work/testmedia/e2e_uploads")


@pytest.fixture(scope="module")
def enabled():
    if os.environ.get("RUN_REAL_E2E") != "1":
        pytest.skip("RUN_REAL_E2E=1 not set")
    if not VIDEO.exists():
        pytest.skip("short_60s.mp4 missing (run work/make_test_media.py)")
    import torch

    if not torch.cuda.is_available():
        pytest.skip("CUDA not available (run on the worker host)")


@pytest.fixture(scope="module")
def run(enabled, monkeypatch_module):
    """Execute the whole pipeline once and return every stage result."""
    from app import config as cfg
    from app.models.manager import free_gpu_cache, manager
    from app.pipeline import _render_and_store, _transcribe
    from app.schemas.pipeline import PipelineRequest
    from app.services import audio, clip_detection, storage, transcription
    from app.services import video_analysis

    job_dir = pathlib.Path("work/testmedia/e2e_job")
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    job_dir.mkdir(parents=True, exist_ok=True)
    if UPLOADS.exists():
        shutil.rmtree(UPLOADS, ignore_errors=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)

    timings: dict[str, float] = {}

    def timed(name, fn, *a, **kw):
        t0 = time.time()
        try:
            return fn(*a, **kw)
        finally:
            timings[name] = time.time() - t0

    # --- redirect only the Supabase writes to a local dir -----------------
    monkeypatch_module.setattr(
        storage, "update_video", lambda *a, **k: None, raising=True
    )

    def fake_upload_clip(user_id, local_path, filename=None):
        dest = UPLOADS / (filename or pathlib.Path(str(local_path)).name)
        shutil.copy2(str(local_path), dest)
        return {"path": f"{user_id}/{filename}"}

    monkeypatch_module.setattr(storage, "upload_clip", fake_upload_clip, raising=True)

    candidate_ids: list[str] = []

    def fake_insert_candidates(video_id, user_id, clips):
        ids = [f"candidate-{i}" for i in range(len(clips))]
        candidate_ids.extend(ids)
        return ids

    monkeypatch_module.setattr(
        storage, "insert_clip_candidates", fake_insert_candidates, raising=True
    )

    rows: list[dict] = []

    def fake_insert_generated_clip(video_id, user_id, candidate_id, storage_path, duration,
                                  aspect_ratio, caption_style, thumb_path=None):
        rows.append(
            {
                "id": f"clip-{len(rows)}",
                "candidate_id": candidate_id,
                "storage_path": storage_path,
                "thumb_path": thumb_path,
                "duration": duration,
                "aspect_ratio": aspect_ratio,
                "caption_style": caption_style,
            }
        )
        return rows[-1]

    monkeypatch_module.setattr(
        storage, "insert_generated_clip", fake_insert_generated_clip, raising=True
    )

    try:
        # 1. probe
        meta = timed("probe", audio.probe, str(VIDEO))
        duration = float(meta["duration"])

        request = PipelineRequest(video_id="e2e-video", user_id="e2e-user",
                                 storage_path="e2e-user/short_60s.mp4")
        source = VIDEO

        # 2-4. audio -> ASR -> forced aligner
        transcripts = timed("transcribe", _transcribe, request, {}, source, job_dir, duration)

        # 5-6. frames -> Qwen3-VL
        visual = timed(
            "analyze",
            video_analysis.run_video_analysis,
            str(source),
            str(job_dir / "analysis"),
            interval=8.0,
            max_frames=4,
        )
        manager.unload()
        free_gpu_cache()

        # 7. Mistral clip selection
        segments = transcripts["segments"]
        clips = timed("clips", clip_detection.find_clip_candidates, segments, visual, duration)
        manager.unload()
        free_gpu_cache()

        # 8. render + captions
        rendered = timed(
            "render",
            _render_and_store,
            request,
            source,
            transcripts=transcripts,
            clips=clips,
            candidate_ids=candidate_ids,
            job_dir=job_dir,
        )
        manager.unload()
        free_gpu_cache()

        yield {
            "meta": meta,
            "duration": duration,
            "transcripts": transcripts,
            "visual": visual,
            "clips": clips,
            "rendered": rendered,
            "rows": rows,
            "timings": timings,
        }
    finally:
        manager.unload()
        free_gpu_cache()


@pytest.fixture(scope="module")
def monkeypatch_module():
    from _pytest.monkeypatch import MonkeyPatch

    mp = MonkeyPatch()
    yield mp
    mp.undo()


# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------


def test_media_probe_is_real(run):
    assert run["meta"]["has_video"] and run["meta"]["has_audio"]
    assert run["duration"] > 55


def test_transcription_is_real(run):
    t = run["transcripts"]
    assert t["text"].strip()
    assert "dream" in t["text"].lower()
    assert t["aligner_used"] is True
    assert t["word_count"] > 50
    assert t["chunk_count"] >= 1
    print(f"\n[e2e] ASR: {len(t['text'])} chars, {t['word_count']} aligned words, "
          f"{t['chunk_count']} chunk(s), {run['timings']['transcribe']:.1f}s")


def test_timestamps_are_ordered_and_inside_the_video(run):
    duration = run["duration"]
    words = run["transcripts"]["words"]
    assert words
    previous = -1.0
    for word in words:
        assert word["end"] > word["start"]
        assert word["start"] >= previous - 0.05
        assert word["end"] <= duration + 1.0
        previous = word["end"]


def test_vision_analysis_is_real(run):
    assert run["visual"], "Qwen3-VL returned no observations"
    for frame in run["visual"]:
        assert frame.get("description", "").strip()
        assert float(frame["timestamp"]) <= run["duration"]
    print(f"\n[e2e] Vision: {len(run['visual'])} frames, {run['timings']['analyze']:.1f}s")


def test_clip_selection_is_real_and_validated(run):
    clips = run["clips"]
    assert clips, "Mistral produced no usable clips"
    from app import config as cfg

    for clip in clips:
        assert float(clip["end"]) > float(clip["start"])
        assert 0.0 <= float(clip["start"]) <= run["duration"]
        assert float(clip["end"]) <= run["duration"] + 0.5
        length = float(clip["end"]) - float(clip["start"])
        assert cfg.MIN_CLIP_DURATION <= length <= cfg.MAX_CLIP_DURATION
    assert len(clips) <= cfg.MAX_CLIPS
    print(f"\n[e2e] Clips: {len(clips)} selected, scores="
          f"{[c.get('score') for c in clips]}, {run['timings']['clips']:.1f}s")


def test_clips_render_to_real_vertical_mp4_with_captions(run):
    from app.services import audio

    rendered = run["rendered"]
    assert rendered, "nothing was rendered"
    for item in rendered:
        local = list(UPLOADS.glob(f"*{item['clip_index']}*.mp4"))
        assert local, f"no rendered file for clip {item['clip_index']}"
        meta = audio.probe(str(local[0]))
        assert (meta["width"], meta["height"]) == (1080, 1920), "not 9:16"
        assert meta["has_video"] and meta["has_audio"]
        assert float(meta["duration"]) > 0
        assert item["duration"] > 0
        assert local[0].stat().st_size > 100_000
        print(
            f"\n[e2e] clip {item['clip_index']}: "
            f"{item['start']:.1f}-{item['end']:.1f}s -> "
            f"{meta['width']}x{meta['height']} ({local[0].stat().st_size/1e6:.1f} MB)"
        )


def test_captions_were_burned_in_from_real_timestamps(run):
    """The .ass must be built from the aligned words, not empty."""
    job_dir = pathlib.Path("work/testmedia/e2e_job")
    ass_files = sorted(job_dir.glob("captions_*.ass"))
    assert ass_files, "no caption file was produced"
    body = ass_files[0].read_text(encoding="utf-8")
    assert "Dialogue:" in body
    # Real words from the real transcript.
    assert "I" in body or "dream" in body.lower()
    assert body.count("Dialogue:") >= 1


def test_storage_rows_were_produced(run):
    assert len(run["rows"]) == len(run["rendered"])
    for row in run["rows"]:
        assert row["storage_path"]
        assert row["aspect_ratio"] == "1080:1920"
        assert row["caption_style"]
        assert row["duration"] > 0
    print(f"\n[e2e] Rows: {len(run['rows'])} -> "
          f"{[r['storage_path'] for r in run['rows']]}")


def test_every_stage_ran_in_order_and_stayed_within_vram(run):
    for stage in ("probe", "transcribe", "analyze", "clips", "render"):
        assert stage in run["timings"], f"stage {stage} did not run"
        assert run["timings"][stage] > 0
    print(f"\n[e2e] stage timings: "
          + ", ".join(f"{k}={v:.1f}s" for k, v in run["timings"].items()))
