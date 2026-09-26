# Krix AI Video Pipeline — Audit & Implementation Plan

Status: **In progress — audit complete, build in progress**
Target: turn Krix into a video-repurposing pipeline (upload → local ASR → visual
analysis → Mistral clip selection → FFmpeg vertical clips + captions → Supabase →
dashboard).

---

## 1. Repository audit

### Stack
- **Next.js 14 (App Router) + TypeScript + Tailwind** (`package.json`, `next@14.2.35`).
- **Supabase** (Auth, Postgres, Storage) via `@supabase/ssr` + `@supabase/supabase-js`.
- No backend job runner, no message queue. Processing is done with in-API-route HTTP
  calls + fire-and-forget fetch.
- Payments (Stripe/Razorpay), geo-IP (MaxMind) exist but are placeholder/demo.

### Existing upload → processing flow (working, but transcription is broken)
1. `POST /api/upload` (`src/app/api/upload/route.ts:36`) uploads the file to Supabase
   Storage bucket `videos` under `{userId}/{ts}-file`, inserts a `videos` row with
   `status='processing'`, then fire-and-forgets
   `POST /api/process-video` with the shared `x-service-key`.
2. `POST /api/process-video` (`src/app/api/process-video/route.ts`) is guarded by
   `isValidServiceKey()` (`src/lib/auth-utils.ts:10`). It downloads a signed URL,
   transcribes with OpenAI Whisper (`src/lib/transcribe.ts`, requires a real
   `OPENAI_API_KEY` — **currently broken**), saves `transcript`, then calls
   `POST /api/repurpose`.
3. `POST /api/repurpose` (`src/app/api/repurpose/route.ts`) sends the transcript to the
   configured LLM (`src/lib/ai-provider.ts`), force-parses JSON, deletes old rows, and
   inserts 5 formats into `repurposed_content`, then marks the video `completed`.
4. Dashboard polls `GET /api/videos` every ~8s while any video is `processing`
   (`src/lib/hooks.ts` `useInterval`, `src/components/dashboard/VideoLibrary.tsx`).
5. `StatusPill` (`src/components/dashboard/StatusPill.tsx`) only knows
   `processing | completed | failed`.

### Key files
| Concern | File |
| --- | --- |
| Auth (browser/server) | `src/lib/supabase.ts`, `src/lib/auth-utils.ts` |
| Route guard / service-key bypass | `src/middleware.ts` |
| AI provider registry | `src/lib/ai-provider.ts` |
| Whisper transcription | `src/lib/transcribe.ts` |
| Upload route | `src/app/api/upload/route.ts` |
| Process route | `src/app/api/process-video/route.ts` |
| Repurpose route | `src/app/api/repurpose/route.ts` |
| Video list/get/delete | `src/app/api/videos/*` |
| Dashboard center | `src/app/dashboard/page.tsx` |
| Video library + upload | `src/components/dashboard/VideoLibrary.tsx`, `VideoUpload.tsx` |
| Content review | `src/components/dashboard/RepurposedContent.tsx` |
| DB schema + RLS | `src/components/supabase/schema.sql` |
| Client hooks | `src/lib/hooks.ts` |
| Types | `src/types/index.ts` |

### Schema (`src/components/supabase/schema.sql`)
- Tables: `users`, `subscriptions`, `videos`, `repurposed_content`, `payments`,
  `usage_logs`, `api_keys` — all RLS-enabled, scoped to `auth.uid()`.
- `videos` has: `id, user_id, title, original_url, storage_path, duration_seconds,
  transcript, status, processing_started_at, processing_ended_at, error_message, timestamps`.
- Storage bucket `videos`: RLS requires first path segment == `auth.uid()`.
- `INDEX idx_videos_user_id`, `idx_repurposed_content_video_id`, etc.

### Reusable / non-reusable
**Reuse:**
- Auth + ownership model (`getUserId`, service-key pattern).
- Storage upload/download paths and bucket ownership convention.
- `videos` table + `status` polling from the dashboard.
- `repurpose` route (will keep working — it reads `videos.transcript`).
- `ai-provider.ts` registry for the text-repurposing feature (unchanged).
- Tailwind visual language (cards, `StatusPill`, `Button`, `Card`, `PageHeader`).

**Must change / add:**
- Transcription currently uses Whisper in the Next.js route. The AI worker replaces
  this with local Qwen3-ASR for the clip pipeline. `transcribe.ts` stays for
  compatibility but is no longer the upload path.
