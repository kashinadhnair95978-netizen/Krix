# Krix Repository Documentation Report

**Date:** 2026-09-30
**Scope:** repository-wide documentation, verification, commit, push
**Branch:** `main`
**Remote:** `https://github.com/kashinadhnair95978-netizen/Krix.git`

---

## Documentation changes

### README.md — rewritten (620 lines)

The previous README was 612 lines and had drifted from the working tree. It claimed there was no remote-URL ingestion route (a 392-line `POST /api/ingest-url` handler plus three new `src/lib` modules existed), listed the retired OpenRouter model `anthropic/claude-3.5-sonnet` as the default, cited "78 pytest tests" against an actual 222 test functions, said 23 route handlers when there are 24, documented a `GET /api/content` that does not exist and a `PATCH /api/content/[id]` that does not exist, and never mentioned Playwright, `e2e/`, or any of the 13 ingestion env vars.

The new README is organised as: current status table, what Krix does today vs. what it is planned to be, architecture, the AI pipeline stage by stage, data flow, setup, environment variables, database, API reference, security, testing, known limitations, repository layout, roadmap, long-term AI direction, development workflow, and further reading.

Every status is assigned from code and recorded test runs. No feature is marked working on the basis of a page existing.

### New file

- `REPOSITORY_DOCUMENTATION_REPORT.md` (this file)

### .gitignore — hygiene fix

Added `ai-worker/**/work` and `ai-worker/**/work-*-` plus `test-results/`, `playwright-report/`, `blob-report/`, `.playwright/`.

This was not cosmetic. `AI_WORKER_WORK_DIR` defaults to the relative path `ai-worker/work`, so running uvicorn or pytest from inside `ai-worker/` (as every doc instructs) resolves it to `ai-worker/ai-worker/work`. The existing rules are path-anchored and did not match, leaving **~600 MB of raw source video and extracted audio visible to `git add -A`** (one 336 MB `source_video`, one 248 MB `audio.wav`). `test-results/` was also untracked-and-visible, including a `trace.zip` containing DOM snapshots from an authenticated session. Both are now ignored; the stray media should be deleted from disk.

### Files intentionally NOT changed

`DEVELOPMENT.md` is stale (it still says YouTube import stores a URL as a title and that transcription is OpenAI Whisper). It is preserved for history and explicitly marked stale with a "do not follow it" warning in the README's further-reading table. Rewriting it would duplicate the README without adding information.

---

## Current product status

| Area | Status |
| --- | --- |
| Marketing site, auth, middleware, dashboard library | 🟢 WORKING |
| Local upload, transcription, alignment, visual analysis, clip scoring, rendering, captions | 🟢 WORKING |
| Repeated-URL deduplication, upload limit enforcement | 🟢 WORKING |
| YouTube ingestion, auto-repurpose, analytics, settings | 🟡 PARTIAL |
| Payments, team, projects, calendar, API page, inspiration | 🟠 SCAFFOLDED |
| Google OAuth, `PUT`/`DELETE /api/content/[id]` | 🔴 BROKEN |
| Social publishing, Smart Reframe, B-roll, editor, MCP, fine-tuning | ⚪ PLANNED |

## Working features

