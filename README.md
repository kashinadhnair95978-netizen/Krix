# Krix

> Turn one long video into a content campaign: 9:16 clips with burned-in captions, plus tweets, a blog draft, an email sequence, and LinkedIn posts — all derived from the actual audio and frames of the video.

**Krix is not production-ready.** The video pipeline below is real and tested. The repurposed **text** output is implemented but currently blocked on provider credit, and the marketing site advertises capabilities that do not exist yet. See [Verdict](#verdict) for the honest position and [`FRONTEND_FEATURE_AUDIT.md`](FRONTEND_FEATURE_AUDIT.md) for the full 177-feature breakdown.

Krix is a Next.js web app plus a **self-hosted GPU video worker**. You upload a video (or paste a YouTube URL), the worker transcribes it, aligns every word to a timestamp, looks at sampled frames, scores candidate clips, renders the best ones to 9:16 MP4 with ASS captions, uploads them, and — when the LLM provider has credit — writes the repurposed text back to the database. The dashboard shows the clips.

---

## Contents

1. [Current status](#-current-status)
2. [What Krix does today](#-what-krix-does-today)
3. [Architecture](#-architecture)
4. [The AI pipeline](#-the-ai-pipeline)
5. [Data flow](#-data-flow)
6. [Setup](#-setup)
7. [Environment variables](#-environment-variables)
8. [Database](#-database)
9. [API reference](#-api-reference)
10. [Security](#-security)
11. [Testing](#-testing)
12. [Known limitations](#-known-limitations)
13. [Repository layout](#-repository-layout)
14. [Roadmap](#-roadmap)
15. [Long-term AI direction](#-long-term-ai-direction)
16. [Development workflow](#-development-workflow)
17. [Further reading](#further-reading)

---

## 📊 Current status

Statuses are assigned from the code and from test runs recorded in this repository — not from the presence of a button or a page.

| Tag | Meaning |
| --- | --- |
| 🟢 **WORKING** | Implemented **and** verified end-to-end by a real test in this repo. |
| 🟡 **PARTIAL** | Real implementation, but a required piece could not be executed here. |
| 🟠 **SCAFFOLDED** | UI/route/schema exists; the real functionality is not implemented or is hardcoded data. |
| 🔴 **BROKEN** | Exists and currently fails, **or** presents invented data as if it were real. |
| ⚪ **PLANNED** | Not built. Roadmap context only. |
| ⛔ **BLOCKED** | Code is correct, but an external dependency stops it from running. Not a code defect. |

### Verdict

> **Krix is NOT production-ready.** Overall **4 / 10**.
>
> Of 177 audited features, only **47 work** (27%). **75 of 177 — 42% — are mocked or missing**, concentrated in the marketing site, payments, and the developer platform. There is **no way to pay**, no real analytics, no projects, no calendar, no team, no API, and no MCP. One payment route lets a signed-in user grant themselves a paid plan without paying.
>
> The core upload-to-clip pipeline **is** real, tested, and would survive technical diligence (9 / 10). The problem is everything around it, and the gap between what the site advertises and what it does.
>
> Full detail: [`FRONTEND_FEATURE_AUDIT.md`](FRONTEND_FEATURE_AUDIT.md) · [`KRIX_FEATURE_IMPLEMENTATION_PLAN.md`](KRIX_FEATURE_IMPLEMENTATION_PLAN.md) · [`KRIX_PRODUCTION_READINESS_REPORT.md`](KRIX_PRODUCTION_READINESS_REPORT.md)

### Product areas

| Area | Status | Evidence |
| --- | --- | --- |
| Marketing site (`/`, `/pricing`) | 🔴 | Pages return 200, but the surface is the least honest part of the product: it advertises ~30 capabilities, ~6 exist. 6 testimonials, 10 brand logos, 10 statistics and 5 platform performance tables are fabricated. Only 6 of 44 audited marketing items work (14%) |
| Pricing page | 🔴 | Display only. All 4 tier CTAs go to `/auth/signup`; nothing is purchasable |
| Email/password signup + login | 🟢 | Real Supabase Auth; Playwright `login smoke` passes |
| Google OAuth | 🔴 | See [limitation 4](#4-google-oauth-is-almost-certainly-broken) |
| Middleware route protection | 🟡 | 9 prefixes guarded in `src/middleware.ts:7`, but the matcher omits `/api/analytics`, `/api/content` and `/api/payments`. Those three self-guard today, so nothing is exposed — it is a defence-in-depth gap, not a live hole |
| Local video upload | 🟢 | 10.84 MB MP4 end-to-end in a real browser (TEST 1) |
| YouTube URL ingestion | 🟡 | Route works; downloads blocked on this machine (limitation 2) |
| Repeated-URL deduplication | 🟢 | 4 posts → 1 row, same `videoId`, 729–770 ms (TEST 4) |
| Upload size limit | 🟢 | Live limit is 50 MiB, not 2 GB (limitation 1) |
| Transcription (Qwen3-ASR) | 🟢 | Real audio → text + word timings |
| Word alignment (ForcedAligner) | 🟢 | 4,704 aligned words on 60-minute audio |
| Visual analysis (Qwen3-VL) | 🟡 | Real frames → structured observations, but only the **first ~120 s** of a long video is ever seen (limitation 7) |
| Clip scoring (Mistral 7B) | 🟢 | 6 sub-scores + composite, validated |
| Clip rendering (FFmpeg) | 🟢 | 2 × 1080×1920 MP4 produced from real video |
| Captions (ASS, burned in) | 🟢 | Rendered into the video via the `subtitles` filter. The `.ass` itself is a temp artifact that is deleted, so caption text cannot be retrieved later (limitation 21) |
| Dashboard library / video detail | 🟢 | Real Supabase data, live pipeline progress |
| Content edit / delete | 🔴 | `PUT` and `DELETE /api/content/[id]` return **HTTP 500** for every row — the ownership check throws before it completes (limitation 14) |
| Auto content repurposing | ⛔ | Code is correct and reachable; blocked by OpenRouter credit, not by a defect (limitation 3) |
| Analytics | 🔴 | 5 real counters buried under ~12 fabricated series, plus a "Viral score 8.4" tile. Errors render as invented data (limitation 12) |
| Settings (profile, subscription, AI provider status) | 🟡 | Profile update and `GET /api/ai/config` are real; subscription cancellation hits the API but no plan can exist |

> **P0 remediation is in progress.** The audit rows above describe the state at
> commit `5711f9d` and are kept as written. Several of them — Google OAuth,
> pricing checkout, content edit/delete, middleware coverage, and the missing CI —
> have since been fixed or hardened, and now carry a 20-test regression suite.
> Current status, the evidence behind it, and the four remaining external
> configuration steps are in
> [`KRIX_P0_IMPLEMENTATION_REPORT.md`](KRIX_P0_IMPLEMENTATION_REPORT.md).
| Payments (Stripe / Razorpay) | 🔴 | **CRITICAL:** a signed-in user can self-activate their own paid plan without paying. Price IDs are also `price_xxxxx` placeholders, so checkout cannot complete either (limitation 8, 25) |
| API page (`/dashboard/api`) | 🔴 | **Fabricates an API key in the browser** (`'kx_live_' + 'x'.repeat(32)`) and documents six `/v1/*` endpoints that do not exist |
| Team | 🟠 | Four hardcoded members, no table, no API, no seats |
| Projects | 🟠 | Four hardcoded project names |
| Calendar / scheduling | 🟠 | Static mock calendar, "Schedule a post" writes nothing |
| Inspiration | 🟠 | Static idea cards |
| Legal pages (privacy, terms, security) | ⚪ | Not built. 17 footer links point at pages that do not exist (limitation 27) |
| Social publishing | ⚪ | Not built. Marketing copy implies it. |
| Smart Reframe / subject tracking | ⚪ | Not built. Rendering is a fixed center crop. The signals a tracker needs are already computed and discarded. |
| B-roll insertion | ⚪ | Not built |
| AI editor | ⚪ | Not built |
| Brand templates | ⚪ | Not built |
| MCP server | ⚪ | Not built (landing page mentions it) |
| Enterprise / fine-tuning | ⚪ | Not built |
| Social publishing to APIs | ⚪ | Not built |

### What Krix does **not** do

- It does **not** post anything to YouTube, TikTok, Instagram, X, or LinkedIn. There is no publishing integration.
- It does **not** schedule anything. The calendar is a mockup.
- It does **not** track real views, watch rate, or platform reach. Only your own video and post counts are real.
- It does **not** reframe a subject. Clips are center-cropped to 9:16.
- It does **not** charge anyone. Price IDs are placeholders, **and** one route would let a user mark their own subscription paid without paying (limitation 25).
- It does **not** accept 2 GB uploads. The storage bucket allows 50 MiB.
- It does **not** let you edit or delete a repurposed content item. Both routes return 500.

---

## ✅ What Krix does today

Verified working, in the order the user experiences it:

1. **Sign in** with email + password (Supabase Auth), or sign up and land in the dashboard.
2. **Upload a video** (MP4/MOV/WebM, ≤ 50 MiB) or **paste a YouTube URL**. Both create a `videos` row and hand off to the GPU worker.
3. **The worker transcribes** the audio with Qwen3-ASR, chunked at 300 s with 2 s overlap, then aligns every word with Qwen3-ForcedAligner.
4. **It looks at the video** with Qwen3-VL on 12 sampled frames (one per 10 s), producing structured observations: speaker count, speaker position, scene type, visual interest.
5. **Mistral scores candidate clips** on 6 dimensions (hook, story, information, emotion, visual, context independence) and returns strict JSON.
6. **The server validates** every candidate: duration bounds, 0.5 s end tolerance, 1 s overlap rejection, 20–90 s length, Pydantic score bounds. It re-asks Mistral **once** if everything is invalid — it never widens or invents a range itself.
7. **FFmpeg renders** the top 3 clips to 1080×1920 h264/aac MP4, center-cropped, with ASS captions burned in, plus a JPEG thumbnail.
8. **Clips upload** to the private `generated_clips` bucket and rows land in `generated_clips` with `status = 'ready'`.
9. **The dashboard** shows the clips with signed, expiring URLs, live pipeline stage, and the repurposed text.
10. **Auto-repurpose** writes 5 content types (`tweets`, `blog`, `emails`, `linkedin`, `shorts`) via a pluggable LLM provider. Implemented and reachable, currently blocked by provider credit.

## ⚪ What Krix is planned to be

Nothing below is implemented. It is listed so the intended product is not confused with the current one.

- Smart Reframe with subject tracking instead of a fixed center crop
- B-roll insertion from a stock/AI library
- Real social publishing and scheduling with platform OAuth
- Real analytics sourced from platform APIs
- A public REST API and MCP server
- Team workspaces, seats, and permissions
- Custom model training ("Krix ClipRank", "Krix ContentWriter")
- Thumbnails, brand templates, and caption style variants
- A timeline editor

---

## 🏗️ Architecture

Two processes and one managed backend.

```
┌──────────────────────────────────────────────────────────────┐
│  Browser  (user session cookie)                              │
└───────────────┬──────────────────────────────────────────────┘
                │  HTTPS
┌───────────────▼──────────────────────────────────────────────┐
│  Next.js 14 (App Router, Node)                               │
│  • Supabase SSR auth + middleware route guard                │
│  • Route Handlers (/api/*) — service-role client             │
│  • Local upload + yt-dlp YouTube ingestion (server-side)     │
│  • RSC + client components for the marketing site & dashboard│
└──────┬────────────────────────────────────┬──────────────────┘
       │ PostgREST / Storage API            │ Bearer token (server-to-server only)
       │ (service role)                     │ AI_WORKER_API_KEY
┌──────▼─────────────────────────┐  ┌───────▼──────────────────────────┐
│  Supabase                      │  │  FastAPI worker (uvicorn)         │
│  • Auth                        │  │  • GPU job queue (1 dispatcher)   │
│  • Postgres + RLS              │◄─┤  • ModelManager (1 model resident)│
│  • Storage (private buckets)   │  │  • FFmpeg / ffprobe subprocesses  │
└──────┬─────────────────────────┘  └───────┬──────────────────────────┘
       │ service role                          │ service role
       └──────────────────────────────────────┘
                Worker → app callback:
                POST /api/repurpose  with x-service-key
```

**The browser never talks to the worker directly.** `src/lib/worker.ts` holds the base URL and bearer token; only server-side route handlers call it. `/api/pipeline/process` and `/api/process-video` additionally require `x-service-key: INTERNAL_SERVICE_KEY`.

### Why the worker is separate

Four models cannot stay resident on an 8 GB laptop GPU. The worker is a separate process that owns the GPU, loads one model at a time, and writes results straight to Supabase. The Next.js app stays CPU-only and horizontally scalable.

### Model memory management

`ai-worker/app/models/manager.py` is a single-slot cache. Loading a second model evicts the first:

```
asr          → resident during transcription (cached across chunks)
asr_aligner  → load evicts asr
vision       → load evicts asr_aligner
mistral      → load evicts vision
unload()     → in the pipeline's finally block
```

Eviction moves the model to CPU, drops the reference, then `gc.collect()` + `torch.cuda.empty_cache()` + `torch.cuda.synchronize()`. Quantization exists to fit the budget at all, not as an optimization:

| Model | Default quantization | Why |
| --- | --- | --- |
| Qwen3-ASR-1.7B | bfloat16 | Small enough to run unquantized |
| Qwen3-ForcedAligner-0.6B | bfloat16 | Smallest model in the stack |
| Qwen3-VL-4B-Instruct | 8-bit BitsAndBytes | 4B in fp16 does not fit alongside weights |
| Mistral-7B-Instruct-v0.3 | 4-bit NF4 + double quant | 7B in fp16 will OOM an 8 GB card |

`ASR_ENABLE_TIMESTAMPS=false` skips the aligner entirely, which removes one load/unload cycle per job at the cost of losing word-level timings.

---

## 🤖 The AI pipeline

`POST /pipeline` enqueues a job and returns immediately. The dispatcher thread runs six stages, in this order, updating `videos.processing_stage` as it goes.

### 1. Download and probe

`storage.download_video()` pulls the source from the private `videos` bucket — **after** verifying the row's `user_id` matches the requesting user. Caller-supplied paths are never trusted. `ffprobe` then returns the duration.

### 2. Transcription and alignment

- **Model:** `Qwen/Qwen3-ASR-1.7B-hf` via `AutoModelForMultimodalLM`, `bfloat16`, greedy (`do_sample=False`).
- **Chunking:** `plan_chunks()` splits audio into 300 s windows with a 298 s stride (2 s overlap). A 60-minute video → 13 chunks. A failed chunk is retried as two halves, once.
- **Stitching:** `merge_chunk_texts()` finds the longest shared token run between the tail of one chunk and the head of the next and removes the duplicate, so overlap does not duplicate words.
- **Token budget:** `min(ASR_MAX_NEW_TOKENS, duration × ASR_TOKENS_PER_SECOND)`. At defaults a 300 s chunk asks for 2,400 tokens, so the 4,096 ceiling is a safety net rather than a truncator. Long audio is chunked, not cut.
- **Alignment:** `Qwen/Qwen3-ForcedAligner-0.6B-hf` via `AutoModelForTokenClassification`. Transcript sentences are grouped to ≤ 240 s of audio using character-proportion weighting — the text is known to belong to exactly that audio, which is more reliable than a global words-per-second guess.
- **Alignment failure is non-fatal:** the warning `forced alignment unavailable, using flat segments` is recorded, the aligner is unloaded, and one flat segment spanning the video is used. `aligner_used: false` tells the UI that timings are approximate.
- **Words** are made monotonic (sorted, non-overlapping, each ≥ 40 ms) and duplicates from the overlap are removed with a 50 ms tolerance.
- **Segments** merge consecutive words while the gap is < 0.35 s.

### 3. Visual analysis

- **Model:** `Qwen/Qwen3-VL-4B-Instruct`, 8-bit by default.
- **Frames:** `FRAME_SAMPLE_INTERVAL=10.0` s, `MAX_VISION_FRAMES=12`, one ffmpeg subprocess per frame, `-ss` before `-i` for fast seek, scaled to max width 720, `-q:v 2`.
- **Per frame:** the image is passed as a raw PIL object in the chat message. The model is asked for JSON: `observation`, `speaker_count`, `speaker_position` (`center|left|right|upper|lower|none`), `scene_type` (`podcast|tutorial|vlog|interview|screen_content|broll|monologue|other`), `visual_interest` (0–1). A parse failure is retried once.
- **Known weakness:** frames are sampled greedily from the start, so a 1-hour video only analyses its first 120 seconds. All 12 slots are consumed at defaults.

### 4. Clip selection and scoring

Mistral receives the timestamped transcript and the visual observations and must return:

```json
{"clips":[{"start":0.0,"end":45.0,"score":82.0,
           "hook_score":80.0,"story_score":85.0,"information_score":78.0,
           "emotion_score":70.0,"visual_score":88.0,
           "context_independence":75.0,"reason":"..."}]}
```

Every score is Pydantic-bounded 0–100. Mistral-7B is not reliable at this without help, so the output passes through three defenses:

1. **`_iter_json_candidates()`** — `json.JSONDecoder().raw_decode` on the raw text first (stops at the first complete value, so trailing commentary no longer produces `Extra data`), then a fenced-block retry, then a retry at every `{`/`[` offset. A top-level array is wrapped as `{"clips": [...]}`.
2. **A repair re-ask** — one extra call with an explicit "reply with the JSON object only" suffix. A second failure raises `LLM_INVALID_JSON`.
3. **`validate_and_rank()`** — pure, unit-tested rejection of: `end <= start`, `end > duration + 0.5`, span < 20 s, span > 90 s, score < `MIN_SCORE`, and anything malformed. Selection is greedy by score up to `MAX_CLIPS` with 1 s overlap rejection; the returned list is then **sorted chronologically**. If everything is rejected, Mistral is asked **once** more with the specific violations named. Nothing is widened server-side.

### 5. Captions and rendering

- **Captions:** word-timed cues, breaking on 6 words, 32 characters (`CAPTION_MAX_CHARS`), 4.0 s, a 0.6 s pause, or sentence-final punctuation. Written as ASS with a `Krix` style — Arial 72, white, black outline width 3, bottom-centre, margin 120 — and **burned into the video**. The `.ass` file is a temporary artifact and is not uploaded.
- **Render command** (`rendering.py`):

  ```
  ffmpeg -y -hide_banner -loglevel error
    -ss {start} -i {video} -t {duration}
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[,subtitles='…ass']"
    -r 30 -c:v libx264 -preset veryfast -crf 23
    -c:a aac -b:a 128k -shortest -movflags +faststart
    {output}.mp4
  ```

  1080×1920, 30 fps, CRF 23, AAC 128 kbps, `+faststart`. **`crop` has no `x`/`y`, so it is a center crop** — this is the "no Smart Reframe" limitation. Missing or zero-byte output raises `RENDER_FAILED` instead of escaping as a raw 500.
- **Thumbnail:** one ffmpeg frame at the clip midpoint, scaled to width 480.

### 6. Storage and callback

Clips and thumbnails upload to the private `generated_clips` bucket under `{user_id}/clips/`, and `generated_clips` rows are written with `status = 'ready'`. Then, if `REPURPOSE_ON_COMPLETE` is on, the worker POSTs to `{KRIX_APP_URL}/api/repurpose` with the internal service key. **The callback never raises** — a repurposing failure must not turn a successfully rendered video into a failed one. Its result is embedded in the pipeline response as `repurpose: {triggered, reason, …}`.

### Failure handling

Every error is a `PipelineError` with an `error_code` that maps to an HTTP status. Messages pass through a 4-pass sanitizer that redacts JWTs, key-shaped strings, bearer tokens, and `*_KEY=…` / `*_SECRET=…` / `*_TOKEN=…` / `*_PASSWORD=…` assignments before they can reach a log or a response.

| Stage | Code | HTTP |
| --- | --- | --- |
| request | `BAD_REQUEST` | 400 |
| request | `FORBIDDEN` | 401 |
| storage | `NOT_FOUND` | 403 ⚠️ see limitation 15 |
| pipeline | `BUSY` | 429 |
| any | `UNSUPPORTED_FILE`, `MODEL_MISSING`, `CUDA_UNAVAILABLE`, `MODEL_OUT_OF_MEMORY`, `CORRUPT_MEDIA`, `TRANSCRIPTION_FAILED`, `VISION_FAILED`, `LLM_INVALID_JSON`, `CLIP_VALIDATION_FAILED`, `RENDER_FAILED`, `STORAGE_UPLOAD_FAILED`, `WRITE_FAILED`, `PIPELINE_INTERNAL` | 500 |

The job's `finally` block unloads the model, frees the CUDA cache, and deletes the scratch directory unless `AI_WORKER_KEEP_ARTIFACTS=true`. Bookkeeping writes (`update_job`, `finalize_video`) are best-effort and warn rather than fail the job.

### Backpressure

`GPU_QUEUE_MAX_PENDING=16` counts the running job **plus** the backlog, guarded by an explicit counter so the capacity check cannot race the dispatcher. Overflow raises `BUSY` → HTTP 429. A separate GPU lease with a 3,600 s timeout serialises the debug endpoints against the pipeline thread.

---

## 🔄 Data flow

**Local upload**
```
User picks a file
  → GET  /api/upload          (returns the live limit so the UI can fail fast)
  → POST /api/upload          (validates type + size, streams to the private bucket,
                               creates the videos row, triggers the worker)
  → 201 {videoId, pipelineTriggered:true}
  → GET  /api/videos/[id]     (polls: status + processing_stage)
  → GET  /api/clips?videoId=  (signed, expiring clip + thumbnail URLs)
  → GET  /api/content         (repurposed text, by type)
```

**YouTube URL**
```
User pastes a URL
  → POST /api/ingest-url  {url}
      canonicalise → YouTube-only validation → non-blocking single-flight lock
      → duplicate check (active | completed | recent failure | stale)
      → reserve a row BEFORE downloading  ← the fix for the old repeat-import bug
      → yt-dlp with a 240 s wall-clock budget
      → same storage + pipeline path as upload
  → 200 {deduplicated:true, videoId} | 202 {videoId} | 504 {DOWNLOAD_TIMEOUT}
```

**Worker → dashboard**
```
POST /pipeline (Bearer)
  → 200 {status:"started", job_id, queue_position}
  → dispatch: transcribe → analyze → find_clips → render → store
  → repurpose_callback POST /api/repurpose (x-service-key)
  → dashboard polls the DB; it never polls the worker
```

**The duplicate-import bug this design fixes:** the old code checked only *active* statuses and created the `videos` row *after* the download, so submitting a URL already in the library re-downloaded it — four such rows existed in the live database. Now the row is reserved first, the canonical URL is the dedupe key, and a repeat returns the existing `videoId` in ~0.7 s.

---

## 🛠️ Setup

### Requirements

| | |
| --- | --- |
| Node.js | 18.17+ (Next.js 14 requirement) |
| Python | 3.11–3.12 (the worker venv on this machine is 3.12) |
| GPU | NVIDIA with CUDA. **An 8 GB card is the design target** (RTX 4060 Laptop). |
| FFmpeg | On `PATH`, **built with libass** (required for caption burn-in) + `ffprobe` |
| yt-dlp | On `PATH` for YouTube ingestion, or set `YTDLP_PATH` |
| Supabase | One project, with the two SQL files applied |

FFmpeg with libass is the one easy-to-miss dependency: without it caption rendering fails at the `subtitles` filter.

### Web application

```bash
npm install
cp .env.example .env.local        # then fill it in
npm run dev                       # http://localhost:3000
npm run lint                      # next lint
npx tsc --noEmit                  # typecheck (no npm script exists)
npm run build && npm run start    # production
```

### AI worker

```bash
cd ai-worker
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt   # Windows
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8741
```

Then check it:

```bash
curl http://127.0.0.1:8741/health
# {"status":"ok","cuda_available":true,"model_loaded":null,"pipeline":true,
#  "queue":{"worker_running":true,"pending":0,"outstanding":0,"gpu_busy":false,"max_pending":16}}
```

The first run downloads the model weights — roughly 4 GB (ASR), 1.2 GB (aligner), 8.9 GB (VL), 14.5 GB (Mistral) as recorded in `ai-worker/work/download.log`. Budget the disk and the time. Set `HF_HOME` **in your shell** to control the cache directory; the worker reads it from `config.py` but does not export it to `os.environ` itself.

### Supabase

Apply these two files in the Supabase **SQL Editor**, in order:

1. `src/components/supabase/schema.sql` — users, subscriptions, videos, repurposed_content, payments, usage_logs, api_keys, and the `videos` bucket. Not idempotent; run once.
2. `src/components/supabase/ai_pipeline.sql` — `clip_candidates`, `generated_clips`, `video_analysis_jobs`, the `generated_clips` bucket, the `videos.processing_stage` CHECK, the `set_updated_at` trigger, the RLS policies, and the unique index `/api/repurpose` needs. Idempotent; safe to re-run.

Then confirm the live schema:

```bash
node ai-worker/scripts/check-supabase.mjs
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and can **read and write every user's rows**. It belongs only in the worker and in server-side route handlers — never in a `NEXT_PUBLIC_` variable, and never in a component.

### Models

| Role | Hugging Face id | Default quantization |
| --- | --- | --- |
| ASR | `Qwen/Qwen3-ASR-1.7B-hf` | bfloat16 |
| Forced aligner | `Qwen/Qwen3-ForcedAligner-0.6B-hf` | bfloat16 |
| Video understanding | `Qwen/Qwen3-VL-4B-Instruct` | 8-bit |
| Clip reasoning | `mistralai/Mistral-7B-Instruct-v0.3` | 4-bit NF4 |
| Repurposing text | remote LLM (OpenRouter by default) | n/a |

All four local ids are overridable (`ASR_MODEL`, `ASR_ALIGNER_MODEL`, `VISION_MODEL`, `MISTRAL_MODEL`).

---

## 🔑 Environment variables

Only the variables that matter are listed. `NEXT_PUBLIC_` variables are exposed to the browser — **never put a secret in one**. Values shown are defaults or placeholders; no real key appears in this repository's tracked files.

### Next.js (`.env.local`)

| Variable | Required | Used by | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | browser | anon/bearer key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | API routes | bypasses RLS — server only |
| `INTERNAL_SERVICE_KEY` | ✅ for s2s | middleware, `/api/pipeline/process`, `/api/process-video`, `/api/repurpose` | `x-service-key` value |
| `AI_WORKER_URL` | for the GPU path | `lib/worker.ts` | e.g. `http://127.0.0.1:8741`. Blank ⇒ Whisper fallback |
| `AI_WORKER_API_KEY` | for the GPU path | `lib/worker.ts` | worker `Authorization: Bearer` |
| `NEXT_PUBLIC_APP_URL` | recommended | `api-client.ts`, `next.config.mjs` | browser-facing base URL |
| `KRIX_APP_URL` | recommended | server→server calls | base URL for the worker's callback |
| `OPENROUTER_API_KEY` | for repurposing | `lib/ai-provider.ts` | the working provider in this repo |
| `OPENROUTER_MODEL` | optional | `lib/ai-provider.ts` | default `anthropic/claude-sonnet-4`, validated against the live catalog |
| `AI_PROVIDER` | optional | `lib/ai-provider.ts` | `auto` \| `anthropic` \| `openai` \| `gemini` \| `openrouter` \| `custom` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | optional | `lib/ai-provider.ts` | Claude path |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | optional | `lib/ai-provider.ts`, `lib/transcribe.ts` | GPT path + legacy Whisper transcription |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | optional | `lib/ai-provider.ts` | Gemini path |
| `AI_API_KEY` + `AI_BASE_URL` + `AI_MODEL` | optional | `lib/ai-provider.ts` | any OpenAI-compatible endpoint; `AI_BASE_URL` outranks auto-detect |
| `UPLOAD_MAX_BYTES` | optional | `lib/ingest.ts` | app ceiling, default 2 GiB |
| `STORAGE_MAX_BYTES` | optional | `lib/ingest.ts` | fallback when the bucket reports no `file_size_limit`, default 50 MiB |
| `YTDLP_PATH` | optional | `lib/ytdlp.ts` | yt-dlp executable |
| `FFPROBE_PATH` | optional | `lib/ytdlp.ts` | ffprobe executable |
| `YTDLP_COOKIES_FILE` | optional | `lib/ytdlp.ts` | Netscape `cookies.txt` for age/bot-gated videos |
| `YTDLP_COOKIES_FROM_BROWSER` | optional | `lib/ytdlp.ts` | e.g. `chrome` |
| `INGEST_MAX_BYTES` | optional | ingest route | download size cap, default 50 MiB |
| `INGEST_MAX_DURATION_SECONDS` | optional | ingest route | source duration cap, default 5400 (90 min) |
| `INGEST_TIMEOUT_SECONDS` | optional | `lib/ytdlp.ts` | per-attempt yt-dlp timeout, default 900 |
| `INGEST_REQUEST_BUDGET_SECONDS` | optional | ingest route | whole-request wall clock, default 240, clamped under `maxDuration = 300` |
| `INGEST_RETRY_COOLDOWN_SECONDS` | optional | `lib/ingest-dedupe.ts` | failed-import cooldown, default 600 |
| `INGEST_LOCK_TTL_SECONDS` | optional | `lib/ingest-dedupe.ts` | single-flight lock TTL, default 1200 |
| `INGEST_STALE_SECONDS` | optional | `lib/ingest-dedupe.ts` | dead-job retirement, default 1800 |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | for billing | `lib/stripe.ts`, `/api/payments/*` | placeholders today |
| `RAZORPAY_KEY_ID` / `NEXT_PUBLIC_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | for billing | `lib/razorpay.ts`, `/api/payments/*` | placeholders today |
| `MAXMIND_ACCOUNT_ID` / `MAXMIND_LICENSE_KEY` | optional | `lib/geoip.ts` | provider routing by country |

### Worker (`ai-worker/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_WORKER_API_KEY` | `""` | required bearer token; the literal `changeme` is rejected |
| `AI_WORKER_AUTH` | `true` | set `false` only for local dev without auth |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `""` | required |
| `SUPABASE_VIDEOS_BUCKET` / `SUPABASE_CLIPS_BUCKET` | `videos` / `generated_clips` | bucket names |
| `ASR_MODEL`, `ASR_ALIGNER_MODEL`, `VISION_MODEL`, `MISTRAL_MODEL` | the ids above | model overrides |
| `ASR_DEVICE`, `VISION_DEVICE`, `MISTRAL_DEVICE` | `cuda` | `cuda` or `cpu`; requesting `cuda` without CUDA raises `CUDA_UNAVAILABLE` |
| `ASR_CHUNK_SECONDS`, `ASR_CHUNK_OVERLAP_SECONDS`, `ASR_TOKENS_PER_SECOND`, `ASR_MAX_NEW_TOKENS` | `300.0`, `2.0`, `8.0`, `4096` | transcription chunking |
| `ASR_ENABLE_TIMESTAMPS`, `ASR_ALIGN_CHUNK_SECONDS` | `true`, `240.0` | forced alignment |
| `VISION_QUANTIZATION`, `VISION_MAX_NEW_TOKENS` | `8bit`, `256` | visual analysis |
| `MISTRAL_QUANTIZATION`, `MISTRAL_MAX_NEW_TOKENS`, `MISTRAL_MAX_INPUT_TOKENS` | `4bit`, `900`, `16384` | clip reasoning |
| `MAX_CLIPS`, `MIN_CLIP_DURATION`, `MAX_CLIP_DURATION`, `MIN_SCORE` | `3`, `20.0`, `90.0`, `0.0` | clip selection bounds |
| `FRAME_SAMPLE_INTERVAL`, `MAX_VISION_FRAMES`, `VISION_START_OFFSET` | `10.0`, `12`, `0.0` | frame sampling |
| `RENDER_WIDTH`, `RENDER_HEIGHT`, `RENDER_FPS`, `RENDER_CRF`, `RENDER_AUDIO_BITRATE` | `1080`, `1920`, `30`, `23`, `128k` | rendering |
| `CAPTION_FONT_SIZE`, `CAPTION_FONT_COLOR`, `CAPTION_OUTLINE_COLOR`, `CAPTION_OUTLINE_WIDTH`, `CAPTION_MARGIN_BOTTOM`, `CAPTION_MAX_CHARS`, `CAPTION_STYLE_NAME` | `72`, `&HFFFFFF`, `&H000000`, `3`, `120`, `32`, `Krix` | captions |
| `GPU_QUEUE_MAX_PENDING`, `GPU_QUEUE_STATUS_LIMIT`, `GPU_LEASE_TIMEOUT` | `16`, `25`, `3600.0` | queue limits |
| `KRIX_APP_URL`, `INTERNAL_SERVICE_KEY`, `REPURPOSE_ON_COMPLETE`, `REPURPOSE_TIMEOUT` | `http://localhost:3000`, `""`, `true`, `300.0` | repurpose callback |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | binaries |
| `AI_WORKER_WORK_DIR`, `AI_WORKER_KEEP_ARTIFACTS` | `ai-worker/work`, `false` | scratch space |
| `HF_HOME`, `HF_TOKEN` | `""`, `""` | cache dir (export in your shell) and gated repos |

`APP_BASE_URL` and `SUPABASE_TIMEOUT` appear in `ai-worker/.env.example` but **are not read** by `config.py`; `MIN_SCORE` is read but missing from that example.

### Test-only

`KRIX_E2E_EMAIL`, `KRIX_E2E_PASSWORD`, `KRIX_E2E_VIDEO`, `KRIX_E2E_YOUTUBE`, `KRIX_E2E_YOUTUBE_FRESH`, and the `RUN_REAL_ASR` / `RUN_REAL_VL` / `RUN_REAL_E2E` / `RUN_REAL_LONG` GPU gates. The E2E password has a hardcoded default for a throwaway account; do not reuse it anywhere real.

---

## 🗄️ Database

Ten tables, two private buckets, RLS on everything.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | app profile mirror of `auth.users` | `id` = `auth.users.id`, `full_name`, `avatar_url` |
| `videos` | **core** — one row per source video | `original_url` (canonical, dedupe key), `storage_path`, `duration_seconds`, `transcript`, `transcript_segments` (JSONB: language + segments + words), `status` (`processing`\|`completed`\|`failed`), `processing_stage` (CHECK: 12 values), `error_message` |
| `video_analysis_jobs` | one row per pipeline run, polled by the dashboard | `job_id` (UNIQUE), `status`, `stage`, `error_code`, `error_message` |
| `clip_candidates` | every model proposal, kept even when not selected | `start_time`, `end_time`, `score`, `hook_score`, `story_score`, `information_score`, `emotion_score`, `visual_score`, `context_independence`, `reason`; CHECK `end_time > start_time` |
| `generated_clips` | rendered output | `candidate_id` → `clip_candidates`, `storage_path`, `thumb_path`, `duration`, `aspect_ratio`, `caption_style`, `status = 'ready'` |
| `repurposed_content` | generated text per video | `content_type` (UNIQUE with `video_id`), `content_text`, `is_edited`, `edited_by_user_at`, `posted_to_platform`, `posted_at` |
| `subscriptions` | billing state | `recurring_id` (UNIQUE with `user_id`), `status`, `current_period_start/end`, `cancel_at_period_end` |
| `payments` | payment attempts | `subscription_id`, `amount`, `currency`, `payment_method`, `external_payment_id`, `status`, `invoice_url` |
| `usage_logs` | per-user per-month metered usage | UNIQUE (`user_id`, `month`) |
| `api_keys` | hashed user keys | `key_hash`, `is_active` |

**Relationships:** `videos.user_id → users.id` (CASCADE); `clip_candidates`, `generated_clips`, `video_analysis_jobs`, `repurposed_content` all reference `videos.id` (CASCADE); `generated_clips.candidate_id → clip_candidates.id` (SET NULL).

**Enums:** none. Every status column is `VARCHAR(50)`; only `videos.processing_stage` has a CHECK constraint. `video_analysis_jobs.stage` has no constraint, so the stage vocabulary can drift from `videos` (limitation 16).

**`updated_at`** is maintained by the `set_updated_at` DB trigger on `videos` and `video_analysis_jobs` only. `generated_clips` and `repurposed_content` have no such column or trigger.

**Buckets:** `videos` and `generated_clips`, both **private**, both requiring the first path segment to equal `auth.uid()`. Neither SQL file sets `file_size_limit`, so both inherit the plan default — that is where the 50 MiB cap comes from.

**RLS:** 29 policies. `videos` and `users` are self-scoped (`auth.uid() = user_id`). `repurposed_content`, `clip_candidates`, `generated_clips`, and `video_analysis_jobs` scope through a `videos` subquery. `payments`, `usage_logs`, and `api_keys` have RLS enabled with **zero policies**, so they are service-role only. There is no `storage.objects` UPDATE policy and no `video_analysis_jobs` DELETE policy.

Full DDL: `src/components/supabase/schema.sql`, `src/components/supabase/ai_pipeline.sql`.

---

## 🔌 API reference

### App routes

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| `GET` | `/api/upload` | session | 🟢 live limit: `maxBytes`, `bucket`, `maxMegabytes`, plus `appMaxBytes` / `storageMaxBytes` |
| `POST` | `/api/upload` | session | 🟢 multipart; type + size validated; streams to storage, creates the row, triggers the worker. `201` started, `202` stored-but-not-started, `400` malformed, `415` bad type, `413` `MEDIA_TOO_LARGE` |
| `GET` | `/api/ingest-url` | session | 🟢 `providers: ["youtube"]`, effective size/duration/timeout limits, and the `duplicatePolicy` block (in-flight / completed / failed-cooldown / stale / `force`) |
| `POST` | `/api/ingest-url` | session | 🟡 YouTube-only ingest with dedupe; `200` deduplicated, `202` started, `400` `YOUTUBE_INVALID_URL`, `504` `DOWNLOAD_TIMEOUT` |
| `GET` | `/api/videos` | session | 🟢 the user's videos |
| `DELETE` | `/api/videos` | session | 🟢 bulk delete |
| `GET` | `/api/videos/[videoId]` | session | 🟢 one video with `status` + `processing_stage` |
| `DELETE` | `/api/videos/[videoId]` | session | 🟢 delete one video |
| `GET` | `/api/clips?videoId=` | session | 🟢 ownership-checked, signed expiring clip + thumb URLs |
| `POST` | `/api/pipeline/process` | `x-service-key` | 🟢 `202` enqueues on the worker; `200` if already processed; `502` if the worker is unreachable |
| `POST` | `/api/process-video` | `x-service-key` | 🟡 legacy in-app Whisper path, kept as the fallback when `AI_WORKER_URL` is blank |
| `POST` | `/api/repurpose` | session **or** `x-service-key` | 🟡 writes 5 content types; `503 AI_PROVIDER_NOT_CONFIGURED` when the provider is unusable |
| `POST` | `/api/content` | session | 🟡 generate + upsert repurposed content; implemented but **no client calls it** — the UI uses `/api/repurpose` instead |
| `GET` | `/api/content/[id]` | session | 🟢 read one video's content |
| `PUT` | `/api/content/[id]` | session | 🔴 **returns `500` for every row** — the ownership check throws before it completes; see limitation 14 |
| `DELETE` | `/api/content/[id]` | session | 🔴 **returns `500` for every row** — same cause; see limitation 14 |
| `GET` | `/api/ai/config` | session | 🟢 provider, model, and whether the model was verified against the live catalog |
| `GET` | `/api/analytics` | session | 🔴 5 real counters (`totalVideos` / `completedVideos` / `totalClips` / `totalContent` / 14-day `posts`); every series the page draws on top of them is hardcoded, and a failed fetch renders as invented data instead of an error (limitation 12) |
| `POST` | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/upsert-profile` | public / session | 🟢 Supabase Auth wrappers. **Unmetered** — no rate limit, so credential stuffing and mass signup are possible (limitation 26) |
| `GET`/`POST`/`PUT` | `/api/subscription`, `/api/subscription/payment-method` | session | 🟠 reads and cancels subscription rows; no active plan can exist without real price IDs. Payment-method writes trust a client-supplied `pm_…`/`last4` (limitation 28) |
| `POST` | `/api/payments/create`, `/api/payments/stripe`, `/api/payments/razorpay` | session | 🔴 `price_xxxxx` / `plan_xxxxx` placeholders, so both providers fail before any charge (limitation 8) |
| `POST` | `/api/payments/verify` | session | 🔴 **CRITICAL — a signed-in user can self-activate their own paid plan without paying.** See limitation 25 |
| `GET` | `/api/payments/provider` | public | 🟠 geo-routing; needs MaxMind credentials |
| `POST` | `/api/payments/webhook` | signature | 🟡 Both providers **are** signature-verified (`stripe.webhooks.constructEvent`, and Razorpay HMAC-SHA256; each returns `400` on mismatch). But a body carrying **neither** signature header skips both blocks and still returns `{received: true}` → `200`. No real provider event has ever been delivered here |

There is **no** `GET /api/content` and **no** `PATCH /api/content/[id]` — `/api/content` is POST-only, and `/api/content/[id]` exports GET, PUT, DELETE.

### Worker endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | none | liveness + CUDA + queue snapshot (hidden from the schema) |
| `GET` | `/status` | none | full config dump + model ids + quantization + queue |
| `GET` | `/jobs`, `GET /jobs/{id}` | none | recent jobs; large result fields are stripped |
| `POST` | `/pipeline` | Bearer | enqueue the full pipeline, returns immediately |
| `POST` | `/transcribe` | Bearer | debug: ASR on a local audio path (threadpool + GPU lease) |
| `POST` | `/analyze-video` | Bearer | debug: VL on a local video |
| `POST` | `/find-clips` | Bearer | debug: Mistral clip proposals |
| `POST` | `/render-clip` | Bearer | debug: render one clip |

`/health`, `/status`, and `/jobs` are unauthenticated because the worker binds `127.0.0.1`. Do not expose it on a public interface. If `AI_WORKER_API_KEY` is empty or literally `changeme`, the protected endpoints **fail closed with a 500** rather than accepting the request.

---

## 🔒 Security

**What is real**

- Supabase Auth with SSR cookie handling; `src/middleware.ts` guards `/dashboard` and 8 `/api` prefixes, returning `401` for API paths and redirecting for pages.
- RLS on all 10 tables, self-scoped or subquery-scoped; 2 private buckets with first-path-segment ownership checks.
- The browser never holds the worker URL, the worker bearer token, or the service-role key.
- `/api/pipeline/process` and `/api/process-video` require `x-service-key`.
- The worker verifies `videos.user_id` against the requesting user before downloading anything — caller-supplied paths are never trusted.
- Every API route re-checks the session; `getUserId()` reads only the server-side cookie.
- YouTube URLs are validated and canonicalised before yt-dlp is invoked, and yt-dlp runs without a shell.
- The worker sanitizes error messages and structured extras, redacting JWTs, key-shaped strings, bearer tokens, and `*_KEY`/`*_SECRET`/`*_TOKEN`/`*_PASSWORD` assignments.
- Stripe webhook signature verification via `stripe.webhooks.constructEvent`; Razorpay via HMAC-SHA256 comparison. Both return `400` on mismatch.
- Input validation on upload (MIME + extension + size), on repurpose (`videoId`, ownership), and on payments (plan key must exist in the plan map).
- `.env*` is git-ignored except `.env.example`, including path-anchored `ai-worker/**/work-*` patterns.
- Secret redaction in `ai-worker/app/errors.py:30-56` is shape-based, not name-based: it strips JWTs, provider key shapes (`sk`/`pk`/`rk`/`sb`/`sb_secret`/`hf`/`api`/`key`/`token`/`secret` + separator + 8+ chars), `Authorization` headers, and `key=value` pairs while keeping the surrounding diagnostic value. Covered by 21 error-mapping tests.
- `getUserId()` reads **only** the server-side cookie session. It does not honour the service key and does not honour a client-supplied `x-user-id`, so a service-key request to a user-scoped route still gets a 401.
- The repurpose callback sends only a `videoId`, so the worker cannot fabricate content.
- Worker auth **fails closed** on an empty or literally `changeme` `AI_WORKER_API_KEY`.
- `.env.example` is genuinely thorough — every provider and every limit is documented.

### 🔴 Blocking security findings

Ordered by risk. Findings 1–3 must be fixed before any public launch.

1. **CRITICAL — a signed-in user can self-activate their own paid plan without paying.** `POST /api/payments/verify` checks the Razorpay HMAC **only** when `provider === 'razorpay'` (`verify/route.ts:17`). Any other value — `'stripe'`, or simply omitting the field — skips verification entirely and still runs `update({ status: 'active' })` (`:32-41`). The route *is* authenticated and *is* scoped with `.eq('user_id', userId)`, so it cannot grant a plan to **another** account — but no payment is required for your **own**. Secondary: the HMAC is computed over `${razorpayPaymentId}|${subscriptionId}`, which does not match Razorpay's documented `order_id`+`payment_id` scheme, so genuine payments likely fail to verify too; the comparison uses `!==`, not a constant-time compare. **Fix:** fulfil subscriptions only from a signature-verified provider webhook, and delete the client-callable verify route.
2. **HIGH — payment methods are client-trusted.** A session alone authorises writing a `pm_…` string and a `last4` that the **client supplied** (`payments/payment-method/route.ts:16`). Derive `last4` and ownership from the provider instead.
3. **HIGH — no rate limiting anywhere on auth.** Login and signup are unauthenticated and unmetered, so credential stuffing, mass account creation and free-tier quota farming are all possible. There is no CAPTCHA and no per-IP or per-email limit.
4. **MEDIUM — `INTERNAL_SERVICE_KEY` has no placeholder guard on the Next.js side.** The worker rejects `changeme`, but `isValidServiceKey` (`auth-utils.ts:10-18`) only checks `if (!secret) return false`, and `middleware.ts:24-28` returns early on a match — **skipping every later middleware check**. Both compare with `===` rather than a constant-time compare. `.env.example` ships `INTERNAL_SERVICE_KEY=changeme`, so a deployment that copies it unchanged accepts a publicly known key on every protected path. **This is the asymmetry to be aware of:** the worker fails closed, the app does not.
5. **MEDIUM — worker `/status` and `/jobs` are unauthenticated** and publish model IDs, quantization, pipeline config and ~25 `video_id`s. Safe only because the worker binds `127.0.0.1`. Do not expose it on a public interface.
6. **MEDIUM — no legal pages, no cookie consent, no data export or deletion.** 17 footer links imply all of them exist.
7. **MEDIUM — no rate limiting on any API route**, including the unauthenticated `/api/payments/create` and `/api/ingest-url`.
8. **MEDIUM — no error tracking** on either process. A silent repurpose failure is indistinguishable from success.

### What is incomplete or unverified

- **Not production-grade security.** There is no CI, no dependency scanning, no rate limiting, no CAPTCHA, and no abuse protection on ingest or repurpose.
- `x-user-id` in `lib/auth-utils.ts` is dead code and should be removed so nobody relies on it. `api-client.ts:32-36` still sends the header on every call, and the comment at `auth-utils.ts:51-54` describes a trust path that no longer exists — which invites a future implementer to "fix" it into a real bypass. It returns `null` today, so it is harmless, but delete both.
- The `middleware.ts` matcher omits `/api/analytics`, `/api/content` and `/api/payments`. Those three re-check the session inside the route and correctly return `401`, so nothing is exposed today — it is a defence-in-depth gap, not a live hole.
- `/api/ingest-url` shells out to yt-dlp with `INGEST_MAX_BYTES` and `INGEST_MAX_DURATION_SECONDS` as the only resource bound. A hostile URL can still make the server download up to 50 MiB and hold the request for 240 s. Single-flight locking limits concurrency to one per user, not globally.
- `payments`, `usage_logs`, and `api_keys` are deny-all under RLS, so every read goes through the service-role key. Any bug in a route's `getUserId()` becomes a cross-tenant read.
- No policy declares a `TO` role, so every policy applies to `PUBLIC`. Today the `auth.uid()` predicates make that harmless, but it is a fragile default.
- The webhook handler treats a body with **neither** signature header as success (`{received: true}`, `200`) rather than a rejection.
- The E2E test password is committed as a default in three spec files. Acceptable only for the throwaway `krix.e2e@example.com` account.
- `ai-worker/.env` and `.env.local` hold live keys on this machine. Both are git-ignored; keep it that way, and rotate if they ever land in history.

---

## 🧪 Testing

### Results recorded in this repository

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | 🟢 exit 0 (re-run 2026-09-30) |
| Lint | `npm run lint` | 🟢 `✔ No ESLint warnings or errors` (re-run 2026-09-30) |
| Python unit + API | `pytest -p no:warnings` | 🟢 **216 passed, 28 skipped, 51.62 s** (re-run 2026-09-30) |
| Python compile | `python -m compileall -q app` | 🟢 clean, exit 0 |
| Mistral JSON regression | `pytest -q tests/test_mistral_json.py` | 🟢 12 passed |
| Worker health | `GET /health` | 🟢 `ok`, CUDA true, queue idle, 0 pending |
| Real full pipeline | `RUN_REAL_E2E=1 pytest tests/integration/test_real_e2e_gpu.py` | 🟢 9/9 tests, 188.97 s, 2 × 1080×1920 clips from real media |
| Real long video | `RUN_REAL_LONG=1` (1/10/30/60 min) | 🟢 5/5, 509.98 s combined; real chunking, stitching, offsets |
| Real ASR | `RUN_REAL_ASR=1` | 🟢 4,704 aligned words on 60-minute audio |
| Local upload | Playwright TEST 1 | 🟢 10.84 MB MP4 in a real browser |
| YouTube ingest | Playwright TEST 2 | 🟡 route exercised; downloads blocked on this network |
| Env facts | Playwright TEST 3 | 🟢 `maxBytes = 52428800` confirmed live |
| Repeated ingest | Playwright TEST 4 | 🟢 4 posts → 1 row, same `videoId`, 729–770 ms |
| Auto-repurpose | Playwright TEST 5 | 🟡 correct `503 AI_PROVIDER_NOT_CONFIGURED`, not a 500 |
| Database | live Supabase project | 🟢 rows, RLS, and stage values read back directly |
| Storage | live buckets | 🟢 private buckets, signed URLs |
| Auth | `login smoke` | 🟢 real Chromium login |
| Billing | — | ⬜ **NOT TESTED** — placeholder price IDs make a real charge impossible |

There are **222 Python test functions** across 17 files. The default run reports 244 collected cases (parametrized cases expand) — **216 pass, 28 skip**, and the 28 skips are the opt-in GPU/real-media tests gated behind `RUN_REAL_ASR` / `RUN_REAL_VL` / `RUN_REAL_E2E` / `RUN_REAL_LONG`. Six Playwright tests exist across three spec files.

```bash
# Worker
cd ai-worker
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python -m pytest -q tests/test_mistral_json.py
$env:RUN_REAL_E2E="1"; .\.venv\Scripts\python -m pytest -q tests/integration/test_real_e2e_gpu.py

# Browser
npx playwright test e2e/ingestion.spec.ts --project=chromium
npx playwright test e2e/regression.spec.ts --project=chromium -g "TEST 4"
```

`playwright.config.ts` runs serially with 1 worker and a 15-minute per-test timeout, and does **not** start the app — start Next.js and the worker yourself first.

---

## ⚠️ Known limitations

Every item below was confirmed in the code or in a test run.

1. **The real upload limit is 50 MiB, not 2 GB.** `UPLOAD_MAX_BYTES` (2 GiB) is only the app ceiling; `effectiveUploadLimit()` takes the **minimum** of it and the bucket's `file_size_limit` (unset in SQL ⇒ 50 MiB on the current plan). TEST 3 asserts `52428800`. Any "2 GB uploads" claim is false today.
2. **YouTube availability is network- and IP-dependent.** Two first-time imports of new URLs here ended in `504 DOWNLOAD_TIMEOUT` at ~236 s and ~246 s, and a direct `yt-dlp` probe returned `Requested format is not available` — this client is served no usable rendition. `YTDLP_COOKIES_FILE` / `YTDLP_COOKIES_FROM_BROWSER` exist for bot-walls but were not sufficient. Repeat imports of an already-imported URL are unaffected.
3. **Auto-repurpose is blocked by provider credit, not by code.** The key is valid (verified with a live completion returning `OK`) and the model is in OpenRouter's live catalog, but the account can fund only 2,601 of the 4,000 tokens a run requests. The app now returns `503 AI_PROVIDER_NOT_CONFIGURED` with an actionable message and stores nothing; `repurposed_content` is still empty. Operator action only.
4. **Google OAuth is almost certainly broken.** `src/app/auth/callback/page.tsx` passes `window.location.search.slice(1)` — the string `code=…&state=…` — to `exchangeCodeForSession`, which expects the bare code, and adds a 200 ms race on top. Email/password auth is unaffected.
5. **No real content has been generated by the repurpose path in this environment** (see 3), so the end-to-end quality of the 5 content types is unverified.
6. **Center crop, not Smart Reframe.** The filter chain is `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920` with no offsets, so the subject is cropped out whenever it is off-centre. No tracking, no face detection.
7. **Visual analysis only sees the first ~2 minutes of a long video.** Frames are sampled every 10 s up to 12, greedily from the start, so a 60-minute video contributes 12 frames from its opening 120 s.
8. **Billing cannot complete.** `STRIPE_PLANS` and `RAZORPAY_PLANS` use `price_xxxxx` / `plan_xxxxx`, so checkout fails at the provider. The marketing page's four tiers link straight to `/auth/signup` and never call checkout.
9. **The pricing page claims things that do not exist:** "Unlimited videos", "Watermarked exports" (no watermarking is ever applied), "No watermark" (nothing to remove), "AI custom branding", "Advanced analytics", "Custom AI training", "API access", "24/7 phone support".
10. **The capabilities grid advertises unimplemented features:** "AI Producer", "ClipAnything", "AI B-Roll", "AI Reframe", "Editor", "Animated captions" (static ASS only), "Social scheduler", "Export to XML", "Thumbnail generator" (a plain extracted frame), "Brand template", "Team workspace", "API", "MCP", "Inspiration gallery".
11. **`/dashboard/api` documents a fictional API** — `POST /v1/clips`, `POST /v1/clips/{id}/edit`, `POST /v1/clips/{id}/publish`, `GET /v1/usage` — and shows a sample `kx_live_…` key. None of it exists.
12. **Analytics mixes real and fake numbers.** `totalVideos`, `completedVideos`, `processingVideos`, and `postsThisWeek` are real. "YouTube 48.2K", "TikTok 31.9K", "Instagram 18.4K", "X 12.1K", "Total views 112.6K", "Avg. watch rate 41%", the deltas, and the "top 10%" bar are hardcoded in `src/app/dashboard/analytics/page.tsx:17-20,61-64`. No platform data is ever fetched — Krix publishes nothing and has no platform integrations.
13. **Team, Projects, Calendar, and Inspiration are static mockups.** Four hardcoded members (`priya@krix.app`, `alex@krix.app`, `sam@krix.app`, `jamie@krix.app`), four hardcoded projects, a hardcoded calendar whose "Schedule a post" writes nothing, and static idea cards. No tables, no API routes, and a role `<select>` that changes nothing.
14. **`PUT` and `DELETE /api/content/[id]` return HTTP 500 for every user and every row.** Both handlers select `'id, videos!inner(user_id)'` (`:66`, `:131`) and then read the embedded `videos` as an **array** (`:73-74`, `:138-139`). `repurposed_content.video_id → videos.id` is a **many-to-one** join, so PostgREST returns a single **object**, not a list. The guard then fails open in two steps: `(videos).length` is `undefined`, and `undefined === 0` is `false`, so the `length === 0` branch does not trip and evaluation continues; the very next expression, `(videos)[0].user_id`, dereferences `undefined` and throws `TypeError: Cannot read properties of undefined (reading 'user_id')`. The surrounding `catch` swallows it and returns `{ message: 'Server error' }` with **`status: 500`**. **The ownership check is not merely wrong — it never completes**, and it fails *open* rather than closed. Note it does not return 404: the code path that would produce 404 is never reached, because the property access throws first. `sanitizeFilename` is imported and never called, and a `regenerate` intent is accepted by no schema and silently ignored. `GET /api/content/[id]` is unaffected — it queries `videos` directly with `.eq('user_id', userId)` instead of embedding (`:22-27`). No UI is wired to PUT or DELETE, which is the only reason this has gone unnoticed. **Fix:** read the embed as an object — `(existing.videos as { user_id: string })?.user_id !== userId` — and add a route test. Roughly five lines plus one test; it is the highest bug-density item in the app.
15. **`NOT_FOUND` maps to HTTP 403** in `errors.py`, and `FileNotFoundError` maps to `NOT_FOUND`, so a missing local file at a non-rendering stage returns 403. `/jobs/{id}` is the only true 404.
16. **Stage vocabulary can drift.** `video_analysis_jobs.stage` has no CHECK constraint while `videos.processing_stage` does, and `clip_detection.py` raises with `stage="clips"` where `main.py` and `pipeline.py` use `"finding_clips"`.
17. **Silent transcript truncation is possible.** `asr.py` only warns when alignment returns fewer than half the expected words; there is no hard check that generation stopped short of `max_new_tokens`.
18. **Mistral prompt truncation drops the head.** `MISTRAL_MAX_INPUT_TOKENS=16384` is enforced with `truncation=True`, which keeps the **tail** — the beginning of the transcript, and in the worst case the system prompt, can be cut.
19. **`MISTRAL_TEMPERATURE` is never read**; generation is greedy. `AI_WORKER_HOST`/`AI_WORKER_PORT`, `SUPABASE_TIMEOUT`, and the `AI_WORKER_KEEP_ARTIFACTS`/`KEEP_ARTIFACTS` mismatch are also dead config.
20. **`src/types/index.ts` declares content types that are never written** — `thumbnails` and `hooks`. Only `tweets`, `blog`, `emails`, `linkedin`, `shorts` are produced.
21. The caption `.ass` file is a temp artifact: it is burned in and then deleted, never uploaded, so the caption text is not retrievable later. `build_srt()` exists and is only used by tests — SRT is not a shipped output.
22. The worker's `AI_WORKER_WORK_DIR` default is a **relative** `ai-worker/work`, so running uvicorn or pytest from inside `ai-worker/` creates a nested `ai-worker/ai-worker/work`. The scratch path is also relative, not derived from `__file__`.
23. **No CI.** Nothing runs `tsc`, `lint`, `pytest`, or Playwright on push. There is no Dockerfile, no `vercel.json`, no GitHub Actions, and no migration tooling — schema changes are a manual copy-paste into the SQL Editor.
24. `test-results/` and `playwright-report/` are now git-ignored, and so is the nested worker scratch dir, but the ~600 MB of media already sitting in `ai-worker/ai-worker/work/` should be deleted from disk.

### Added by the 2026-09-30 frontend audit

25. **CRITICAL — `/api/payments/verify` lets a signed-in user self-activate a paid plan without paying.** Signature verification is gated on `provider === 'razorpay'`; any other provider value, or omitting the field, skips it and still sets `status: 'active'`. Scope is limited to the caller's own account via `.eq('user_id', userId)`, so this is not a cross-account escalation — it is a free upgrade. See [Security](#-blocking-security-findings).
26. **No rate limiting on authentication.** Signup and login are unauthenticated and unmetered — credential stuffing, mass account creation and quota farming are all unmitigated.
27. **No legal pages and 17 dead footer links.** No privacy policy, terms, security page, cookie consent, data export, or account deletion. `Footer.tsx` links to all of them.
28. **Payment-method writes are client-trusted.** A session alone authorises storing a client-supplied `pm_…` reference and `last4`; neither is derived from the provider.
29. **Analytics cannot distinguish failure from data.** `hooks.ts:99-101` catches every error and returns the fallback, so a failed fetch renders the page's invented numbers as if the request succeeded. This is more dangerous than an obviously fake screen because it is indistinguishable from success.
30. **Thumbnail uploads use the wrong MIME type.** `upload_clip` hardcodes `video/mp4`, so the JPEG thumbnail is stored as video.
31. **The marketing surface is the least honest part of the product.** 6 named testimonials with roles and follower counts, 10 brand logos and "10,000+ creators" for a product with zero users, ~14 performance statistics, and complete performance tables for 5 platforms Krix has never posted to. Ten named capabilities — "AI Producer", "AI B-Roll", "AI Reframe", "AI Editor", "Animated captions", "Social scheduler", "XML export", "AI thumbnails", "Brand templates", "Team workspace" — have no code, no tables, and no routes. A public REST API and an MCP server are advertised without a "Soon" label in two of three places.
32. **6 of the 8 dashboard routes are mock or blocked**, and the developer-platform page **fabricates an API key in the browser** (`api/page.tsx:43`: `'kx_live_' + 'x'.repeat(32)`), so a user who copies it pastes a literal run of 32 `x`s into their terminal. Shipping a fake key generator is worse than shipping nothing — it teaches users the API is real.

---

## 📁 Repository layout

```
krix/
├── src/
│   ├── app/
│   │   ├── page.tsx, layout.tsx, globals.css, pricing/   # marketing site
│   │   ├── auth/{login,signup,callback}/                # auth pages
│   │   ├── dashboard/                                   # overview, videos, content/[videoId],
│   │   │                                                # analytics, settings, upload, team,
│   │   │                                                # projects, calendar, api, inspiration
│   │   └── api/                                         # 24 route handlers
│   ├── components/
│   │   ├── landing/       # 16 marketing components
│   │   ├── dashboard/     # 14 dashboard components
│   │   ├── auth/, ui/     # forms, guards, 9 UI primitives
│   │   └── supabase/      # schema.sql, ai_pipeline.sql, payment/
│   ├── lib/               # 14 modules: supabase, auth-utils, api-client, worker,
│   │                      # ai-provider, stripe, razorpay, geoip, transcribe,
│   │                      # hooks, utils, ingest, ingest-dedupe, ytdlp
│   ├── types/
│   └── middleware.ts      # route guard
├── ai-worker/
│   ├── app/
│   │   ├── main.py        # FastAPI app, 9 routes, GPU queue startup
│   │   ├── config.py      # 61 env vars
│   │   ├── errors.py      # PipelineError + HTTP mapping + message sanitizer
│   │   ├── pipeline.py    # the 6 stages
│   │   ├── models/        # asr, vision, mistral, manager
│   │   ├── services/      # audio, transcription, video_analysis, clip_detection,
│   │   │                  # captions, rendering, storage, job_queue,
│   │   │                  # repurpose_callback
│   │   └── schemas/
│   ├── tests/             # 17 test files, 222 test functions
│   ├── scripts/           # check-supabase.mjs (read-only live probe)
│   └── requirements.txt
├── e2e/                   # smoke, ingestion, regression Playwright specs
├── public/
├── playwright.config.ts
├── package.json, tailwind.config.ts, next.config.mjs, tsconfig.json
├── .env.example
└── *.md                   # this file + the reports below
```

Generated and not in version control: `node_modules/`, `.next/`, `ai-worker/.venv/`, `ai-worker/work*/`, `test-results/`, `*.log`.

---

## 🗺️ Roadmap

Derived from what the code and the reports actually identify. Nothing here is built. The full prioritised plan — 58 items across P0–P3 with effort estimates and acceptance gates — is in [`KRIX_FEATURE_IMPLEMENTATION_PLAN.md`](KRIX_FEATURE_IMPLEMENTATION_PLAN.md).

### P0 — before any launch (12 items, ~6–9 engineer-days)

1. **Delete the payment self-activation route** (25) and fulfil subscriptions only from a signature-verified provider webhook. This is the one finding that must not ship.
2. Fix the four confirmed defects: the Google OAuth callback (4), the `content/[id]` embed shape → **500** (14), the `NOT_FOUND` → 403 mapping (15), and the stage-vocabulary drift (16).
3. Reject `changeme` and empty values in `isValidServiceKey` exactly as the worker does, use `timingSafeEqual`, and fail startup if the value is still a placeholder.
4. Stop trusting client-supplied payment-method data (28).
5. Add per-IP and per-email rate limiting to auth, and per-user/per-IP limits on every API route (26, 7).
6. Get content actually generated: fund or replace the LLM provider so `/api/repurpose` runs end-to-end (3), then verify the 5 content types against real transcripts (5).
7. Replace every false marketing claim: pricing features (9), the capabilities grid (10, 31), the fictional API page and fabricated key (11, 32), and the hardcoded analytics numbers (12, 29). Until this is done the site advertises products that do not exist.
8. Delete the hardcoded analytics series and add a real error state, so a failure can never render as invented data (29).
9. Add CI (`tsc`, `lint`, `pytest`) — today nothing runs on push.
10. Make the schema reproducible: versioned migrations instead of a manual SQL-Editor paste.
11. Remove the dead `x-user-id` branch and its misleading comment from `lib/auth-utils.ts`.
12. Publish `/privacy`, `/terms` and `/security`, and implement data export and deletion (27).

Also worth doing while in there: confirm billing with real price IDs or hide the pricing page until it works, and delete the ~600 MB of stray media in `ai-worker/ai-worker/work/` while making `AI_WORKER_WORK_DIR` absolute.

### P1 — core product completion (20 items, ~8–12 engineer-days)

1. Frame sampling across the whole video instead of the first 120 s.
2. Add a real transcript-truncation guard and a head-preserving prompt budget.
3. Replace center crop with subject tracking, so clips actually keep the speaker. **The tracking signals are already computed in `models/vision.py` and thrown away — this is the best value in the whole plan.**
4. Persist the caption file and add SRT/VTT sidecars plus caption style variants.
5. Add a real clip-quality evaluation set so scoring changes are measurable.
6. Raise the effective upload limit: set `file_size_limit` on the buckets, or add a chunked/resumable upload path so `UPLOAD_MAX_BYTES` means something.
7. Make YouTube ingestion more reliable: better format fallbacks, cookies configured by default, clearer per-attempt diagnostics.
8. Make analytics real or remove it — no hardcoded platform numbers.
9. Make one checkout work end to end, and enforce plans on paid capabilities.

### P2 — growth

1. Social publishing with platform OAuth, and real scheduling with a queue.
2. Real thumbnails via a model, not an extracted frame.
3. Brand templates and caption kits.
4. Populate Projects, Team, and Calendar with real tables and APIs.

### P3 — platform

1. The public REST API that `/dashboard/api` already advertises.
2. MCP server.
3. Team seats, roles, and permissions.
4. LoRA/QLoRA fine-tuning of the clip ranker.
5. A timeline editor and Premiere/DaVinci interchange.

---

## 🧬 Long-term AI direction

Future goals. **None of this has been started**, and no model in this repository has been fine-tuned.

- **Better clip ranking.** The 6-dimension Mistral score is a first pass. The next step is a learned ranker trained on real performance feedback.
- **Dataset collection and human labelling.** Export candidate clips with their scores, have a human mark the good ones, and use that as training data.
- **Krix ClipRank** — a fine-tuned ranker over transcript + visual features, replacing or reranking Mistral's judgement.
- **Krix ContentWriter** — a model specialised for repurposing copy, trained on the same labelled corpus.
- **LoRA / QLoRA** on the open-weight stack, so the ranker fits the 8 GB card alongside the other models.
- **Published checkpoints on Hugging Face**, with the evaluation set published alongside them.
- **Visual embeddings** — index frames so clip selection can search visually, not just sample 12 times.
- **Personalized scoring** — weight the six dimensions per account based on what that creator actually posts.

---

## 🧑‍💻 Development workflow

1. Start the worker first: `cd ai-worker` → `.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8741`.
2. Check `GET /health` — `status: ok`, `cuda_available: true`, `pending: 0`.
3. Start the app: `npm run dev`.
4. Apply both SQL files to Supabase if you changed the schema, then `node ai-worker/scripts/check-supabase.mjs`.
5. Before committing: `npx tsc --noEmit` and `npm run lint`.
6. Worker tests: `cd ai-worker` → `.\.venv\Scripts\python -m pytest -q`.
7. Real media when a change touches the pipeline: `$env:RUN_REAL_E2E="1"` → the real GPU suite. Do not skip this — most pipeline bugs found in this repo only appeared on real video.
8. Browser: `npx playwright test e2e/ingestion.spec.ts --project=chromium` with both processes running.
9. Verify DB changes by reading rows back with the service-role client, not by trusting the write call.

**Rules that matter here**

- Never expose the worker to the browser, and never put `AI_WORKER_API_KEY`, `INTERNAL_SERVICE_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in a `NEXT_PUBLIC_` variable or a component.
- Never bypass Supabase authorization to make something work. If RLS blocks you, the query is wrong.
- Never commit a `.env` file. `.env*` is ignored except `.env.example`.
- Preserve the one-model-at-a-time `ModelManager` strategy. Loading two models at once is what makes the 8 GB budget fail.
- Test with real media. Synthetic fixtures hide transcription, alignment, and rendering bugs.
- Do not mark a scaffolded feature as working. If it has not been run, it is 🟠 or ⚪.
- Update this README, and the status table at the top, when functionality changes.
- Commit the docs and the code that the docs describe together. A README that describes a commit you are not pushing is worse than no README.

---

## Further reading

| Document | What it is |
| --- | --- |
| [`FRONTEND_FEATURE_AUDIT.md`](FRONTEND_FEATURE_AUDIT.md) | **The 177-feature audit** behind the status table above: itemised per feature, with a mechanical final tally, a 20-item security findings list, and a verdict by surface. Newest (2026-09-30). |
| [`KRIX_FEATURE_IMPLEMENTATION_PLAN.md`](KRIX_FEATURE_IMPLEMENTATION_PLAN.md) | **The plan to fix it.** 58 items across P0–P3 with dependencies, effort estimates, acceptance criteria and explicit anti-goals. P0+P1 is 14–21 engineer-days. |
| [`KRIX_PRODUCTION_READINESS_REPORT.md`](KRIX_PRODUCTION_READINESS_REPORT.md) | **The launch decision.** Per-dimension scores, a 14-point launch gate, a risk register, and the NOT-production-ready verdict. |
| [`INGESTION_RECOVERY_REPORT.md`](INGESTION_RECOVERY_REPORT.md) | Duplicate-ingestion PASS, auto-repurpose BLOCKED on provider credit, with real browser transcripts. |
| [`CORE_PIPELINE_COMPLETION.md`](CORE_PIPELINE_COMPLETION.md) | The AI pipeline's verification record: 9/9 real pipeline tests, 188.97 s, 14 bugs found and fixed, 60-minute video results. |
| [`AI_PIPELINE_STATUS.md`](AI_PIPELINE_STATUS.md) | Short per-component scorecard. Superseded in part by the reports above. |
| [`ai-worker/README.md`](ai-worker/README.md) | Worker setup, endpoint reference, and layout. |
| [`AI_IMPLEMENTATION_PLAN.md`](AI_IMPLEMENTATION_PLAN.md) | The original audit and build plan. Historical. |
| `DEVELOPMENT.md` | **Stale.** Still describes YouTube import as a no-op and transcription as OpenAI Whisper. Kept for history only — do not follow it. |

---

## License

Private. No license granted.