- `videos.status` has only 3 values. We add a **`processing_stage`** column
  (`uploaded → transcribing → analyzing → finding_clips → rendering → completed | failed`)
  instead of inventing a parallel status system.
- No clip tables exist. Add `clip_candidates`, `generated_clips`,
  `video_analysis_jobs` (see §6).

### Conflicts / risks
- **GPU constraint:** RTX 4060 Laptop, 8 GB VRAM. `Qwen3-ASR-1.7B` (~3.5 GB bf16),
  `Qwen3-VL-4B-Instruct` (~8.9 GB bf16 — does NOT fit), `Mistral-7B` full bf16
  (~14 GB — does NOT fit). **Must load one model at a time** and quantize VL + Mistral.
  See §3.
- **Two transcribers:** worker Qwen3-ASR vs existing Whisper. Mitigation: upload now
  triggers the worker pipeline; the old `process-video` route stays but is not auto-triggered.
- **FFmpeg** is installed via winget (Gyan 9.0 full build) but **not on PATH**;
  its location is autodetected, with `FFMPEG_PATH` env override documented.
- **Python:** machine has 3.14; model stack (torch, transformer support, bitsandbytes)
  is best supported on **Python 3.12** (also the version the Qwen3-ASR package docs
  recommend). Worker docs specify a 3.12 venv.
- **things not to touch:** payments, geoip, marketing pages, existing repurpose feature.

---

## 2. Target architecture

```
Browser
  └► Next.js (App Router)
        ├─ /api/upload            (unchanged flow, now triggers pipeline route)
        ├─ /api/pipeline/process  NEW server-to-server route → AI worker
        ├─ /api/clips/*           NEW list/get clip candidates + generated clips
        └─ dashboard "AI Clips" section (NEW)
                │ HTTP (AI_WORKER_URL, shared secret header)
                ▼
        ai-worker  (FastAPI, Python 3.12, loads models ONCE & sequentially, background job)
                ├─ Qwen3-ASR-1.7B-hf        → timestamped transcript (forced aligner)
                ├─ Qwen3-VL-4B-Instruct    → timed visual observations (frame sampling)
                ├─ Mistral-7B-Instruct-v0.3 → clip candidates + Krix Clip Quality Score
                └─ FFmpeg                   → 9:16 vertical clips + burned captions
                │
                ▼ (service role, server-side only)
        Supabase: videos(+processing_stage) · transcript_segments · clip_candidates ·
                  generated_clips · video_analysis_jobs · Storage bucket generated_clips
```

Browser never talks to the worker directly; the worker never holds user-facing secrets.

---

## 3. Model strategy for 8 GB VRAM (RTX 4060)

| Model | Checkpoint | Size | Load strategy |
| --- | --- | --- | --- |
| ASR | `Qwen/Qwen3-ASR-1.7B-hf` | ~4.7 GB bf16 | bf16, GPU. Timestamps via `Qwen/Qwen3-ForcedAligner-0.6B-hf`. |
| Vision | `Qwen/Qwen3-VL-4B-Instruct` | ~8.9 GB bf16 | **8-bit (bitsandbytes)** default; fp16 fallback with reduced frame count. |
| Reasoning | `mistralai/Mistral-7B-Instruct-v0.3` | ~14 GB bf16 | **4-bit NF4 BitsAndBytes** + bf16 compute. |

**VRAM rule:** the worker keeps a global `ModelManager` that loads exactly one heavy
model at a time, `torch.cuda.empty_cache()` between loads, and a `threading.Lock` to
serialize model access. Pipeline order frees ASR → loads VL → frees VL → loads Mistral →
frees Mistral → renders with FFmpeg (CPU). This keeps peak usage ≈ one model (~4–5 GB).

Config is centralized in `ai-worker/app/config.py` (`ASR_MODEL`, `VISION_MODEL`,
`MISTRAL_MODEL`, `VISION_QUANTIZATION`, `MISTRAL_QUANTIZATION=4bit`, model swap = env only).

Official documented HF APIs used (verified against current model cards / transformers docs):
- ASR: `AutoProcessor` + `AutoModelForMultimodalLM`, `processor.apply_transcription_request(audio, language)`,
  `model.generate`, `processor.decode(..., return_format="parsed"|"transcription_only")`.
