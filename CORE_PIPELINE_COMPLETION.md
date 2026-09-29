# Krix Core AI Video Pipeline — Completion & Verification Report

**Date:** 2026-09-27
**Host:** RTX 4060 Laptop GPU (8188 MiB, driver 610.62, compute capability 8.9)
**Runtime:** Python 3.14.3 · PyTorch 2.14.0+cu126 · Transformers 5.17.0 · bitsandbytes 0.50.2 · torchvision 0.29.0+cu126 · FFmpeg 9.0 (full build, libass)

**Scope:** real execution only. Every number below came from a real run on this
machine. No mock, stub or fabricated output was used to make anything pass. The
only thing that is *not* proven end-to-end is stated as blocked, with the reason.

## Classification key

| Label | Meaning |
| --- | --- |
| `PASS` | Executed for real on this machine; output verified. |
| `PARTIAL` | Real implementation, proven on part of its input range, with a named limit. |
| `BLOCKED` | Cannot be completed here. Names the exact missing prerequisite. |
| `NOT VERIFIED` | Implemented and inspected, but no real execution was possible. |

---

## 1. Scorecard

| Component | Status | Real evidence |
| --- | --- | --- |
| **CORE PIPELINE** (all 6 stages, in order) | **PASS** | 9/9 real tests, 188.97 s, produced 2 × 1080×1920 clips from a real 60 s video |
| **ASR** (Qwen3-ASR-1.7B) | **PASS** | Real CUDA inference, 8-test suite green; 60 min audio in 217.2 s |
| **FORCED ALIGNER** (Qwen3-ForcedAligner-0.6B) | **PASS** | Real word timings: 4704 ordered words across 13 chunks on 60 min audio |
| **QWEN3-VL** (4B, 8-bit) | **PASS** | Real 8-bit load + frame descriptions, 7-test suite, 69.8 s for 4 frames |
| **MISTRAL** (7B, 4-bit NF4) | **PASS** | Real 4-bit load, validated clips, 41.3 s including a corrective retry |
| **FFMPEG** (probe/extract/frames/render) | **PASS** | 5/5 real tests, 38.92 s; 9:16 render verified by ffprobe + burned captions |
| **LONG VIDEO** (1/10/30/60 min) | **PASS** | 5/5 real tests, 509.98 s combined run; real chunking, stitching, offsets |
| **GPU QUEUE** (single-resident serialization) | **PASS** | 191-test suite; API proven to stay responsive while a job holds the GPU |
| **SUPABASE** | **NOT VERIFIED** | **`SUPABASE MIGRATION NOT VERIFIED`** — see §5 |
| **AUTO REPURPOSE** | **BLOCKED** | Needs migration + worker callback env — see §6 |
| **END-TO-END** (browser → dashboard) | **BLOCKED** | Needs `AI_WORKER_URL`/`AI_WORKER_API_KEY` in root `.env.local` — see §6 |

---

## 2. What actually ran

### 2.1 Test suites

| Suite | Command | Result |
| --- | --- | --- |
| Unit + API (no models) | `pytest -p no:warnings` | **204 passed, 28 skipped**, 52.71 s |
| Real ASR + aligner | `RUN_REAL_ASR=1 pytest tests/integration/test_real_asr_gpu.py` | **8 passed** |
| Real Qwen3-VL + Mistral | `RUN_REAL_VL=1 pytest tests/integration/test_real_vl_mistral_gpu.py` | **7 passed**, 161.25 s |
| Real long video | `RUN_REAL_LONG=1 pytest tests/integration/test_real_long_video_gpu.py` | **5 passed** |
| Real FFmpeg | `pytest tests/integration/test_real_ffmpeg.py` | **5 passed**, 38.92 s |
| **Real full pipeline** | `RUN_REAL_E2E=1 pytest tests/integration/test_real_e2e_gpu.py` | **9 passed**, 188.97 s |

Skipped tests are the opt-in GPU/real-media suites above; each is run explicitly
with its `RUN_REAL_*` flag, and every one of them is green.