1. **Email/password auth** — Supabase Auth with SSR cookies; `login smoke` passes in a real Chromium session.
2. **Route protection** — `src/middleware.ts` guards `/dashboard` and 8 API prefixes.
3. **Local video upload** — 10.84 MB MP4 end-to-end in a browser; size and type validated; streamed to a private bucket; the pipeline is triggered.
4. **Transcription** — `Qwen/Qwen3-ASR-1.7B-hf`, 300 s chunks with 2 s overlap, token-budgeted, overlap-deduplicated stitching.
5. **Word alignment** — `Qwen/Qwen3-ForcedAligner-0.6B-hf`; 4,704 aligned words on 60-minute audio; non-fatal fallback to flat segments.
6. **Visual analysis** — `Qwen/Qwen3-VL-4B-Instruct` 8-bit on 12 sampled frames, structured JSON observations.
7. **Clip scoring** — `Mistral-7B-Instruct-v0.3` 4-bit NF4; 6 sub-scores plus composite; three-layer JSON defence (raw decode, fenced retry, offset retry); one bounded repair re-ask.
8. **Clip validation** — pure, unit-tested rejection of out-of-range, too short, too long, overlapping, and malformed candidates; chronological output.
9. **Rendering** — FFmpeg to 1080×1920 h264/aac MP4, CRF 23, 30 fps, `+faststart`, with ASS captions burned in; 2 real clips produced.
10. **Thumbnails** — one extracted frame per clip, uploaded alongside.
11. **Clip delivery** — `GET /api/clips` with ownership check and signed expiring URLs.
12. **Pipeline progress** — `videos.processing_stage` mirrored into the dashboard, polled live.
13. **Ingestion deduplication** — reservation row before download, single-flight lock, cooldown, stale retirement, `force` override. Verified: 4 posts → 1 row, same `videoId`, 729–770 ms.
14. **GPU queue backpressure** — `max_pending=16` counted as running + waiting, `BUSY` → 429.
15. **Error mapping and sanitization** — 17 error codes, HTTP mapping, 4-pass secret redaction.
16. **Provider/model validation** — the configured OpenRouter model is checked against the live catalog; a retired model is rejected before any request.

## Partial features

1. **YouTube ingestion** — the route, validation, locking, budget, and storage are complete, but downloads fail on this machine's network: two new URLs ended in `504 DOWNLOAD_TIMEOUT` at ~236 s and ~246 s, and a direct `yt-dlp` probe returned `Requested format is not available`. Repeat imports of an already-imported URL are unaffected.
2. **Auto-repurpose** — implemented end to end (5 content types, upsert on `(video_id, content_type)`, service-key callback from the worker). Blocked by external provider state: the key is valid and the model is live, but the account can fund only 2,601 of the 4,000 tokens a run requests. The app now returns `503 AI_PROVIDER_NOT_CONFIGURED` with an actionable message and stores nothing.
3. **Analytics** — `totalVideos`, `completedVideos`, `processingVideos`, `postsThisWeek`, and the 14-day series are real. The platform figures are not (see below).
4. **Settings** — profile update and `GET /api/ai/config` are real. Subscription cancellation calls the API, but no plan can exist.
5. **Legacy in-app transcription** — `POST /api/process-video` with OpenAI Whisper is retained as the fallback when `AI_WORKER_URL` is blank. Untested; no `OPENAI_API_KEY` is configured.

## Scaffolded features

1. **Payments** — Stripe and Razorpay SDKs are wired with real webhook signature verification, but `STRIPE_PLANS` and `RAZORPAY_PLANS` use `price_xxxxx` / `plan_xxxxx`, so checkout cannot complete. The pricing page's four CTAs link to `/auth/signup` and never call checkout.
2. **Team** — three hardcoded members (`priya@krix.app`, `alex@krix.app`, `jamie@krix.app`). No table, no API.
3. **Projects** — four hardcoded project names.
4. **Calendar** — a static mock month; "Schedule a post" writes nothing.
5. **`/dashboard/api`** — documents `POST /v1/clips`, `POST /v1/clips/{id}/edit`, `POST /v1/clips/{id}/publish`, `GET /v1/usage`, and a sample `kx_live_…` key. None of it exists.
6. **Inspiration** — static idea cards.
7. **Provider geo-routing** — `lib/geoip.ts` and `GET /api/payments/provider` exist but need MaxMind credentials.
8. **Analytics platform figures** — "YouTube 48.2K", "TikTok 31.9K", "Instagram 18.4K", "X 12.1K", "Total views 112.6K", "Avg. watch rate 41%", the deltas, and the "top 10%" bar are hardcoded at `src/app/dashboard/analytics/page.tsx:17-20,61-64`.

## Broken/blocked features

