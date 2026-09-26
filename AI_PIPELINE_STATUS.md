# AI Pipeline Status Report

**Date:** 2026-09-22 · **Machine:** RTX 4060 Laptop GPU (8 GB VRAM, driver 610.62, compute 8.9)
**Scope:** honest, real verification of the current Krix AI video pipeline — no mock/fake outputs were used to pass anything.

Every component below is classified:

- [WORKING] — executed for real on this machine and produced real output.
- [PARTIALLY WORKING] — real implementation exists and is wired, but could not be fully executed here (large download aborted / best-effort fallback).
- [BLOCKED - REQUIRES USER ACTION] — cannot work until the user does something specific.
- [NOT IMPLEMENTED] — intentionally not built (excluded whole modules/features).

---

## 1. Environment & dependencies

| Item | Status | Evidence |
| --- | --- | --- |
| Python 3.14.3 (also 3.13.0 present, no 3.12 needed) | [WORKING] | `py -0p`; full pipeline runs on 3.14 |
| PyTorch **2.14.0+cu126** (CUDA 12.6 build) | [WORKING] | `torch.cuda.is_available()==True`, `torch.version.cuda=='12.6'` |
| NVIDIA driver + GPU | [WORKING] | `nvidia-smi` → RTX 4060 Laptop, 8188 MiB, ~7938 MiB free |
| bitsandbytes **0.50.2** | [WORKING] | `bnb.nn.Linear8bitLt` real CUDA matmul executed on the 4060 |
| transformers 5.17.0, accelerate 1.15.0 | [WORKING] | both import; 5.17 is what the ASR run exercised |
| librosa 1.0.0 / soundfile 0.14.0 (added this session) | [WORKING] | required by transformers 5.17 loader + forced aligner |
| FFmpeg 9.0 full build (libass) + ffprobe, on PATH | [WORKING] | real extraction / frame sampling / 9:16 render all ran |
| fastapi / uvicorn / pydantic / httpx / supabase | [WORKING] | service boots, TestClient calls /health `/status` `/pipeline` |
| venv at `ai-worker/.venv` (gitignored) | [WORKING] | `pip install -r requirements.txt` clean |

## 2. Models configured for the pipeline (in `ai-worker/.env` + `config.py`)

| Stage | Model (real, on Hugging Face) | Size | Quant. | What was verified |
| --- | --- | --- | --- | --- |
| Transcribe | `Qwen/Qwen3-ASR-1.7B-hf` | 4.1 GB (2.04B BF16) | bf16 | **REAL inference on the RTX 4060 — [WORKING]** |
| Word timing (best-effort) | `Qwen/Qwen3-ForcedAligner-0.6B-hf` | 1.2 GB (0.6B) | bf16 | download interrupted at 74 MB — [PARTIALLY WORKING] |
| Visual analysis | `Qwen/Qwen3-VL-4B-Instruct` | 8.9 GB (4.44B BF16) | **8-bit** BnB | real code + real arch; model never downloaded (aborted) — [PARTIALLY WORKING] |
| Clip selection | `mistralai/Mistral-7B-Instruct-v0.3` | 14.5 GB (7.25B BF16, 3 shards) | **4-bit NF4** BnB | real code + real arch; model never downloaded (aborted) — [PARTIALLY WORKING] |

**All four are genuinely open, self-hosted models.** No placeholder, mock, OpenRouter, or fake implementation was found in `ai-worker/app/`. (The Next.js `/api/repurpose` cloud-AI providers are a separate feature area, untouched by this test.)

## 3. VTREAM fit on the RTX 4060 8 GB (with the configured quantizations)

| Model | bf16 resident | Quantized resident | Fits 8 GB? |
| --- | --- | --- | --- |
| Qwen3-ASR-1.7B | ~4.1 GB + activations | — | YES (verified) |
| Qwen3-ForcedAligner-0.6B | ~1.3 GB | — | YES (not executed) |
| Qwen3-VL-4B | ~8.9 GB | **~4.6 GB (8-bit)** | YES with 8-bit; NO in fp16 |
| Mistral-7B | ~14.5 GB | **~4.0 GB (4-bit NF4 + double-quant)** | YES with 4-bit; NO in 8-bit/fp16 |

Rule enforced by design: **only one model is resident at a time** (`ModelManager` unloads + `torch.cuda.empty_cache()` between stages). Quantization configs (`VISION_QUANTIZATION=8bit`, `MISTRAL_QUANTIZATION=4bit`) are already the defaults — no model change was made.

## 4. Real test executed on this machine (no mocks)

Test video: `ai-worker/work/testmedia/test_video.mp4` — 39.9 s, 1280×720@24, H.264+AAC, built from **real MLK speech FLAC samples** + 6 real text slides.

| Stage | Result |
| --- | --- |
| ffprobe metadata | [WORKING] duration 39.911 / 1280×720 / 24 fps / has_audio+video |
| Audio extraction → 16 kHz WAV | [WORKING] 1.28 MB real ffmpeg output |
| Frame sampling | [WORKING] 4 frames at 0/10/20/30 s |
| **Qwen3-ASR transcription (CUDA)** | [WORKING] model load 21.7 s, transcribe ~5 s; language=English; text begins *"I have a dream that one day this nation will rise up and live out the true meaning of its creed…"* (matches the real MLK recording) |
| ASS / SRT captions build | [WORKING] real `Dialogue:` events + style block |
| **9:16 render with burned captions** | [WORKING] `clip_result_1.mp4` 1080×1920@30, 17 s h264; caption burn verified by pixel-diff (mean 3.9 in caption band vs identical bare render) |
| validate_and_rank | [WORKING] correctly enforces MIN_CLIP_DURATION=20 s (dropped the shorter stand-in candidates) |
| FastAPI service | [WORKING] `/health` 200 (cuda_available true), `/status` 200 (ASR model listed), `POST /pipeline` with valid key **200**, wrong key **401** |
| Full test suite | [WORKING] **78 passed** (72 unit + 5 real-FFmpeg integration + 1 real GPU-ASR integration) |