### 2.2 Full pipeline run, stage by stage

Real 60 s video (`work/testmedia/short_60s.mp4`, 1280×720, H.264 + AAC, real
speech audio). Every stage below is real model or real ffmpeg work:

| Stage | Time | Result |
| --- | --- | --- |
| `ffprobe` | 3.6 s | 60.0 s, 25 fps, has_video + has_audio |
| audio → 16 kHz WAV | (in stage) | real `speech.wav` decoded |
| **Qwen3-ASR + ForcedAligner** | 37.2 s | 626 chars, **116 real aligned words**, 1 chunk |
| **Qwen3-VL-4B (8-bit)** | 69.8 s | 4 real frame observations |
| **Mistral-7B (4-bit NF4)** | 41.3 s | 2 validated clips (scores 90, 88) |
| **FFmpeg 9:16 render + caption burn-in** | 27.9 s | 2 clips, 1080×1920, 5.0 MB each |
| **Total** | **188.97 s** | ≈3.1 min wall clock for a 60 s video |

Rendered output, probed back with `ffprobe`:

```
clip 1: 0.0–20.0s  -> 1080x1920 (5.0 MB)
clip 2: 36.0–56.0s -> 1080x1920 (5.0 MB)
captions_0.ass: 56 readable cues built from the 116 aligned words
```

The only substituted component in this run is the **Supabase write path**, which
was redirected to a local directory. That is deliberate and is the reason
SUPABASE is `NOT VERIFIED` rather than `PASS`.

### 2.3 Long-video matrix (real inference, real chunking)

Real FFmpeg-generated media with real speech audio, transcribed on the GPU with
chunking, per-chunk word-offset rebasing and overlap de-duplication:

| Length | Chunks | Transcript chars | Aligned words | Time | Speed |
| --- | --- | --- | --- | --- | --- |
| 1 min | 1 | 626 | 116 | 33.8 s | 1.8× realtime |
| 10 min | 3 | 4,437 | 797 | 54.0 s | 11.1× |
| 30 min | 7 | 13,071 | 2,335 | 123.8 s | 14.5× |
| 60 min | 13 | 21,933 | 4,704 | 217.2 s | **16.6×** |

A 60-minute video transcribes in 3.6 minutes on an 8 GB laptop GPU. Word counts
scale linearly with audio length, which is the signal that nothing is being
silently truncated.

### 2.4 VRAM

Both large models were loaded with the configured quantizations and ran real
inference inside the 8 GB budget (asserted in the real suite: allocated VRAM
stays under 7 GB for 8-bit Qwen3-VL and 4-bit Mistral). `ModelManager` enforces
one resident model at a time, unloading and clearing the CUDA cache between
stages.

---

## 3. Real bugs found and fixed

These were found by running the real thing, not by reading code. Each is now
covered by a regression test.

1. **Clip selection returned zero clips on a real 60 s video.** The Mistral
   prompt stated a 20–90 s range but nothing tied that to the actual video
   length, so the model answered with a 4.7 s clip (and, after one attempt,
   three clips of 4.7/10/10 s). Server-side validation correctly rejected all of
   them, so the pipeline produced nothing. Fixed by making the prompt
   duration-aware (`at most min(90, duration)` seconds, explicit hard
   constraints, an unmissable "never return an empty list") **and** adding one
   bounded corrective retry that re-asks the model with the specific violations
   spelled out. The retry can only return model-proposed timestamps that pass
   the same validation — no timestamp is ever widened or invented server-side.
   Real result after the fix: 2 valid 20 s clips from 2 model calls.
   `clip_detection.py`, covered by 8 new unit tests.
2. **Captions were an unreadable wall of text.** ASR segments are far too coarse:
   a single 4.65 s "segment" carried the entire transcript, producing one ASS
   `Dialogue` event with the whole video's text. Word timings existed but were
   only a fallback. Fixed by adding `captions.words_to_cues()`, which groups
   aligned words into short cues, breaking on sentence punctuation, pauses
   > 0.6 s, 6 words, 32 characters or 4 s of screen time. `_write_captions` now
   prefers word timings and only falls back to segments when no aligned word
   overlaps the clip. Real result: 1 wall of text → 56 readable cues.