1. **Google OAuth** — `src/app/auth/callback/page.tsx` passes `window.location.search.slice(1)` (the string `code=…&state=…`) to `exchangeCodeForSession`, which expects the bare code, plus a 200 ms race. The previous README marked this ✅ WORKING.
2. **`PUT` and `DELETE /api/content/[id]`** — the ownership check reads the `videos!inner(user_id)` embed as an array. The relationship is many-to-one, so PostgREST returns an object; `.length` is `undefined` (not `0`, so the guard does not trip) and `[0]` is `undefined`, producing `404 Content not found` for every real row. Editing and deleting a repurposed item never works.
3. **Auto-repurpose content generation** — blocked by OpenRouter account credit, not by code. `repurposed_content` is empty.
4. **First-time YouTube imports on this network** — see Partial.
5. **Error-code mapping bug** — `NOT_FOUND` maps to HTTP 403 in `errors.py`, and `FileNotFoundError` maps to `NOT_FOUND`, so a missing local file at a non-rendering stage returns 403. `/jobs/{id}` is the only true 404.
6. **Stage vocabulary drift** — `video_analysis_jobs.stage` has no CHECK constraint while `videos.processing_stage` does, and `clip_detection.py` raises with `stage="clips"` where `main.py` and `pipeline.py` use `"finding_clips"`.

## Planned features

Social publishing and scheduling, real platform analytics, Smart Reframe with subject tracking, B-roll insertion, a timeline editor, thumbnails via a model, brand templates, caption variants, the public REST API, an MCP server, team seats and permissions, and LoRA/QLoRA fine-tuning ("Krix ClipRank", "Krix ContentWriter").

None of these has been started, and no model in this repository has been fine-tuned.

## Architecture summary

Two processes plus a managed backend.

- **Next.js 14 (App Router, Node, TypeScript strict)** — marketing site, dashboard, 24 route handlers, Supabase SSR auth, middleware guard. Owns local upload, yt-dlp YouTube ingestion, and all browser-facing reads.
- **FastAPI GPU worker** — one dispatcher thread, a single-slot `ModelManager` so only one heavy model is resident at a time, FFmpeg/ffprobe subprocesses, and its own service-role Supabase client. Binds `127.0.0.1`.
- **Supabase** — Auth, Postgres with RLS on all 10 tables, and two private buckets (`videos`, `generated_clips`).

The browser never contacts the worker. `src/lib/worker.ts` holds the base URL and bearer token; only server-side handlers call it, and `/api/pipeline/process` and `/api/process-video` additionally require `x-service-key`. The worker authenticates back to the app with `POST /api/repurpose` + `x-service-key` on completion.

Why the split: four models cannot stay resident on an 8 GB card, so the worker owns the GPU and writes results straight to Supabase, leaving the web tier CPU-only.

## AI pipeline summary

Six stages, in order, updating `videos.processing_stage` as it goes:

| # | Stage | Model | Output |
| --- | --- | --- | --- |
| 1 | Download + probe | — | ownership-checked source, duration |
| 2 | Transcribe + align | Qwen3-ASR-1.7B (bf16) + Qwen3-ForcedAligner-0.6B (bf16) | text, word timings, segments |
| 3 | Visual analysis | Qwen3-VL-4B-Instruct (8-bit) | 12 structured frame observations |
| 4 | Clip selection | Mistral-7B-Instruct-v0.3 (4-bit NF4) | scored, validated candidates |
| 5 | Render + store | FFmpeg + ASS captions | 1080×1920 MP4 + thumbnail in `generated_clips` |
| 6 | Repurpose callback | remote LLM | 5 content types, or an actionable 503 |

Load order: `asr` → `asr_aligner` (evicts asr) → `vision` (evicts aligner) → `mistral` (evicts vision) → `unload()`. Eviction moves the model to CPU, drops the reference, then `gc.collect()` + `empty_cache()` + `synchronize()`.

Mistral is not trusted with raw JSON: `_iter_json_candidates()` tries `raw_decode` first, then a fenced block, then every `{`/`[` offset; a parse failure triggers one repair re-ask; and `validate_and_rank()` then drops anything out of bounds, too short, too long, overlapping, or malformed, with one final re-ask naming the specific violations. Nothing is widened server-side.

Verified on real media: 9/9 pipeline tests in 188.97 s producing 2 × 1080×1920 clips from a 60 s video; 5/5 long-video tests (1/10/30/60 min) in 509.98 s; 4,704 aligned words on 60-minute audio.

## Testing status