- Aligner: `AutoModelForTokenClassification`,
  `processor.prepare_forced_aligner_inputs(audio, transcript, language)`,
  `processor.decode_forced_alignment(logits, input_ids, word_lists, timestamp_token_id)`.
- VL: `AutoProcessor` + `AutoModelForMultimodalLM`, `processor.apply_chat_template`, `model.generate`.
- Mistral: `AutoModelForCausalLM` + `BitsAndBytesConfig(load_in_4bit=True, ...)`.

**No fine-tuning in this milestone.** Baseline only. (Future: Krix clip-quality dataset → LoRA/QLoRA.)

---

## 4. AI worker structure

```
ai-worker/
├── app/
│   ├── main.py            FastAPI app, endpoints, background jobs
│   ├── config.py         central settings (env-driven)
│   ├── pipeline.py       orchestrates transcription→visual→clips→render→store
│   ├── models/
│   │   ├── __init__.py
│   │   ├── manager.py    load/free one model at a time + thread lock
│   │   ├── asr.py        Qwen3-ASR + forced aligner wrappers
│   │   ├── vision.py     Qwen3-VL wrapper (8-bit default)
│   │   └── mistral.py    Mistral 7B instruct (4-bit NF4) + strict JSON parse
│   ├── services/
│   │   ├── __init__.py
│   │   ├── audio.py      ffprobe/ffmpeg: duration, extract wav 16k mono
│   │   ├── transcription.py  transcript + segments model building
│   │   ├── video_analysis.py scene/frame sampling + VL observations
│   │   ├── clip_detection.py Mistral prompt + candidate validation
│   │   ├── captions.py   .srt/.ass generation (word timing, one default style)
│   │   ├── rendering.py  ffmpeg 9:16 vertical clip + burned captions
│   │   └── storage.py    Supabase download/upload + DB upserts (service role)
│   └── schemas/
│       └── pipeline.py   Pydantic request/response + segment/clip models
├── tests/                 pytest suite (see §8)
├── requirements.txt
├── .env.example
└── README.md
```

### Endpoints (FastAPI)
`POST /health` · `POST /transcribe` · `POST /analyze-video` · `POST /find-clips` ·
`POST /render-clip` · `POST /pipeline`.

- `POST /pipeline` takes `{ video_id, user_id, storage_path, title }`, starts a
  **background job**, returns `{status:"started", job_id}` immediately. Progress is
  written to Supabase (`video_analysis_jobs` + `videos.processing_stage`) so the
  existing dashboard polling "just works".
- All endpoints (except `/health`) require bearer token `AI_WORKER_API_KEY` sent by
  Next.js. Optional to allow local dev with `AI_WORKER_AUTH=disabled`.
- **Ownership check server-side:** the worker re-fetches the `videos` row by
  `{id, user_id}` before touching storage/DB, and always scopes writes to rows it
  owns. Never trusts a client-supplied path.

### Errors
Structured on failure, never crashes the site:
```json
{ "status": "failed", "stage": "transcription",
  "error_code": "MODEL_OUT_OF_MEMORY", "message": "..." }
```
Codes: `UNSUPPORTED_FILE`, `MODEL_MISSING`, `CUDA_UNAVAILABLE`, `MODEL_OUT_OF_MEMORY`,
`CORRUPT_MEDIA`, `TRANSCRIPTION_FAILED`, `VISION_FAILED`, `LLM_INVALID_JSON`,
`CLIP_VALIDATION_FAILED`, `RENDER_FAILED`, `STORAGE_UPLOAD_FAILED`, `NOT_FOUND`,
`FORBIDDEN`, `PIPELINE_INTERNAL`.

---

## 5. Pipeline stages (MVP)

| # | Stage | Model / tool | Output |
| --- | --- | --- | --- |
| 1 | `transcribing` | ffmpeg (extract audio) → Qwen3-ASR + forced aligner | `transcript` + `transcript_segments` (JSON) + duration |
| 2 | `analyzing` | ffmpeg frame sampling → Qwen3-VL | timed `visual` observations (JSON) |
| 3 | `finding_clips` | Mistral-7B 4-bit | candidate clips with Krix Clip Quality Score |
| 4 | `validating` | server-side rules | sorted, deduped, clamped candidates → `clip_candidates` |
| 5 | `rendering` | ffmpeg | 9:16 MP4 (H.264/AAC) per clip + burned captions |
| 6 | `completed` | storage | upload to `generated_clips` bucket → `generated_clips` rows |