3. **Long audio was silently truncated.** A single generation call cannot cover
   a 60-minute video. Fixed with 300 s chunks, per-chunk token budgets, 2 s
   overlap de-duplication and per-chunk word-offset rebasing.
4. **`strip_overlap` dropped only the final overlapping token**, gluing words
   together at every chunk boundary. Fixed, with a hyphen-aware join so words
   split across a boundary are rejoined without a space.
5. **Forced alignment never ran on real audio.** Transformers 5.17 rejects a
   `(samples, sample_rate)` tuple with
   `ValueError: Invalid input type. Must be a single audio or a list of audio`.
   Fixed by writing each window to a temporary WAV and passing the path.
6. **`KeyError: '"clips"'`** — `SYSTEM_PROMPT` contains a literal JSON example, so
   `str.format` tried to substitute it. Fixed by escaping the braces.
7. **Qwen3-VL could not load at all** until `torchvision` was installed; the
   processor needs it for pixel tensors. Fixed and now recorded in
   `requirements.txt` so a fresh install does not hit it.
8. **Supabase timestamps were written as the string `"now()"`.** PostgREST
   cannot call `now()`; it stores or rejects the literal. Fixed to send a real
   ISO-8601 UTC instant.
9. **The migration would have failed on a clean database.** The
   `video_analysis_jobs` updated-at trigger was created before the table it
   attaches to, so the file aborted with
   `relation "video_analysis_jobs" does not exist`. Fixed by moving the trigger
   after the `CREATE TABLE`.
10. **The stage vocabulary did not match across three places.** The worker writes
    `finding_clips`; the SQL CHECK constraint allowed `detecting`; the TypeScript
    union allowed `detecting`. Once the constraint was live, *every* job would
    have failed its database write the moment it reached clip selection. All
    three now share one list, and a checker enforces it (§4).
11. **`/jobs/{id}` reported `status: "ok"` even for failed jobs**, hiding failures
    from any client that reads the top-level field. The job status is now
    mirrored at the top level.
12. **`/api/repurpose` overwrote user-edited content.** The route documented that
    `is_edited` rows are protected unless `force` is set, but the upsert was
    unconditional. Fixed: edited rows are excluded from the upsert and reported
    in `preserved_edited`; `force` resets the flag so a regenerated row is
    honestly marked as machine-written.
13. **Queue capacity was racy.** `max_pending` counted only *waiting* jobs, so a
    burst could overshoot the backlog limit. It now counts running + waiting.
14. **A failed chunk killed the whole video.** Added per-chunk recovery with
    halved windows, an alignment fallback, flat segments, and a `warnings` field
    on the result so a degraded transcript is visible rather than silent.

---

## 4. Guards added so these cannot regress

| Guard | What it protects |
| --- | --- |
| `ai-worker/tests/test_migration_sql.py` | 13 static checks on the migration, run by the default suite: balanced `$$` bodies, every statement starts with a SQL keyword, **no trigger is created before its table exists**, required tables/bucket/policies/`videos` columns present, `updated_at` triggers, the repurpose unique index, no literal `"now()"` written by the worker, and SQL ⇄ TypeScript ⇄ worker stage vocabularies all identical. One test asserts the ordering rule *itself* is not toothless, by feeding it the original broken ordering. |
| `tests/test_clip_validation.py` | 25 tests: bounds, dedupe, ordering, prompt clamping, and the bounded retry (exactly one extra call, never a loop). |
| `tests/test_captions.py` | 23 tests including word grouping, punctuation/pause breaks, max-chars and max-duration. |
| `tests/test_api_pipeline.py` | 11 tests: `/pipeline` returns in <0.4 s, `/health` and `/status` answer in <0.3 s **while a job holds the GPU**, structured failure contract, worker survives an unhandled exception, HTTP 429 when the queue is full. |
| `tests/test_job_queue.py` | Single-GPU serialization, FIFO, concurrency, leases, capacity, status. |
| `.env.example` | Documents the chunking, queue, callback and word-grouping knobs that were added. |