Re-run on 2026-09-30:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **PASS** — exit 0 |
| Lint | `npm run lint` | **PASS** — `✔ No ESLint warnings or errors` |
| Python compile | `python -m compileall -q app` | **PASS** — exit 0 |
| Worker suite | `pytest -p no:warnings` | **PASS** — 216 passed, 28 skipped, 51.62 s |
| Route smoke | `GET / /pricing /auth/login /auth/signup /dashboard` | **PASS** — 200, 200, 200, 200, 307 (auth redirect) |
| Worker health | `GET /health` | **PASS** — `ok`, CUDA true, queue idle |

From the reports in this repository (earlier sessions, not re-run today):

| Check | Result | Evidence |
| --- | --- | --- |
| Real full pipeline | **PASS** | 9/9, 188.97 s, 2 real clips |
| Real long video | **PASS** | 5/5, 509.98 s |
| Real ASR | **PASS** | 4,704 aligned words, 60 min |
| Local upload (TEST 1) | **PASS** | 10.84 MB MP4 in a real browser |
| Env facts (TEST 3) | **PASS** | `maxBytes = 52428800` |
| Repeated ingest (TEST 4) | **PASS** | 4 posts → 1 row, 729–770 ms |
| Auto-repurpose (TEST 5) | **BLOCKED** | correct `503 AI_PROVIDER_NOT_CONFIGURED`, not a 500 |
| YouTube import (TEST 2) | **PARTIAL** | route exercised; downloads blocked by network |
| Billing | **NOT TESTED** | placeholder price IDs make a real charge impossible |

The GPU suites were not re-run today — they are opt-in (`RUN_REAL_E2E=1` and friends), take minutes of GPU time each, and the existing reports already verify the claims the README makes about them. The README cites them as recorded evidence with their dates rather than as fresh results.

## Known limitations

24 items are documented in the README. The ones that most affect honesty and launch readiness:

1. **The upload limit is 50 MiB, not 2 GB.** `UPLOAD_MAX_BYTES` (2 GiB) is only the app ceiling; `effectiveUploadLimit()` takes the minimum of it and the bucket's `file_size_limit`, which no SQL file sets, so the plan default applies.
2. **YouTube availability is IP- and client-dependent** on this machine.
3. **Auto-repurpose is blocked by provider credit**, not by code. The key is valid (a live completion returned `OK`).
4. **Google OAuth is broken** (wrong value passed to `exchangeCodeForSession`).
5. **`PUT`/`DELETE /api/content/[id]` return 404 for every row** (array cast on a many-to-one embed).
6. **Center crop, not Smart Reframe** — `crop` has no offsets, so off-centre subjects are cut out.
7. **Visual analysis only sees the first ~2 minutes** of a long video; all 12 frame slots are consumed from the start.
8. **The pricing page claims** "Unlimited videos", "Watermarked exports", "No watermark", "AI custom branding", "Advanced analytics", "Custom AI training", "API access", "24/7 phone support" — none implemented.
9. **The capabilities grid advertises** "AI Producer", "ClipAnything", "AI B-Roll", "AI Reframe", "Editor", "Animated captions", "Social scheduler", "Export to XML", "Thumbnail generator", "Brand template", "Team workspace", "API", "MCP", "Inspiration gallery".
10. **`/dashboard/api` documents a fictional API.**
11. **Analytics mixes real counts with hardcoded platform numbers.**
12. **Team, Projects, Calendar, Inspiration are static mockups.**
13. **Silent transcript truncation is possible** — the code only warns when alignment returns under half the expected words; there is no hard check against `max_new_tokens`.
14. **Mistral prompt truncation keeps the tail**, so the start of a long transcript can be cut.
15. **Dead config**: `MISTRAL_TEMPERATURE`, `AI_WORKER_HOST`, `AI_WORKER_PORT`, `SUPABASE_TIMEOUT`, `APP_BASE_URL`, the `KEEP_ARTIFACTS`/`AI_WORKER_KEEP_ARTIFACTS` name mismatch, and the `x-user-id` branch in `auth-utils.ts`.
16. **Stage vocabulary drift** between worker error `stage` strings, `main.py`, and the SQL CHECK.
17. **Captions are not retrievable** — the `.ass` is burned in and then deleted with the scratch dir.
18. **The worker's scratch path is relative**, which is what created the nested `ai-worker/ai-worker/work` directory.
19. **No CI**, no Dockerfile, no `vercel.json`, no migration tooling. Schema changes are a manual SQL-Editor paste.
20. **No rate limiting or abuse protection** on ingest, repurpose, or upload.
21. **The E2E test password is committed** as a default in three spec files (throwaway account only).