## 5. Supabase integration & migration

- Supabase client (service-role) **connects**; storage bucket `videos` exists. **[WORKING]**
- **Migration NOT applied.** Verified against the live project (`kdxtfypsog…`):
  - `videos.processing_stage` → PostgREST error `42703 … does not exist`
  - `clip_candidates`, `generated_clips`, `video_analysis_jobs` → `404` (tables missing)
  - `generated_clips` storage bucket → **missing**
- Because of that, every persistence step of the pipeline (`update_job`, `insert_generated_clip`, `finalize_video`) and the Next.js `/api/clips` are **[BLOCKED - REQUIRES USER ACTION]** below.

## 6. Classification summary

### [WORKING]
- Python 3.14 venv + PyTorch cu126 + CUDA + bitsandbytes + transformers 5.17 stack on the 4060
- ffprobe, audio extraction, frame sampling
- **Qwen3-ASR-1.7B real transcription (CUDA)**
- Caption building (ASS/SRT)
- **FFmpeg 9:16 clip render with caption burn-in**
- Clip candidate validation/dedupe/min-duration rules
- FastAPI service, bearer auth (401 for bad token), health/status/pipeline endpoints
- Structured error contract (tested incl. FORBIDDEN/NOT_FOUND ownership paths)
- 78 tests, including the new real-operation integration tests

### [PARTIALLY WORKING]
- **Forced alignment (word timestamps):** real code + fallback works (flat segments when off), but the aligner model download was interrupted (74 MB of 1.2 GB) so automatic timing was not executed.
- **Qwen3-VL visual analysis:** real 8-bit implementation and matching architecture confirmed; model never downloaded (8.9 GB, aborted) → stage not executed.
- **Mistral clip-candidate generation/ranking:** real 4-bit implementation confirmed; model never downloaded (14.5 GB, aborted) → stage not executed.
- **Supabase client connectivity** (works) but pipeline persistence stages remain blocked below.

### [BLOCKED - REQUIRES USER ACTION]
1. **Apply the DB migration** — open Supabase → SQL Editor on project `kdxtfypsogmlqobnamuf` and run the contents of `src/components/supabase/ai_pipeline.sql`. This creates the three tables, the two `videos` columns, RLS, indexes, and the `generated_clips` bucket/policies. *I cannot run it for you: I have only the REST URL + service-role key, which cannot execute DDL.* (Alternatively: give me a Supabase access token / CLI+DB password and I’ll do it.)
2. **Download the two remaining models** (large, slow on this connection; attempted once and aborted) so the analyze + clip-ranking stages can be executed:
   - `Qwen/Qwen3-VL-4B-Instruct` (~8.9 GB) → supports `/analyze-video` and the `analyzing` stage
   - `mistralai/Mistral-7B-Instruct-v0.3` (~14.5 GB, excluding the duplicated `consolidated.safetensors`) → supports `/find-clips` and the `finding_clips` stage
   - Run: `.venv\Scripts\python.exe -m pip install --quiet`; then
     `.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-VL-4B-Instruct'); snapshot_download('mistralai/Mistral-7B-Instruct-v0.3', ignore_patterns=['consolidated.safetensors'])"`
     on a faster connection, or tell me to re-attempt.
3. **(Optional, for word-level timestamps)** finish `Qwen/Qwen3-ForcedAligner-0.6B-hf` (~1.2 GB) the same way.
4. For a full web→worker round-trip: set `AI_WORKER_URL` + `AI_WORKER_API_KEY` in the root `.env.local` (matching `ai-worker/.env`) and run `npm run dev` — the worker will be called over HTTP on port 8741.

### [NOT IMPLEMENTED]
- None in the current pipeline. (Future Opus-Clip-like features — smart reframing, B-roll, caption templates — were explicitly out of scope and not added.)

## 7. Fixes made during verification (real bugs found & fixed, not mock workarounds)

1. `librosa` added to `requirements.txt` and installed — transformers 5.17’s audio loader hard-requires it (this would have crashed every real ASR run).
2. `soundfile` added to `requirements.txt` — required by the forced aligner’s WAV decode.
3. `torch_dtype=` → `dtype=` in `asr.py`, `vision.py`, `mistral.py` — transformers 5.17 deprecation (was emitting a runtime warning).
4. `load_dotenv()` added to `app/config.py` (located next to the file) — **the worker previously ignored `ai-worker/.env` completely**, so a normal `uvicorn app.main:app` start had empty `SUPABASE_URL` / bearer key / model overrides. Reproduced a 500 → fixed → verified 401/200 behavior.

## 8. Honest bottom line

- **Transcription, local media handling, rendering, captions, validation, service/auth, and 78 tests genuinely work on this machine.**
- The pipeline is **NOT yet complete end-to-end.** Completing it requires the two large model downloads and the Supabase migration (items in §6 BLOCKED). Until then `analyzing`, `finding_clips`, and every Supabase write (clip_candidates → generated_clips → dashboard) cannot be exercised.