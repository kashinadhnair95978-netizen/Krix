# AI Pipeline Status

**Date:** 2026-09-27 · **Machine:** RTX 4060 Laptop GPU (8188 MiB, driver 610.62, compute 8.9)

> **The detailed, current report is [`CORE_PIPELINE_COMPLETION.md`](./CORE_PIPELINE_COMPLETION.md).**
> It contains the full evidence: every real test run, measured timings, the 14
> real bugs that were found and fixed, and exactly what is still blocked.
> This file is a short summary. If the two ever disagree, the completion report
> is the source of truth.

**Scope:** honest, real verification. No mock or fabricated output was used to
make anything pass.

## Labels

- `PASS` — executed for real on this machine; output verified.
- `PARTIAL` — real implementation, proven on part of its input range.
- `BLOCKED` — cannot be completed here; the missing prerequisite is named.
- `NOT VERIFIED` — implemented and inspected, but no real execution was possible.

## Scorecard

| Component | Status | Evidence |
| --- | --- | --- |
| Core pipeline (all 6 stages) | **PASS** | 9/9 real tests, 188.97 s, produced 2 × 1080×1920 captioned clips |
| ASR (Qwen3-ASR-1.7B) | **PASS** | Real CUDA inference; 60 min audio transcribed in 217.2 s |
| Forced aligner (Qwen3-ForcedAligner-0.6B) | **PASS** | 4,704 real ordered word timings across 13 chunks |
| Qwen3-VL (4B, 8-bit) | **PASS** | Real 8-bit load + frame descriptions |
| Mistral (7B, 4-bit NF4) | **PASS** | Real 4-bit load, 2 validated clips |
| FFmpeg | **PASS** | 5/5 real tests; probe, extract, frames, 9:16 render |
| Long video (1/10/30/60 min) | **PASS** | 5/5 real tests; 16.6× realtime at 60 min |
| GPU queue | **PASS** | 191 tests; API stays responsive while a job holds the GPU |
| Supabase | **NOT VERIFIED** | `SUPABASE MIGRATION NOT VERIFIED` — see below |
| Auto repurpose | **BLOCKED** | Needs migration + worker callback env |
| End-to-end (browser) | **BLOCKED** | Needs `AI_WORKER_URL` / `AI_WORKER_API_KEY` in `.env.local` |

## Environment

Python 3.14.3 · PyTorch 2.14.0+cu126 · Transformers 5.17.0 · bitsandbytes 0.50.2 ·
torchvision 0.29.0+cu126 · accelerate 1.15.0 · librosa 1.0.0 · soundfile 0.14.0 ·
FFmpeg 9.0 full build with libass.

All four models are downloaded and genuinely self-hosted. `work/download.log`
ends with `[download] ALL COMPLETE`.

| Stage | Model | Quantization | Fits 8 GB |
| --- | --- | --- | --- |
| Transcribe | `Qwen/Qwen3-ASR-1.7B-hf` | bf16 | yes |
| Word timing | `Qwen/Qwen3-ForcedAligner-0.6B-hf` | bf16 | yes |
| Visual analysis | `Qwen/Qwen3-VL-4B-Instruct` | 8-bit BnB | yes |
| Clip selection | `mistralai/Mistral-7B-Instruct-v0.3` | 4-bit NF4 BnB | yes |

Only one model is resident at a time; `ModelManager` unloads and clears the CUDA
cache between stages.

## Test totals

- Unit + API: **204 passed, 28 skipped** (52.71 s)
- Real GPU/media suites, all opt-in via `RUN_REAL_*` and all green:
  ASR + aligner 8 · Qwen3-VL + Mistral 7 · long video 5 · FFmpeg 5 · full pipeline 9
- `compileall app` clean · `npx tsc --noEmit` exit 0 · `npm run lint` clean
- `ai-worker/tests/test_migration_sql.py`: 13/13 static SQL checks pass

## SUPABASE MIGRATION NOT VERIFIED

`src/components/supabase/ai_pipeline.sql` is written and passes all static
checks, but **has not been run against the live project.** A read-only probe
shows `videos.processing_stage`, `videos.transcript_segments`, `clip_candidates`,
`generated_clips`, `video_analysis_jobs` and the `generated_clips` bucket are all
still missing.

This host has no `psql`, no Supabase CLI and no database management URL or
access token; the service-role key can read and write rows through PostgREST but
cannot execute DDL.

**To fix:** run the file in Supabase → SQL Editor (safe to re-run; it is
idempotent), then confirm with `node ai-worker/scripts/check-supabase.mjs`.

## Blocked, and what unblocks each

1. **Auto repurpose** — needs the migration (for the unique index
   `idx_repurposed_content_video_type`), `INTERNAL_SERVICE_KEY` and
   `KRIX_APP_URL` in `ai-worker/.env`, and a cloud AI provider key in the
   Next.js app.
2. **Browser end-to-end** — needs `AI_WORKER_URL` and `AI_WORKER_API_KEY` in the
   root `.env.local`, matching `AI_WORKER_API_KEY` in `ai-worker/.env`.

Nothing else is blocked. No further model downloads, VRAM, or new AI capability
are required.