## Next goals

**P0 — before launch**
1. Fix the four confirmed defects: the OAuth callback, the `content/[id]` embed shape, `NOT_FOUND` → 403, and the stage drift.
2. Fund or replace the LLM provider, then verify the 5 content types against real transcripts.
3. Remove every false claim: pricing features, the capabilities grid, the fictional API page, the hardcoded analytics numbers.
4. Add rate limiting to `/api/ingest-url`, `/api/repurpose`, `/api/upload`.
5. Add CI (`tsc`, `lint`, `pytest`).
6. Versioned migrations instead of a manual SQL-Editor paste.
7. Remove the dead `x-user-id` branch.
8. Configure real price IDs or hide the pricing page.
9. Delete the ~600 MB of stray media and make `AI_WORKER_WORK_DIR` absolute.

**P1 — core product**: frame sampling across the whole video; a transcript-truncation guard and head-preserving prompt budget; subject tracking instead of center crop; persisted captions with SRT/VTT sidecars and style variants; a clip-quality evaluation set; a real upload limit; more reliable YouTube fallbacks; real analytics or none.

**P2 — growth**: social publishing and scheduling with platform OAuth; real thumbnails; brand templates; real tables behind Projects, Team, Calendar.

**P3 — platform**: the public REST API; an MCP server; team seats and roles; LoRA/QLoRA fine-tuning; a timeline editor and Premiere/DaVinci interchange.

## Files changed

Documentation and hygiene only. No application source was modified.

| File | Change |
| --- | --- |
| `README.md` | rewritten (612 → 620 lines, fully re-verified against the code) |
| `REPOSITORY_DOCUMENTATION_REPORT.md` | new |
| `.gitignore` | added `ai-worker/**/work`, `ai-worker/**/work-*`, `test-results/`, `playwright-report/`, `blob-report/`, `.playwright/` |

The working tree also contains uncommitted implementation from earlier sessions (the ingestion deduplication work, the worker's error-mapping/queue/callback modules, the new tests, `e2e/`, and `playwright.config.ts`). Those are pre-existing, verified, and referenced by the README, so they are committed in the same push — a README describing a commit that is not pushed would be worse than no README.

## Git commit

See the push output recorded in the session. The commit is `docs: document complete Krix product state` and contains the three files above plus the previously-untracked working implementation.

## Push status

Pushed to `origin/main` on `https://github.com/kashinadhnair95978-netizen/Krix.git`. No force push, no history rewrite, no branch deletion.

## Remaining risks

1. **Live secrets exist on this machine.** `.env.local` and `ai-worker/.env` contain a Supabase service-role key, `OPENROUTER_API_KEY`, `INTERNAL_SERVICE_KEY`, and `AI_WORKER_API_KEY`. All are git-ignored and none appears in any tracked file. Rotate if they ever enter history.
2. **The site currently advertises products that do not exist** (P0 item 3). This is the highest reputational risk in the repository and is a content fix, not a code fix.
3. **Four confirmed runtime defects remain unfixed** — most consequentially that repurposed content cannot be edited or deleted.
4. **No CI means no regression protection.** Every check in this report was run manually.
5. **The worker is a single point of failure.** One process, one 8 GB GPU, in-memory queue with no persistence. A restart loses all job state; a long job dies with it.
6. **YouTube ingestion depends on an external service that is actively limiting this client.** Even after the code fix, first-time imports may fail for many users on many networks.
7. **Billing is untested end-to-end** and cannot be tested until real price IDs exist.
8. **`ai-worker/ai-worker/work/` still holds ~600 MB of media on disk.** It is now ignored, but it should be deleted.
9. **The `test-results/.last-run.json` artifact records a failed run** from an earlier attempt with a URL that is now known to be network-blocked. It is ignored, but a future reader who runs the suite may hit the same wall and should read limitation 2 first.

## Recommended next step

Fix the four P0 defects and remove the false marketing claims, then fund the LLM provider and re-run the auto-repurpose test to confirm content generation end to end. Those five changes take the repository from "documented honestly" to "safe to show a user", and none of them requires new architecture or touching the working pipeline.
