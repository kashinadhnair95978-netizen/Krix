# 🎬 Krix

> **Turn 1 video into 100 posts.** An AI content-repurposing SaaS — upload a video once, get tweets, blog posts, email sequences, LinkedIn posts, and rendered 9:16 short-form clips with burned-in captions, generated for every platform.

**Built by [Kashinadh Nair](https://github.com/kashinadhnair95978-netizen)**

| | |
| --- | --- |
| **Web app** | Next.js 14 (App Router) · TypeScript (strict) · Tailwind CSS |
| **Backend** | Supabase (Postgres · Auth · Storage) with Row Level Security |
| **AI video worker** | Python · FastAPI · PyTorch · FFmpeg — self-hosted on your own GPU |
| **Content AI** | Any LLM: Claude · OpenAI · Gemini · OpenRouter · any OpenAI-compatible endpoint |
| **Payments** | Stripe + Razorpay, geo-routed by visitor IP |
| **Tests** | 78 pytest tests · `tsc --noEmit` clean · `next lint` clean |

---

## 📋 Status legend

This README documents what is **actually implemented**, not what is planned. Every feature is tagged:

| Tag | Meaning |
| --- | --- |
| ✅ **WORKING** | Implemented and verified running end-to-end. |
| 🟡 **SCAFFOLDED** | Real code and UI, but needs credentials/config you must supply, or is a static mockup with no data layer. |
| 🔵 **PARTIAL** | Implemented and wired, but a stage could not be executed here (e.g. a large model download was aborted). |
| ⬜ **PLANNED** | Not built. Listed for roadmap context only. |

Read [Known limitations](#-known-limitations--honest-status) before assuming a feature is live.

---

## ✨ What the website contains

### Marketing site (public) — ✅ WORKING

Single-page landing experience at `/`, composed of 11 sections in `src/components/landing/`:

| Section | Component | What it does |
| --- | --- | --- |
| Nav | `Navbar.tsx` | Sticky top nav, anchor links, sign-in / get-started CTAs |
| Hero | `Hero.tsx` | Headline, animated `BlackHoleBackground`, CTAs, trust stats |
| CTA | `CTA.tsx` | Mid-page conversion block |
| Trust | `TrustedBy.tsx` | Logo / social-proof strip |
| Capabilities | `Capabilities.tsx` | Feature grid; one control is a `ComingSoon` modal |
| Solutions | `Solutions.tsx` | Use-case table (creators, podcasters, agencies, …) |
| How it works | `HowItWorks.tsx` | Numbered 3-step explainer |
| Pricing | `Pricing.tsx` | 4 static tier cards (Free / Basic / Pro / Enterprise) |
| Testimonials | `Testimonials.tsx` | Creator quotes |
| FAQ | `FAQ.tsx` | Expandable questions |
| Footer | `Footer.tsx` | Links + newsletter; one control is a `ComingSoon` modal |

Supporting components: `Reveal.tsx` (scroll-triggered fade-up), `SpotlightCard.tsx` (cursor-following glow), `VideoLinkCTA.tsx` (URL input UI), `icons.tsx` (inline SVG set).

> ⚠️ The "paste a video link" inputs in `Hero` / `VideoLinkCTA` are **presentational only** — there is no server route that ingests a remote URL (YouTube, Drive, Vimeo…). See [Known limitations](#-known-limitations--honest-status).

### Auth — ✅ WORKING

| Capability | Status | Implementation |
| --- | --- | --- |
| Email + password signup | ✅ | `api/auth/signup` — `auth.admin.createUser` with `email_confirm: true`, then auto sign-in via cookie-writing server client |
| Email + password login | ✅ | Client-side `browserSupabase.auth.signInWithPassword` (`LoginForm.tsx`) |
| Google OAuth | ✅ | `signInWithOAuth` → `/auth/callback` → `exchangeCodeForSession` → `POST /api/auth/upsert-profile` (`GoogleSignIn.tsx`) |
| Logout | ✅ | `api/auth/logout` — `signOut({ scope: 'local' })` + manual Supabase cookie clearing |
| Profile sync | ✅ | `api/auth/upsert-profile` upserts `users.full_name` / `avatar_url` from OAuth metadata |
| Route protection | ✅ | `src/middleware.ts` |
| Service-key bypass | ✅ | `x-service-key` header equals `INTERNAL_SERVICE_KEY` → allowed before any session check |

**Middleware** protects `/dashboard`, `/api/videos`, `/api/upload`, `/api/repurpose`, `/api/subscription`, `/api/ai`, `/api/pipeline`, `/api/clips`. It **fails closed**: if Supabase env vars are missing or still `placeholder`, pages redirect to `/auth/login` and APIs return `401`. Authenticated users hitting `/auth/*` are bounced to `/dashboard`.

### Dashboard — mixed

Sidebar navigation (`Sidebar.tsx`) groups 10 of the 11 dashboard routes:

| Route | Label | Status | Data source |
| --- | --- | --- | --- |
| `/dashboard` | Center | ✅ | `apiClient.getVideos()` — stats, recent videos, AI-create tiles |
| `/dashboard/upload` | Create new | ✅ | `VideoUpload.tsx` — drag & drop, title, 2 GB cap |
| `/dashboard/videos` | My clips | ✅ | Video library sorted by status, live polling |
| `/dashboard/content/[videoId]` | Content review | ✅ | `getVideoById` + `repurposeVideo` + `GeneratedClips` |
| `/dashboard/analytics` | Analytics | ✅ | `useAnalytics()` → **real** `GET /api/analytics` (14-day buckets) |
| `/dashboard/settings` | Settings | ✅ | `GET /api/ai/config` (active provider), subscription cancel |
| `/dashboard/calendar` | Calendar | 🟡 | Static mock grid — no scheduler backend |
| `/dashboard/projects` | My projects | 🟡 | Static cards — reads nothing |
| `/dashboard/team` | Team | 🟡 | Static member list — no invite/RBAC backend |
| `/dashboard/api` | API & MCP | 🟡 | Static code snippets — no key-issuance API |
| `/dashboard/inspiration` | Inspiration | 🟡 | Static template gallery |

Real dashboard components: `Navbar`, `Sidebar`, `CommandPalette` (**⌘K / Ctrl+K**, arrow-key nav, Escape to close), `VideoUpload`, `VideoLibrary`, `RepurposedContent`, `ContentEditor`, `DownloadButton`, `StatusPill`, `PipelineProgress`, `GeneratedClips`, `Sparkline`, `PageHeader`, `icons`.

- **`StatusPill.tsx`** — renders the *live stage* while processing, else the coarse status. Recognises: `completed` (→ "Ready"), `processing`, `failed`, `queued`, `transcribing`, `analyzing`, `finding_clips`, `rendering`.
- **`PipelineProgress.tsx`** — 6-step checklist driven by `videos.processing_stage`:
  `1 Upload → 2 Transcription → 3 Video analysis → 4 Finding best clips → 5 Rendering clips → 6 Complete`, with ✕ on the un-reached steps when the stage is `failed`.

### Content repurposing (text) — ✅ WORKING

`POST /api/repurpose` sends the transcript to the active LLM and writes five `repurposed_content` rows per video:

| `content_type` | Output |
| --- | --- |
| `tweets` | 10 Twitter/X variations |
| `blog` | Title + SEO headers + first draft |
| `emails` | 5-email nurture sequence |
| `linkedin` | 5 professional posts |
| `shorts` | 5 short-form scripts (30–60 s) |

The response is force-parsed as JSON via `parseAIJSON()` (strips ` ```json ` fences). Old rows are deleted before insert, so re-running is idempotent. The dashboard's `ContentEditor` lets you edit, copy, and download each asset inline.

### AI video pipeline (`ai-worker/`) — ✅ / 🔵

A self-hosted Python service that turns a raw video into finished vertical clips. **No audio or video ever leaves your machine.** See the [deep dive](#-ai-video-pipeline-deep-dive).

| Stage | Status | Verified on hardware |
| --- | --- | --- |
| `ffprobe` metadata + stream validation | ✅ | 39.9 s, 1280×720@24, H.264+AAC |
| Audio extraction → 16 kHz mono WAV | ✅ | 1.28 MB real output |
| Frame sampling for visual analysis | ✅ | 4 frames at 0/10/20/30 s |
| **Qwen3-ASR transcription (CUDA)** | ✅ | Real inference, ~5 s, correct English output |
| Forced alignment (word timestamps) | 🔵 | Code + fallback verified; model download interrupted at 74 MB |
| **Qwen3-VL visual analysis** | 🔵 | Real 8-bit implementation; 8.9 GB download aborted |
| **Mistral clip selection** | 🔵 | Real 4-bit NF4 implementation; 14.5 GB download aborted |
| Clip validation / dedupe / ranking | ✅ | Correctly enforced `MIN_CLIP_DURATION=20` |
| ASS/SRT caption generation | ✅ | Real `Dialogue:` events + style block |
| **FFmpeg 9:16 render + caption burn-in** | ✅ | 1080×1920@30 h264; burn confirmed by pixel diff |
| FastAPI service + bearer auth | ✅ | `/health` 200, bad key 401, good key 200 |
| Supabase writes → dashboard clips | 🟡 | Client connects; **migration not yet applied** |

### Payments — 🟡 SCAFFOLDED

Full geo-aware dual-provider integration is implemented, but **every plan ID is a literal placeholder** (`price_xxxxx`, `plan_xxxxx`), so the checkout routes deliberately return `500 "not configured"` until you create real products.

| Plan | Landing price | Stripe | Razorpay |
| --- | --- | --- | --- |
| Free | $0 | — | — |
| Basic | $15/mo · $12 annual | `price_xxxxx` · $15 | `plan_xxxxx` · ₹1500 |
| Pro | $24/mo · $19 annual | `price_xxxxx` · $24 | `plan_xxxxx` · ₹2400 |
| Enterprise | $70/mo · $56 annual | `price_xxxxx` · $70 | `plan_xxxxx` · ₹7000 |

- **Geo-routing** — `GET /api/payments/provider` geolocates via MaxMind GeoIP2 and returns `razorpay` for `IN, BD, LK, PK`, else `stripe`. Localhost / empty IP short-circuits to Stripe.
- **Checkout** — `POST /api/payments/create` validates the plan, detects the provider, creates the customer + subscription, records a `pending` row, and returns `{ provider, subscriptionId, clientSecret | shortUrl }`. `PaymentSelector.tsx` renders `StripeCheckout` or `RazorpayCheckout` to match.
- **Verify** — `POST /api/payments/verify`. Razorpay recomputes the HMAC-SHA256 over `paymentId|subscriptionId`; Stripe branch does **not** verify a signature (see limitations).
- **Webhooks** — one `POST /api/payments/webhook` handles both. Stripe: `constructEvent` with `STRIPE_WEBHOOK_SECRET`, then `customer.subscription.created/updated/.deleted` + `invoice.paid`. Razorpay: HMAC over the raw body vs `x-razorpay-signature`, then `subscription.activated/cancelled` + `payment.captured`.
- **Manage** — `GET/POST /api/subscription` (read / cancel) and `PUT/PATCH /api/subscription/payment-method` (Stripe default PM).

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser                                                             │
│   Landing (public)  ·  /auth/*  ·  /dashboard/*                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  @supabase/ssr cookie session
┌───────────────────────────────▼──────────────────────────────────────┐
│ Next.js 14 App Router                                               │
│   src/middleware.ts  → route guard + x-service-key bypass            │
│   src/app/api/**     → 23 route handlers                             │
│   src/lib/ai-provider.ts → Claude / OpenAI / Gemini / OpenRouter /  │
│                            any OpenAI-compatible endpoint            │
└───────┬──────────────────────────────────────────────┬───────────────┘
        │ x-service-key (server-to-server)              │ service role
┌───────▼──────────────────────────┐   ┌───────────────▼───────────────┐
│ ai-worker/  FastAPI  :8741        │   │ Supabase                     │
│   transcribe → analyze →          │   │   Postgres + RLS             │
│   find_clips → render → store     │   │   Auth (email + Google)      │
│   Qwen3-ASR · Qwen3-VL · Mistral   │   │   Storage: videos,           │
│   FFmpeg 9:16 + ASS captions      │   │            generated_clips    │
└───────────────────────────────────┘   └───────────────────────────────┘
```

**Trust boundary:** the browser never talks to the worker. The worker never holds user-facing secrets. The worker re-reads every path from the database and scopes all writes to the `(video_id, user_id)` pair, so a client-supplied path is never trusted.

### End-to-end data flow

1. **`POST /api/upload`** — validates session, enforces the 2 GB cap, writes the file to the `videos` bucket at `{userId}/{timestamp}-{sanitizedName}` (`cacheControl: 3600`, `upsert: false`, `[^\w.-]` → `_`), inserts a `videos` row with `status='processing'`, then self-calls the pipeline over HTTP with `x-service-key`. Returns `201` immediately — processing is asynchronous.
2. **Route selection** — if `AI_WORKER_URL` is set → `POST /api/pipeline/process`; otherwise → `POST /api/process-video` (the legacy in-app path).
3. **`POST /api/pipeline/process`** — re-reads the video from the DB, returns `200` if already `completed`, else sets `status='processing'`, `processing_stage='queued'`, clears `error_message`, stamps `processing_started_at`, and calls `triggerPipeline()`. Returns `202`, or `502` with `fallback_as_available: true` if the worker is unreachable.
4. **`src/lib/worker.ts`** — POSTs `{video_id, user_id, storage_path, title}` to `${AI_WORKER_URL}/pipeline` with `Authorization: Bearer` and a 15 s `AbortSignal.timeout`. It **never throws** — unconfigured, non-2xx, and network errors all resolve to `{ triggered: false, reason, detail }`.
5. **Worker `/pipeline`** — returns `{"status":"started"}` immediately and runs the job on a daemon thread. Progress is mirrored to both `videos.processing_stage` and `video_analysis_jobs` so the existing dashboard polling just works.
6. **Worker stages** — see [pipeline deep dive](#-ai-video-pipeline-deep-dive).
7. **Dashboard** — polls `GET /api/videos` every 8 s while anything is processing (`useInterval`), rendering `StatusPill` + `PipelineProgress`, and fetches rendered clips from `GET /api/clips?videoId=` (1-hour signed URLs for MP4 + thumbnail).
8. **Repurpose** — `POST /api/repurpose` reads the worker-populated `videos.transcript`, generates the 5 text formats, writes `repurposed_content`, and marks the video `completed`.

---

## 🤖 AI video pipeline deep dive

### Service design

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET`/`POST /health` | none | `{ status, cuda_available, model_loaded }` |
| `GET /status` | none | Loaded model, all model IDs, pipeline tuning |
| `POST /pipeline` | **bearer** | Production entry point. Background daemon thread. |
| `POST /transcribe` | **bearer** | Debug: ASR only, from a local audio path |
| `POST /analyze-video` | **bearer** | Debug: frame sampling + VL observations |
| `POST /find-clips` | **bearer** | Debug: Mistral proposals + validation |
| `POST /render-clip` | **bearer** | Debug: single 9:16 render |

Auth fails **closed**: if `AI_WORKER_AUTH` is enabled and `AI_WORKER_API_KEY` is unset or literally `changeme`, the worker refuses the request rather than allowing it. Every `PipelineError` maps to a structured body — `FORBIDDEN` → `401`, `NOT_FOUND` → `403`, otherwise `500` — with a stable error code so the site never crashes on a worker failure.

### The six stages

| # | `processing_stage` | Tool | Output |
| --- | --- | --- | --- |
| 0 | *(job created)* | Supabase | `video_analysis_jobs` row, `status='running'` |
| 1 | `transcribing` | ffprobe → ffmpeg → Qwen3-ASR | `videos.transcript`, `transcript_segments` (jsonb), `duration_seconds` |
| 2 | `analyzing` | ffmpeg frames → Qwen3-VL | timed visual observations |
| 3 | `finding_clips` | Mistral-7B | clip candidates + **Krix Clip Quality Score** |
| 4 | `rendering` | captions + FFmpeg | 9:16 H.264/AAC MP4 with burned ASS captions + thumbnail |
| 5 | `completed` | Supabase Storage | MP4 + JPG in `generated_clips`, `generated_clips` rows, `videos.status='completed'` |

Failure at any stage writes `status='failed'`, `processing_stage='failed'`, and the structured error message, then re-raises. A `finally` block always unloads the model and removes the job directory (unless `AI_WORKER_KEEP_ARTIFACTS=1`).

### Model strategy for 8 GB VRAM

| Role | Checkpoint | bf16 size | Loaded as | Fits 8 GB? |
| --- | --- | --- | --- | --- |
| ASR | `Qwen/Qwen3-ASR-1.7B-hf` | ~4.1 GB | bf16 | ✅ verified |
| Word timing | `Qwen/Qwen3-ForcedAligner-0.6B-hf` | ~1.3 GB | bf16 | ✅ (not executed) |
| Vision | `Qwen/Qwen3-VL-4B-Instruct` | ~8.9 GB | **8-bit** bitsandbytes (~4.6 GB) | ✅ 8-bit only — fp16 does **not** fit |
| Reasoning | `mistralai/Mistral-7B-Instruct-v0.3` | ~14.5 GB | **4-bit NF4 + double-quant** (~4.0 GB) | ✅ 4-bit only — 8-bit/fp16 does **not** fit |

`ModelManager` is a single global guarded by a `threading.RLock`. `load(name, factory)` returns the cached model on a cache hit, otherwise evicts the current one (`model.to("cpu")` → `del` → `gc.collect()` → `torch.cuda.empty_cache()` → `torch.cuda.synchronize()`) before building the new one. The enforced order is `asr` → `asr_aligner` → `vision` → `mistral` → `unload()`, so **peak VRAM ≈ one model**.

### Clip scoring & validation

Mistral receives the duration, the timestamped transcript (`[12.4s-48.2s] text`), and the visual observations, and is asked for strict JSON:

```json
{"clips":[{"start":0,"end":0,"score":0,"hook_score":0,"story_score":0,
           "information_score":0,"emotion_score":0,"visual_score":0,
           "context_independence":0,"reason":""}]}
```

The system prompt names `score` the **Krix Clip Quality Score** and explicitly states it is *not* a prediction of guaranteed virality. The model is asked for `MAX_CLIPS × 2` proposals so validation has a pool to choose from.

`validate_and_rank()` is a **pure, fully unit-tested** function — nothing the LLM produces is trusted:

1. Reject any entry that fails the pydantic `ClipCandidate` schema (scores outside 0–100 are discarded, not clamped).
2. Drop `start < 0` or `end <= start`.
3. Drop `end > duration + 0.5` (0.5 s grace).
4. Drop clips longer than `MAX_CLIP_DURATION` or shorter than `MIN_CLIP_DURATION`.
5. Drop anything below `MIN_SCORE`.
6. Sort by score desc, then greedily select up to `MAX_CLIPS`, **rejecting any candidate overlapping an already-selected clip by more than 1.0 s**.
7. Re-sort the survivors chronologically by start time.

### Rendering

```
ffmpeg -y -hide_banner -loglevel error \
  -ss {start:.3f} -i {source} -t {end-start:.3f} \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[,subtitles='{escaped.ass}']" \
  -r 30 -c:v libx264 -preset veryfast -crf 23 \
  -c:a aac -b:a 128k -shortest -movflags +faststart {out}.mp4
```

`-ss` before `-i` for fast seek. Captions are real ASS: a 23-field `V4+ Styles` block (Arial, bold, bottom-centre, 3 px outline) plus one `Dialogue:` event per cue, with `{`/`}` neutralised so transcript text can never inject an ASS override block. Cue times are **re-based to clip-relative time** by clipping transcript segments to the window. Word-level cues are the fallback when no segment overlaps.

### Structured error contract

`PipelineError` serialises to `{"status":"failed","stage","error_code","message", ...extra}`. 16 codes: `UNSUPPORTED_FILE`, `MODEL_MISSING`, `CUDA_UNAVAILABLE`, `MODEL_OUT_OF_MEMORY`, `CORRUPT_MEDIA`, `TRANSCRIPTION_FAILED`, `VISION_FAILED`, `LLM_INVALID_JSON`, `CLIP_VALIDATION_FAILED`, `RENDER_FAILED`, `STORAGE_UPLOAD_FAILED`, `WRITE_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`, `PIPELINE_INTERNAL`. Stages: `auth`, `storage`, `media`, `models`, `transcription`, `analyzing`, `finding_clips`, `rendering`, `pipeline`.

---

## 🧠 AI provider layer

`src/lib/ai-provider.ts` — one `generateText(system, user, opts)` over five providers:

| `AI_PROVIDER` | Key env | Model env | Default model | Transport |
| --- | --- | --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | `claude-opus-4-1` | `/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01` |
| `openai` | `OPENAI_API_KEY` | `OPENAI_MODEL` | `gpt-4o-mini` | `/chat/completions` |
| `gemini` | `GEMINI_API_KEY` | `GEMINI_MODEL` | `gemini-2.0-flash` | `v1beta/models/{model}:generateContent?key=` |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` | `anthropic/claude-3.5-sonnet` | `openrouter.ai/api/v1/chat/completions` |
| `custom` | `AI_API_KEY` | `AI_MODEL` | `gpt-4o-mini` | `AI_BASE_URL` (default Groq) |

- `AI_PROVIDER=auto` (default) picks the **first provider with a key present**, in table order.
- Model resolution: provider-specific env → `AI_MODEL` → that provider's default.
- `GET /api/ai/config` exposes the resolved provider, model, and base URL (middleware-protected) — the Settings page shows it.
- All responses are normalised and force-parsed by `parseAIJSON()`, which strips ` ```json ` fences. Network failures, non-2xx, and empty responses all throw descriptive errors.

The worker is a **separate** concern: `ai-worker/` never calls a cloud LLM. Local ASR/VL/Mistral handle video, and cloud providers handle only the text repurposing step.

---

## 🗄️ Database

Run these in order in the Supabase SQL editor.

### `src/components/supabase/schema.sql` — base

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | Profile mirror of the auth user | `id` (PK = auth uid), `email` UNIQUE, `full_name`, `avatar_url`, `country_code`, `timezone` |
| `videos` | Uploads + processing state | `user_id` FK CASCADE, `title`, `original_url`, `storage_path`, `duration_seconds`, `transcript`, `status`, `processing_started_at`, `processing_ended_at`, `error_message` |
| `repurposed_content` | Generated assets | `video_id` FK CASCADE, `content_type`, `content_text`, `content_url`, `is_edited`, `edited_by_user_at`, `posted_to_platform`, `posted_at` |
| `subscriptions` | Billing state | `user_id`, `plan`, `status`, `payment_method`, `payment_id`, `recurring_id`, period dates, `cancel_at_period_end`, `monthly_price`, `currency` · `UNIQUE(user_id, recurring_id)` |
| `payments` | Ledger | `user_id`, `amount`, `currency`, `payment_method`, `external_payment_id`, `status`, `invoice_url`, `receipt_url`, `error_message` |
| `usage_logs` | Monthly metering | `video_processed_count`, `api_calls`, `storage_used_mb`, `month` · `UNIQUE(user_id, month)` |
| `api_keys` | Hashed server keys | `key_hash` UNIQUE, `name`, `last_used_at`, `is_active` |

**RLS:** enabled on all seven. `users` (select/update own), `videos` (full CRUD own), `subscriptions` (select/insert own — service role writes), `repurposed_content` (full CRUD via `video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())`). `payments`, `usage_logs`, `api_keys` are enabled with **zero policies** — service-role only, by design.

**Storage:** private `videos` bucket with INSERT/SELECT/DELETE policies gated on `bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]` — the first path segment must be the owner's uid.

Indexes: `idx_videos_user_id`, `idx_subscriptions_user_id`, `idx_repurposed_content_video_id`, `idx_payments_user_id`. Extension: `uuid-ossp`.

### `src/components/supabase/ai_pipeline.sql` — additive migration

**Run this second.** Adds two columns and three tables; drops nothing and weakens no existing policy.

| Change | Detail |
| --- | --- |
| `videos.processing_stage` | `VARCHAR(50) NOT NULL DEFAULT 'uploaded'` |
| `videos.transcript_segments` | `JSONB` — `{ language, segments[], words[] }` |
| `clip_candidates` | `video_id`, **`user_id NOT NULL`**, `start_time`, `end_time`, `score`, `hook_score`, `story_score`, `information_score`, `emotion_score`, `visual_score`, `context_independence`, `reason` |
| `generated_clips` | `video_id`, `user_id`, `candidate_id` (FK `ON DELETE SET NULL`), `storage_path`, `thumb_path`, `duration`, `aspect_ratio` (default `9:16`), `caption_style`, `status` (default `ready`) |
| `video_analysis_jobs` | `job_id` UNIQUE, `video_id`, `user_id`, `status`, `stage`, `error_code`, `error_message` |
| `generated_clips` bucket | Private, same `{userId}/...` first-segment ownership policies |

RLS: 4 policies each on `clip_candidates` and `generated_clips` (select/insert/update/delete, owned through the video). `video_analysis_jobs` gets **select + insert only** — job progress is written by the service role, never by a client. Indexes: `idx_clip_candidates_video_id`, `idx_generated_clips_video_id`, `idx_video_analysis_jobs_video_id`, `idx_videos_processing_stage`.

---

## 🚀 Quick start

### 1. Web app

```bash
npm install
cp .env.example .env.local      # then fill in Supabase + at least one AI key
npm run dev                     # http://localhost:3000
```

### 2. Database

In the Supabase SQL editor, run `src/components/supabase/schema.sql`, then `src/components/supabase/ai_pipeline.sql`. Without the second file the worker's clip stages fail — `/api/clips` and the `clip_candidates` / `generated_clips` / `video_analysis_jobs` tables won't exist.

### 3. AI video worker (optional but recommended)

Requires **Python 3.12+**, an **NVIDIA GPU with ≥ 8 GB VRAM**, and **FFmpeg with libass** on `PATH`.

```bash
cd ai-worker
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env          # set AI_WORKER_API_KEY + Supabase service role key
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8741
```

First run downloads ~28 GB of weights
(ASR 4.1 + aligner 1.2 + vision 8.9 + Mistral 14.5). Then set the **matching** `AI_WORKER_URL` + `AI_WORKER_API_KEY` in the root `.env.local`. Leave `AI_WORKER_URL` blank to fall back to the in-app OpenAI-Whisper path. Full reference: [`ai-worker/README.md`](ai-worker/README.md).

### 4. Build & deploy

```bash
npm run build
npm run start
```

---

## 🔑 Environment variables

### Web app (`.env.example`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Browser-safe anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-only; bypasses RLS in all API routes |
| `AI_PROVIDER` | — | `auto` (default) or `anthropic`\|`openai`\|`gemini`\|`openrouter`\|`custom` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | one of | Claude text generation |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | one of | GPT text generation · also Whisper on the fallback path |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | one of | Gemini text generation |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | one of | Any model via OpenRouter |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | one of | Any OpenAI-compatible endpoint (Groq, Together, Ollama, LM Studio…) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | payments | Stripe client key |
| `STRIPE_SECRET_KEY` | payments | Stripe server key |
| `STRIPE_WEBHOOK_SECRET` | payments | Verifies `constructEvent` |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | payments | Razorpay client key |
| `RAZORPAY_KEY_SECRET` | payments | Razorpay server key + webhook HMAC |
| `MAXMIND_ACCOUNT_ID` / `MAXMIND_LICENSE_KEY` | payments | GeoIP2 city lookup → provider choice |
| `NEXT_PUBLIC_APP_URL` | ✅ | Base URL for server-to-server self-calls |
| `INTERNAL_SERVICE_KEY` | ✅ | `x-service-key` for upload → pipeline → repurpose. `openssl rand -hex 32` |
| `AI_WORKER_URL` | worker | e.g. `http://127.0.0.1:8741`. Blank disables the worker path |
| `AI_WORKER_API_KEY` | worker | Bearer token; must equal the worker's `AI_WORKER_API_KEY` |

### Worker (`ai-worker/.env.example`) — 50+ knobs, all optional

| Group | Keys | Defaults |
| --- | --- | --- |
| Server | `AI_WORKER_HOST`, `AI_WORKER_PORT`, `AI_WORKER_API_KEY`, `AI_WORKER_AUTH` | `127.0.0.1`, `8741`, —, `true` |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_VIDEOS_BUCKET`, `SUPABASE_CLIPS_BUCKET`, `SUPABASE_TIMEOUT` | —, —, `videos`, `generated_clips`, `120` |
| Work dir | `AI_WORKER_WORK_DIR`, `AI_WORKER_KEEP_ARTIFACTS` | `ai-worker/work`, `false` |
| FFmpeg | `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` (autodetected on PATH) |
| Render | `RENDER_WIDTH`, `RENDER_HEIGHT`, `RENDER_FPS`, `RENDER_CRF`, `RENDER_AUDIO_BITRATE` | `1080`, `1920`, `30`, `23`, `128k` |
| ASR | `ASR_MODEL`, `ASR_ALIGNER_MODEL`, `ASR_DEVICE`, `ASR_LANGUAGE`, `ASR_MAX_NEW_TOKENS`, `ASR_ENABLE_TIMESTAMPS`, `ASR_ALIGN_CHUNK_SECONDS` | `Qwen/Qwen3-ASR-1.7B-hf`, `Qwen/Qwen3-ForcedAligner-0.6B-hf`, `cuda`, auto, `512`, `true`, `240` |
| Vision | `VISION_MODEL`, `VISION_DEVICE`, `VISION_QUANTIZATION`, `VISION_MAX_NEW_TOKENS` | `Qwen/Qwen3-VL-4B-Instruct`, `cuda`, `8bit`, `256` |
| Mistral | `MISTRAL_MODEL`, `MISTRAL_DEVICE`, `MISTRAL_QUANTIZATION`, `MISTRAL_MAX_NEW_TOKENS` | `mistralai/Mistral-7B-Instruct-v0.3`, `cuda`, `4bit`, `900` |
| Pipeline | `MAX_CLIPS`, `MIN_CLIP_DURATION`, `MAX_CLIP_DURATION`, `MIN_SCORE`, `FRAME_SAMPLE_INTERVAL`, `MAX_VISION_FRAMES`, `VISION_START_OFFSET` | `3`, `20`, `90`, `0.0`, `10`, `12`, `0.0` |
| Captions | `CAPTION_FONT_SIZE`, `CAPTION_FONT_COLOR`, `CAPTION_OUTLINE_COLOR`, `CAPTION_OUTLINE_WIDTH`, `CAPTION_MARGIN_BOTTOM`, `CAPTION_MAX_CHARS`, `CAPTION_STYLE_NAME` | `72`, `FFFFFF`, `000000`, `3`, `120`, `32`, `Krix` |
| HuggingFace | `HF_HOME`, `HF_TOKEN` | —, — |

---

## 🔌 API reference

### Auth
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | public | Create account + auto sign-in |
| `POST` | `/api/auth/login` | public | Password sign-in |
| `POST` | `/api/auth/logout` | session | Sign out + clear cookies |
| `POST` | `/api/auth/upsert-profile` | session | Upsert profile from OAuth metadata |

### Video & content
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/upload` | session | Upload file (≤ 2 GB) → storage + `videos` row + trigger |
| `POST` | `/api/pipeline/process` | `x-service-key` | Start the worker pipeline (`202`) |
| `POST` | `/api/process-video` | `x-service-key` | Legacy in-app Whisper fallback path |
| `POST` | `/api/repurpose` | `x-service-key` or session | Generate the 5 text formats from the transcript |
| `GET` | `/api/videos` | session | List own videos |
| `GET`/`DELETE` | `/api/videos/[videoId]` | session | Fetch / delete one video |
| `GET` | `/api/clips?videoId=` | session | Rendered clips + 1 h signed URLs |
| `GET` | `/api/content` | session | List repurposed content |
| `PATCH`/`DELETE` | `/api/content/[id]` | session | Edit / delete one asset |
| `GET` | `/api/analytics` | session | KPIs + 14-day posts series |
| `GET` | `/api/ai/config` | session | Resolved AI provider status |

### Billing
| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/payments/provider` | public | Geo-detected provider for a country/IP |
| `POST` | `/api/payments/create` | session | Create checkout for a plan |
| `POST` | `/api/payments/stripe` · `/api/payments/razorpay` | session | Provider-specific create (superseded by `/create`) |
| `POST` | `/api/payments/verify` | session | Confirm a payment |
| `POST` | `/api/payments/webhook` | provider signature | Sync subscriptions (both providers) |
| `GET`/`POST` | `/api/subscription` | session | Read / cancel subscription |
| `PUT`/`PATCH` | `/api/subscription/payment-method` | session | Set Stripe default payment method |

---

## 📁 Project structure

```
krix/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Landing page (11 sections)
│   │   ├── layout.tsx · globals.css
│   │   ├── auth/                    # signup, login, OAuth callback
│   │   ├── pricing/                 # Plans + geo-aware payment selector
│   │   ├── dashboard/               # 11 routes: center, upload, videos, content/[videoId],
│   │   │                            #   projects, calendar, analytics, inspiration, api, team, settings
│   │   └── api/                     # 23 route handlers (auth · upload · pipeline · clips ·
│   │                                #   repurpose · videos · content · analytics · payments · subscription · ai)
│   ├── components/
│   │   ├── landing/                 # Hero, CTA, TrustedBy, Capabilities, Solutions, HowItWorks,
│   │   │                            #   Pricing, Testimonials, FAQ, Footer, Reveal, SpotlightCard,
│   │   │                            #   BlackHoleBackground, VideoLinkCTA, icons
│   │   ├── dashboard/               # Sidebar, Navbar, CommandPalette (⌘K), VideoUpload, VideoLibrary,
│   │   │                            #   RepurposedContent, ContentEditor, DownloadButton, StatusPill,
│   │   │                            #   PipelineProgress, GeneratedClips, Sparkline, PageHeader, icons
│   │   ├── auth/                    # SignupForm, LoginForm, GoogleSignIn, ProtectedRoute
│   │   ├── supabase/payment/        # PaymentSelector, StripeCheckout, RazorpayCheckout
│   │   ├── supabase/                # schema.sql, ai_pipeline.sql
│   │   └── ui/                      # Button, Card, Input, Textarea, Modal, Toast, Skeleton, Loading, ComingSoon
│   ├── lib/                         # supabase, auth-utils, ai-provider, transcribe, worker, stripe,
│   │                                #   razorpay, geoip, api-client, hooks, utils
│   ├── types/                       # User, Video, TranscriptSegments, ClipCandidate, GeneratedClip,
│   │                                #   RepurposedContent, Subscription, Payment, Plan
│   └── middleware.ts                # Route guard + service-key bypass
├── ai-worker/                       # Python/FastAPI video pipeline — see ai-worker/README.md
│   ├── app/
│   │   ├── main.py                  # FastAPI app + 7 endpoints + error handler
│   │   ├── config.py                # 50+ env-driven settings, PipelineError, Segment
│   │   ├── pipeline.py              # Orchestrator (6 stages)
│   │   ├── models/                  # manager.py (ModelManager), asr.py, vision.py, mistral.py
│   │   ├── services/                # audio, transcription, video_analysis, clip_detection,
│   │   │                            #   captions, rendering, storage
│   │   └── schemas/pipeline.py      # Pydantic request/response models
│   └── tests/                       # 78 pytest tests
├── AI_IMPLEMENTATION_PLAN.md        # Original audit + architecture plan
├── AI_PIPELINE_STATUS.md            # On-machine verification report (2026-09-22)
└── DEVELOPMENT.md
```

---

## 🧪 Tests & verification

```bash
npx tsc --noEmit          # ✅ clean
npm run lint              # ✅ No ESLint warnings or errors
cd ai-worker && .\.venv\Scripts\python -m pytest -q
```

**78 tests** (77 passed here, 1 skipped — the real-GPU ASR test runs when CUDA is present and was previously verified on this machine):

| File | Covers |
| --- | --- |
| `test_api_auth.py` | Bearer auth: missing/valid/invalid token, `changeme` fail-closed, error-code registry |
| `test_asr_segments.py` | Word→segment merging, 0.35 s gap threshold, flat-segment fallback |
| `test_captions.py` | ASS/SRT time formats, RGB→BGR colour conversion, wrapping, `{}` neutralisation |
| `test_clip_validation.py` | Bounds, min/max duration, min score, overlap dedupe, `max_clips` clamp, chronological re-sort |
| `test_commands.py` | FFmpeg/ffprobe argv construction, Windows path escaping in `subtitles=` filters |
| `test_storage_errors.py` | Ownership enforcement (`NOT_FOUND` on wrong owner), `PipelineError` round-trip, all 16 error codes documented |
| `integration/test_real_ffmpeg.py` | Real ffmpeg: probe, audio extraction, frame sampling, 9:16 render, caption burn-in pixel diff |
| `integration/test_real_asr_gpu.py` | Real `Qwen3-ASR-1.7B` CUDA transcription |

**Manual E2E result** (39.9 s test video built from real MLK speech samples + 6 slides, on an RTX 4060 Laptop 8 GB):

| Step | Result |
| --- | --- |
| ffprobe | ✅ duration 39.911 s, 1280×720, 24 fps, audio + video |
| Audio → 16 kHz WAV | ✅ 1.28 MB |
| Frame sampling | ✅ 4 frames at 0/10/20/30 s |
| **Qwen3-ASR on CUDA** | ✅ 21.7 s model load, ~5 s transcribe, `language=English`, correct opening line |
| ASS caption build | ✅ real `Dialogue:` events |
| **9:16 render + burn** | ✅ 1080×1920@30 H.264, 17 s; burn confirmed by pixel diff (mean 3.9 in the caption band) |
| `validate_and_rank` | ✅ correctly dropped sub-20 s candidates |
| FastAPI auth | ✅ `/health` 200 (`cuda_available: true`), bad key 401, good key 200 |

---

## ⚠️ Known limitations (honest status)

**Blocking the full pipeline today**

1. **`ai_pipeline.sql` has not been applied** to the Supabase project. Without it, `videos.processing_stage` is a `42703 does not exist` error, `clip_candidates` / `generated_clips` / `video_analysis_jobs` return `404`, and the `generated_clips` bucket is missing — so the worker's persistence stages and `GET /api/clips` cannot work. Run the file; the service-role key cannot execute DDL.
2. **Two large models were never downloaded** — `Qwen/Qwen3-VL-4B-Instruct` (~8.9 GB) and `mistralai/Mistral-7B-Instruct-v0.3` (~14.5 GB) — so `analyzing` and `finding_clips` are coded and wired but have not been executed. The forced aligner (~1.2 GB) is also incomplete, so word timestamps currently fall back to flat segments.
3. **The worker never triggers `/api/repurpose`.** The worker's `/pipeline` returns immediately, so Next.js has no completion hook. With the worker configured, clips are produced but `repurposed_content` is not auto-generated — call `POST /api/repurpose` (service key) once the video is `completed`, or add a worker→app callback. On the legacy path this happens automatically.

**Scaffolded, not functional**

4. **Payments cannot complete** — all 6 plan IDs are `price_xxxxx` / `plan_xxxxx`. Create real products and paste the IDs into `src/lib/stripe.ts` and `src/lib/razorpay.ts`.
5. **5 dashboard pages are static mockups** — `calendar`, `projects`, `team`, `api`, `inspiration` render hardcoded data and import neither `supabase` nor `apiClient`.
6. **No remote-URL ingest.** The Hero/VideoLinkCTA "paste a link" inputs have no server route; only file upload is implemented.
7. **No API-key issuance.** The `api_keys` table exists with RLS but no route creates or validates keys, so the "API & MCP" page is documentation only.
8. **Stripe `/verify` performs no signature check** — it marks a subscription `active` from the request body. Only the webhook path is signature-verified. Do not rely on `/verify` for security.
9. **Landing pricing is static** — the cards are hardcoded and not read from `STRIPE_PLANS`.

**Correctness & performance notes**

10. `apiClient.login()` targets `/api/auth/login`, which uses a cookie-less anon client and cannot set cookies. Login works because `LoginForm` calls Supabase directly — but don't rely on the route.
11. The `x-user-id` header fallback in `getUserId()` is a dead branch that always returns `null`, which makes the matching axios interceptor a no-op. Server-to-server identity comes from `x-service-key` only.
12. `ASR_MAX_NEW_TOKENS=512` caps generation for the **whole** audio file — long videos will be truncated. Raise it or chunk for production-length content.
13. Alignment chunks use a ~2.5 words/second heuristic to slice the transcript per chunk, not real text/audio matching. Duplicated or garbled words are possible at chunk boundaries.
14. `video_analysis` calls `gc.collect()` + `empty_cache()` **after every sampled frame** (the `len(frames) >= 4` guard tests the total count, not the loop index) — a real slowdown on longer videos.
15. `ModelManager`'s lock guards *loading*, not inference. Two concurrent jobs can evict each other's model. There is no job queue or concurrency limit.
16. The four debug endpoints are `async def` and run blocking model/ffmpeg work on the event loop, so `/health` is unresponsive while one runs. Only `/pipeline` correctly offloads to a thread.
17. `render_clip` raises a bare `FileNotFoundError` for a missing output path, which escapes the structured error contract as a raw 500.
18. `POST /transcribe` returns an unhandled `ValidationError` (not the structured contract) when no word timestamps exist, because the flat fallback segment has `end = 0`.
19. Unused npm dependencies: `@clerk/nextjs`, `react-hook-form`, `zod`, `@anthropic-ai/sdk`.
20. Type drift between `src/types/index.ts` and the schema: `Subscription.status` omits `pending` (which both checkout routes insert), `Payment.payment_id` vs the column `external_payment_id`, and `content_type` includes `thumbnails`/`hooks` which are never written.
21. `cancel_at_period_end: true` is set at the same time as an immediate provider cancel — contradictory. Pick one.
22. Rendering is **center-crop only**. No smart reframing, subject tracking, B-roll, or caption template variants. `min_duration`/`max_duration`/`max_clips` in `/find-clips` are hardcoded and override the config.

**⬜ Planned, not built**

Social publishing/scheduling, AI producer/editor, B-roll insertion, smart reframe, Premiere/DaVinci XML export, thumbnail generation, brand templates, real team collaboration, the MCP server, and model fine-tuning (the Mistral wrapper notes a future Krix clip-quality dataset + LoRA/QLoRA).

---

## 🌐 Deployment

```bash
npm i -g vercel
vercel login
vercel
```

Set every env var in the Vercel dashboard. Configure webhooks:

```bash
# Stripe
stripe listen --forward-to https://yourdomain.com/api/payments/webhook

# Razorpay: Dashboard → Settings → Webhooks
#   → https://yourdomain.com/api/payments/webhook
```

The worker is **not** deployed to Vercel — it is a stateful GPU service. Run it on your own machine or a GPU host and set `AI_WORKER_URL` to a reachable address. If you leave `AI_WORKER_URL` blank, uploads fall back to the in-app OpenAI-Whisper + repurpose path, which needs only `OPENAI_API_KEY`.

---

## 📚 Further reading

| Document | Contents |
| --- | --- |
| [`ai-worker/README.md`](ai-worker/README.md) | Worker setup, endpoint reference, security notes |
| [`AI_IMPLEMENTATION_PLAN.md`](AI_IMPLEMENTATION_PLAN.md) | Original codebase audit, VRAM strategy, staged build plan |
| [`AI_PIPELINE_STATUS.md`](AI_PIPELINE_STATUS.md) | On-machine verification report with per-component evidence |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Local development notes |

---

© 2026 **Kashinadh Nair** — Krix. All rights reserved.