Defaults: `MAX_CLIPS=3`, `MIN_CLIP_DURATION=20`, `MAX_CLIP_DURATION=90`,
`FRAME_SAMPLE_INTERVAL=10` (seconds), all configurable.

Mistral gets: transcript segments, visual observations, duration, and a strict
prompt asking for JSON `{"clips":[{start,end,score,hook_score,story_score,
information_score,emotion_score,visual_score,context_independence,reason}]}`.
Terminology used: **"Krix Clip Quality Score"** — explicitly *not* a virality guarantee.
LLM JSON is validated hard server-side; invalid output → retry (1x) then fail gracefully.

---

## 6. Database additions (append-only migration, no weakening of RLS)

New file `src/components/supabase/ai_pipeline.sql` (+ appended to `schema.sql`):

- `videos`: add `processing_stage TEXT` and `transcript_segments JSONB`.
- `clip_candidates`: `id, video_id, start_time, end_time, score, hook_score,
  story_score, information_score, emotion_score, visual_score,
  context_independence, reason, created_at` (+ indexes on `video_id`, `score`).
- `generated_clips`: `id, video_id, candidate_id, storage_path, duration,
  aspect_ratio, caption_style, status, created_at` (+ index on `video_id`).
- `video_analysis_jobs`: `id, video_id, user_id, status, stage, job_id,
  error_code, error_message, created_at, updated_at`.
- RLS: identical ownership pattern to `videos`/`repurposed_content`
  (select/insert/update/delete scoped via owned videos / `auth.uid()`). Service role
  bypasses RLS (existing convention used everywhere today).
- New Storage bucket `generated_clips` with the same
  `{userId}/...` first-segment ownership policies.

-> No table is dropped or altered destructively. Existing RLS stays intact.

---

## 7. Next.js integration

- **`AI_WORKER_URL`** (env) + **`AI_WORKER_API_KEY`** (shared secret). Added to
  `.env.example`; `.env.local` untouched.
- New server-only route `POST /api/pipeline/process` (service-key guarded) that:
  1. Re-fetches video by `id + user_id` (from DB, not client),
  2. sets `status=processing`, `processing_stage=transcribing`, clears errors,
  3. creates a `video_analysis_jobs` row,
  4. calls worker `POST /pipeline` with `{video_id, user_id, storage_path, title}`,
  5. on success marks job completed; on structured worker error writes
     `status=failed`, `error_message`, and returns it.
- `GET /api/clips?videoId=` (user-scoped) → `clip_candidates` + `generated_clips`.
- `/api/upload` now triggers `/api/pipeline/process`. After pipeline success we also
  fire the existing `/api/repurpose` (service-key) so `repurposed_content` generation
  still happens automatically as today (it reads `videos.transcript`, now populated by
  the worker).
- `middleware.ts`: add `/api/pipeline` + `/api/clips` to protected matcher.
- Dashboard: new **"AI Clips"** section on the video content page (+ dashboard center
  recent clips) showing thumbnail, duration, **Krix Clip Quality Score**, reason,
  timestamp range, download button. StatusPill extended with the new stages, and a
  progress list (`✓ Upload → ✓ Transcription → ✓ Video analysis → ● Finding best
  clips → ○ Rendering → ○ Complete`) shown while processing.

---

## 8. Testing

- Python (`pytest`): transcript parsing, timestamp validation, clip JSON validation,
  duplicate/overlap detection, FFmpeg command generation (LRU/image/text filters),
  pipeline failure handling, auth (worker bearer), Supabase RLS scenario stubs.
- Fixture videos built with ffmpeg: **30 s, 2 min, 5 min** (sine tone + color test
  pattern) — no 1-hour video in CI.
- Next.js: continue relying on `next build`/`tsc` + lint; manual end-to-end on the
  5-minute fixture through the dashboard.

---

## 9. Next steps (after build completes)

1. Run ai-worker unit tests (`pytest`).
2. Typecheck/lint Next.js (`tsc --noEmit`, `next lint`).
3. Apply Supabase migration in the SQL editor.
4. Install Python 3.12 venv + `pip install -r requirements.txt`; first model download
   will take a while.
5. Generate 5-minute test video with ffmpeg, upload through Krix, watch the pipeline
   complete end-to-end, verify a generated clip shows in the dashboard.

Known limitations recorded at the end of this doc (rendering center-crop only,
single 5-min alignment chunk, sequential single-model GPU use, no fine-tuning).