Static checks: `compileall app` clean · `npx tsc --noEmit` exit 0 ·
`npm run lint` clean (`✔ No ESLint warnings or errors`).

---

## 5. Supabase — `SUPABASE MIGRATION NOT VERIFIED`

The migration in `src/components/supabase/ai_pipeline.sql` has been rewritten as
an idempotent file and passes all 13 static checks, but **it has not been
executed against the live project.**

A read-only probe of the live project returned:

| Object | Live state |
| --- | --- |
| `videos` table | exists, but **`processing_stage` missing** (`42703`) |
| `videos` table | **`transcript_segments` missing** |
| `clip_candidates` | **missing** (404) |
| `generated_clips` | **missing** (404) |
| `video_analysis_jobs` | **missing** (404) |
| `videos` bucket | exists |
| `generated_clips` bucket | **missing** |

**Why it was not applied:** this host has no `psql`, no Supabase CLI, and no
database management URL or access token. The service-role key can read and write
rows through PostgREST but cannot execute DDL, so applying the migration needs
someone with SQL access.

**To apply it:** open Supabase → SQL Editor for the project and run the contents
of `src/components/supabase/ai_pipeline.sql`. It is safe to run more than once
(every object is created `IF NOT EXISTS` or dropped-then-recreated). Afterwards,
run `node ai-worker/scripts/check-supabase.mjs` to confirm the objects exist.

**Consequence:** the worker's persistence layer (`create_job`, `update_job`,
`insert_clip_candidates`, `insert_generated_clip`, `finalize_video`) and the
`/api/repurpose` upsert are implemented and type-checked but cannot run against
the live database yet. The full pipeline run in §2.2 therefore redirected those
writes to a local directory.

---

## 6. What remains blocked, and exactly what unblocks it

### `AUTO REPURPOSE` — BLOCKED

The worker callback is implemented and unit-tested (auth header, per-video
locking, non-fatal failures, idempotency). It cannot run live because:

1. The repurpose upsert needs the unique index `idx_repurposed_content_video_type`, which the unapplied migration creates.
2. The worker needs `INTERNAL_SERVICE_KEY` and `KRIX_APP_URL` set in `ai-worker/.env`, matching `INTERNAL_SERVICE_KEY` in the root env.
3. The Next.js route needs a cloud AI provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, or `AI_API_KEY` + `AI_BASE_URL`).

The clip-detection half of repurposing (Mistral) is `PASS` and is unrelated to
these three items.

### `END-TO-END` (browser → dashboard) — BLOCKED

Root `.env.local` has no `AI_WORKER_URL` or `AI_WORKER_API_KEY`, so the browser
path has never been exercised. To complete it:

```bash
# ai-worker/.env
AI_WORKER_AUTH=true
AI_WORKER_API_KEY=<generate with: openssl rand -hex 32>
INTERNAL_SERVICE_KEY=<same value as the root env>
KRIX_APP_URL=http://127.0.0.1:3000

# .env.local
AI_WORKER_URL=http://127.0.0.1:8741
AI_WORKER_API_KEY=<same value as the worker's>
INTERNAL_SERVICE_KEY=<same value as the worker's>
```

Then `npm run dev` and `uvicorn app.main:app --port 8741` from `ai-worker/`.

---

## 7. Honest bottom line

The AI video pipeline itself is **proven working on real hardware**: a real
video goes in and real 1080×1920 captioned clips come out, using four real
self-hosted models on an 8 GB laptop GPU, in 188.97 s for a 60-second input and
transcribing a 60-minute video in 217 s.

What is **not** proven is everything that touches the live database and the
browser. Those are blocked on two things only — applying
`src/components/supabase/ai_pipeline.sql`, and setting the worker URL/key env
vars. Nothing in the remaining work requires new AI capability, more VRAM, or
larger downloads.
