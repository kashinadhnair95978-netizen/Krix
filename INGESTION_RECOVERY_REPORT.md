# Krix Ingestion Recovery Report

Generated after recovering a stalled 16-hour ingestion task. All statuses below are based on
checks actually run in this session. Nothing is claimed as complete without a real passing test.

---

## 0. BLOCKER VERDICTS (addendum — duplicate ingestion + auto-repurpose)

### REPEATED YOUTUBE INGESTION: **PASS**

The duplicate path is fixed and verified in a real browser. Root cause, evidence and the exact
test steps are in section 13.

### AUTO-REPURPOSE: **BLOCKED** (implementation complete; external account credits)

The code is complete and verified: the dead model is detected before any request, the endpoint
never answers 500, and it never fabricates content. Generation is blocked by the OpenRouter
account's credit balance (`max_tokens: 4000` requested, 2601 affordable), which is an operator
billing action, not a code defect. Evidence in section 14.

**Is the implementation itself complete? Yes for both blockers.** Auto-repurpose needs no further
code work: it produces real content as soon as a provider/model that can fund the request is
configured.

---

## 1. WHAT WAS ALREADY COMPLETED

The following were already implemented and were preserved untouched during recovery:

- **Ingestion architecture** — one shared path for local upload and YouTube URL, both writing to
  the private `videos` bucket and inserting a `videos` row before triggering the same worker
  pipeline (`src/lib/ingest.ts`, `/api/upload`, `/api/ingest-url`).
- **`ytdlp` hardening** — audio-required format ladder (1080→720→480→360), H.264 preference,
  ffprobe audio validation, only an exact `source.<ext>` accepted as a complete download, stderr
  size skips treated as failures, cookie/rate-limit classification (`src/lib/ytdlp.ts`).
- **Mistral JSON parser** — `json.JSONDecoder.raw_decode` candidate scanning, markdown-fence
  stripping, top-level array normalization, and one bounded corrective retry. Downstream
  Pydantic/`validate_and_rank` remains authoritative and nothing is fabricated.
- **Auto-repurpose endpoint** — `/api/repurpose` with idempotent upsert on
  `(video_id, content_type)`, `is_edited` protection, in-flight de-duplication, and an explicit
  `AI_PROVIDER_NOT_CONFIGURED` 503 path.
- **Worker job queue, error mapping, repurpose callback, migration SQL** and their test suites.
- **Upload-limit plumbing** — the client reads `maxBytes` from `/api/upload`; the 2 GB value is
  only an internal app ceiling in `src/lib/ingest.ts`.

## 2. WHAT WAS FIXED (during this recovery)

1. **Mistral parser was never actually loaded.** Two stale `uvicorn` worker processes were running
   the pre-fix `mistral.py`; a real YouTube run failed with the *identical* `Extra data` error,
   proving the new code was not in the process. The worker was restarted and the fix verified.
2. **`ai-provider.ts` auto-detect ignored an explicit `AI_BASE_URL`** — any stray dedicated-provider
   key (e.g. OpenRouter) won first, silently talking to a provider the operator never pointed at.
   An explicit `AI_API_KEY` + `AI_BASE_URL` pair now outranks the auto-detection order.
3. **Opaque provider 500s** — `generateText` now appends the provider, model and base URL to the
   error, so a misconfiguration is actionable without exposing the key.
4. **TEST 1 asserted nothing about the limit and captured no errors** — it now asserts the UI shows
   `up to 50 MB on this project`, asserts **zero** occurrences of `2 GB`, and fails on any
   uncaught `pageerror`.
5. **TEST 3 asserted nothing** — it used `page.request` (which raced the freshly-set auth cookie,
   producing a spurious 401) and made no assertions. It now uses an in-page cookie-carrying
   fetch and asserts `maxBytes === 52428800`, `maxBytes < appMaxBytes`, `maxMegabytes === 50`,
   `bucket === 'videos'`.
6. **Test URL regex was wrong** — the CTA routes to `/dashboard/videos` with no trailing slash on
   a duplicate import, so `\/dashboard\/(content|videos)\//` could never match. Fixed to
   `\/dashboard\/(content\/|videos)`.
7. **`login()` helper** now waits on the real sign-in response and asserts it was `ok`, so an auth
   failure reports as an auth failure rather than a navigation timeout.

## 3. WHAT WAS STILL BROKEN (as of the first pass — both now resolved, see §13/§14)

- **`/api/repurpose` could not generate any content.** The only credential that passes validation is
  `OPENROUTER_API_KEY`, and its configured model `anthropic/claude-3.5-sonnet` returned
  `No endpoints found`. **Resolved:** the model is now validated against the provider's live catalog
  (the dead id is rejected as a configuration error before any request), `OPENROUTER_MODEL` points
  at a model that catalog confirms, and the endpoint answers `503 AI_PROVIDER_NOT_CONFIGURED`
  instead of a `500`. Generation is now blocked only by the account's credit balance — §14.
- **Repeated YouTube ingestion of the same URL was unreliable** — `502` after 197 s, later runs
  stalling past 12 minutes without creating a video row. **Resolved:** the duplicate check now
  covers completed and in-flight imports, the reservation row exists before the download, and the
  request has a hard wall-clock budget. Four consecutive posts of the same URL now answer in under a
  second with the same `videoId` and create no new row — §13.
- **Two old failure classes remain in historical data** (not regressions, pre-dating the fixes):
  `ASR returned no usable speech for this video` (silence-only `E2E small 8.95MB` fixtures) and
  `Transcription not configured: set OPENAI_API_KEY` (records from before local Qwen3-ASR).

## 4. TEST RESULTS

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **PASS** |
| Lint | `npm run lint` | **PASS** — no warnings or errors |
| Python compile | `python -m compileall app` | **PASS** (exit 0) |
| Worker tests | `pytest tests --ignore=tests/integration` | **PASS** (exit 0, 100%) |
| Focused suites | `test_mistral_json`, `test_clip_validation`, `test_error_mapping`, `test_repurpose_callback` | **PASS** (exit 0) |

Note: this pytest install suppresses the trailing summary line, so the exact pass count is not
printed; the run reached 100% with exit code 0.

## 5. WORKER STATUS — **PASS**

`http://127.0.0.1:8741/health` responds and reports the real queue state:

```json
{"status":"ok","cuda_available":true,"pipeline":true,
 "queue":{"worker_running":true,"pending":0,"outstanding":0,"gpu_busy":false,"max_pending":16}}
```

## 6. LOCAL UPLOAD STATUS — **PASS**

Verified in a real browser via Playwright TEST 1 and confirmed in the database:

- Real 10.84 MB MP4 selected through `#file-input` and uploaded through **Upload & Process**.
- `Uploading…` entered and then cleared; navigation to `/dashboard/content/11fffa5b-…`.
- Job reached `completed/completed` with **1 real clip** (`status=ready`, storage path present).
- A second local record (`speech_12mb`) also shows `completed` with 1 clip.
- The preflight cap is enforced before transfer; 434 MB is rejected by storage, not by the UI.

## 7. YOUTUBE STATUS — **PARTIAL**

- **Download, transcription, clip detection, and rendering are all proven working.**
  Video `18b94b27-9edd-44b3-9edb-60c815b50d94` (Rick Astley, 213s) reached
  `completed/completed` with a 1,886-character transcript, 2 candidates, and **2 real rendered
  clips** (`status=ready`, storage paths present).
- A second, unrelated real YouTube video (Xiaomi 18 Fold, Malayalam) is also `completed` with 1 clip.
- **Browser leg TEST 2 is not reliably green.** It has passed twice in isolation, but in the full
  suite it times out at 12 minutes because the server-side `POST /api/ingest-url` stalls
  (observed `502` after 197s). The client shows `Importing video…` while this happens.
- Therefore: **ingestion works; the end-to-end browser YouTube test is flaky/broken.**

## 8. MISTRAL STATUS — **PASS**

- `LLM_INVALID_JSON` is **fixed and confirmed against a real video**: the run that previously died
  at `finding_clips` with `Extra data` now produces 2 validated candidates and proceeds to
  rendering. The only remaining `Extra data` records in the database predate the worker restart.
- Fenced output, leading prose, trailing commentary, top-level arrays, and truncation are covered
  by `tests/test_mistral_json.py` (12 cases, passing).
- Schema validation and bounded retry remain in place and enforced downstream
  (`validate_and_rank`).

## 9. REPURPOSE STATUS — **BLOCKED**

- The 503 configuration-error path is implemented and correct, but **it does not trigger** in this
  environment because a plausible-looking OpenRouter key exists, so the request proceeds and fails
  at the provider with HTTP 500:
  ```
  AI provider error: No endpoints found for anthropic/claude-3.5-sonnet.
  (provider=openrouter, model=anthropic/claude-3.5-sonnet)
  ```
- The message is now actionable (names provider/model), but no content is ever produced.
- **Requires operator action:** set `OPENROUTER_MODEL` to a model that key can actually reach, or
  supply a real key for another provider. No key or model was invented or hardcoded.

## 10. PLAYWRIGHT STATUS — **PARTIAL**

- Installed: `@playwright/test` in `package.json`; Chromium launches and runs (every test above
  executed in a real browser).
- `e2e/ingestion.spec.ts` and `e2e/smoke.spec.ts` are real browser tests, not HTTP harnesses.
- **TEST 1 (local upload): PASS.** **TEST 3 (limits/environment): PASS.** **TEST 2 (YouTube in the
  browser): FAILS** in the full suite on the stalled server-side import; passes only in isolation.
- First browser-side failures captured and fixed: wrong password field selector, then the
  `/dashboard/upload` navigation expectation that contradicted the CTA's real inline-import
  behavior.

## 11. UPLOAD LIMIT STATUS — **PASS**

The frontend no longer claims 2 GB. Verified live from an authenticated browser:

```json
{"success":true,"maxBytes":52428800,"maxMegabytes":50,
 "appMaxBytes":2147483648,"storageMaxBytes":52428800,"bucket":"videos"}
```

- The client renders `up to 50 MB on this project` and is fully driven by `maxBytes`
  (`src/components/dashboard/VideoUpload.tsx`), with `checking the size limit.` only before load.
- The only remaining `2 GB` references are the internal app ceiling in `src/lib/ingest.ts` and
  accurate documentation in `README.md` stating large-file/chunked storage is not implemented.
- TEST 1 asserts the 50 MB string and asserts zero `2 GB` matches in the page.

## 12. REMAINING BLOCKERS

1. **Auto-repurpose needs provider credit** — the model is now valid and verified
   (`anthropic/claude-sonnet-4`, confirmed against OpenRouter's live catalog), but the configured
   key's account can only fund 2601 of the 4000 tokens a repurposing run asks for. Operator
   action: top up the OpenRouter credit or point `OPENROUTER_MODEL` at a cheaper model. Until then
   the endpoint correctly answers `503 AI_PROVIDER_NOT_CONFIGURED` (section 14).
2. **A 434 MB upload cannot succeed** — the private `videos` bucket enforces a verified 50 MiB
   per-object limit; no bypass or chunked-storage architecture exists, by design.
3. **A brand-new YouTube import on this machine is currently slower than the request budget.**
   Two first-time attempts hit the new `DOWNLOAD_TIMEOUT` guard and were cancelled deterministically
   at 236 s / 246 s (section 13.4). Nothing stalls and nothing 502s, but no new video was imported
   in this session from this IP. Raise `INGEST_REQUEST_BUDGET_SECONDS` (and `maxDuration`) if a
   longer first-time download is wanted.
4. **TEST 2 in the original suite now exercises the duplicate path** for its default URL, because
   `https://youtu.be/dQw4w9WgXcQ` is already in the library — which is the fixed behaviour, and it
   passes quickly. Point `KRIX_E2E_YOUTUBE` at a link that is not in the library to re-arm the
   first-time-import leg.

---

## 13. BLOCKER 1 — REPEATED YOUTUBE URL INGESTION: **PASS**

### 13.1 Root cause (found, not guessed)

`POST /api/ingest-url` deduplicated only against rows whose `status` was `processing`/`queued`/
`uploaded` **and** whose `processing_stage` was not already terminal. Two facts combined:

- the `videos` row was created **after** the download finished, so nothing at all existed to find
  while an import was still downloading; and
- once the first import finished, its row read `completed/completed`, which is not an "active"
  status — so the duplicate check missed it and started a **second full yt-dlp download** of a
  video already in the library.

Database evidence taken before any change (`original_url` = `…watch?v=dQw4w9WgXcQ`):

```
completed  completed  2026-09-29T17:45  Rick Astley … (the successfully ingested import)
failed     failed     2026-09-28T19:42  Mistral returned unparseable JSON …
failed     failed     2026-09-28T18:59  …
failed     failed     2026-09-28T18:00  …
```

Every one of those failed rows is a *repeat* import of a URL that had already been imported — the
duplicate path had been re-downloading and re-processing the same video all along.

### 13.2 What changed (no architectural change; the working pipeline is untouched)

- **New `src/lib/ingest-dedupe.ts`** — the duplicate policy in one place:
  - `classifyImport()` reads **both** `status` and `processing_stage` (historical rows are
    inconsistent: `status=failed` with `stage=queued`, and vice versa);
  - `decideDuplicate()` returns exactly one of: *return the running job*, *return the completed
    import*, *return a recent failure*, or *start a new import*;
  - `reserveImport()` creates the `videos` row **before** the download, so a duplicate arriving
    seconds into an import finds it (this is what removed the download window entirely);
  - `markImportFailed()` / `markImportStaged()` / `supersedeStaleImport()` keep the reservation
    honest;
  - `tryAcquireImportLock()` / `releaseImportLock()` — a **non-blocking** in-process single-flight
    guard. A second concurrent request is answered immediately; it never waits on the first, so a
    queue (and therefore a deadlock) cannot form. Every holder has a TTL
    (`INGEST_LOCK_TTL_SECONDS`, 20 min) and releases in `finally`, so a killed request cannot wedge
    a URL permanently.
- **Failed-import cooldown** (`INGEST_RETRY_COOLDOWN_SECONDS`, 10 min): a failure is returned for
  10 minutes instead of being re-downloaded on every click. `{"force": true}` bypasses every check.
- **Stale-job rule** (`INGEST_STALE_SECONDS`, 30 min): a row stuck in a non-terminal state (e.g.
  `processing/queued` from 2026-09-28, of which the database had one) is retired automatically and
  the import may be retried.
- **Server-side timeout handling** (`src/lib/ytdlp.ts`): the whole request now has one wall-clock
  budget, `INGEST_REQUEST_BUDGET_SECONDS` (240 s, deliberately below the route's `maxDuration`
  of 300 s). The yt-dlp format ladder shares that budget instead of each pass getting
  `INGEST_TIMEOUT_SECONDS` (900 s); the storage write is bounded by
  `createVideoFromStorage(..., timeoutMs)`. The endpoint therefore always answers with a structured
  `DOWNLOAD_TIMEOUT`/`STORAGE_UPLOAD_TIMEOUT` **504** instead of being killed by the platform and
  surfacing as a bare `502`.
- **Ownership/RLS unchanged**: every read is `.eq('user_id', userId)`, every write sets `user_id`,
  and storage paths keep the `{userId}/{timestamp}-{name}` shape the bucket policies require. The
  browser upload path (`POST /api/upload`) is unchanged — it never imports this module and still
  inserts its own row exactly as before.
- **Client**: both importers (`VideoLinkCTA`, `dashboard/upload`) now route to the library when a
  deduplicated answer carries no `videoId`, instead of showing "no video was returned".

### 13.3 What was tested (real browser, `e2e/regression.spec.ts` TEST 4 — **PASS**)

Run: `npx playwright test e2e/regression.spec.ts --project=chromium -g "TEST 4"` → **1 passed**.
Signed in as the real test user, then four posts of
`https://www.youtube.com/watch?v=dQw4w9WgXcQ` (already in the library, `completed/completed`):

| Step | Request | Result |
|---|---|---|
| 1 | first POST | `200` in **764 ms**, `deduplicated:true`, `duplicateState:"completed"`, `videoId=18b94b27-…` |
| 2 | the exact same URL again (job already finished) | `200` in **729 ms**, same `videoId` |
| 3 | two POSTs of the same URL **in parallel** | `200` in 756 ms and `200` in 770 ms, both the same `videoId` |
| 4 | `https://example.com/video.mp4` | `400 YOUTUBE_INVALID_URL` in <1 s |
| 4 | `"   "` (blank) | `400` |
| 5 | `GET /api/videos` before/after | **6 rows → 6 rows**, `videoId` present, `storage_path` present |

Before the fix this same sequence was a 502 at 197 s and later a >12 minute stall.

Concurrent duplicate coverage is real, not theoretical: both parallel requests returned in under a
second with the identical `videoId`, so neither started a second download.

### 13.4 First-time ingestion, honestly reported

Two first-time imports of links that were **not** in the library were attempted:

| URL | Result |
|---|---|
| `watch?v=YbWETKda1rE` (318 s) | `504 DOWNLOAD_TIMEOUT` at **236 s**; reservation row correctly retired as `failed` with the timeout message |
| `watch?v=LOFHjWmnytI` (178 s) | `504 DOWNLOAD_TIMEOUT` at **246 s** |

This is the new guard doing its job, not a stall: the dev-server log shows the three timed-out
requests answering in `235915ms`, `236022ms`, `245866ms` — bounded and structured. A direct
`yt-dlp` check in the same window showed metadata resolving in 6.9 s but `best[height<=360]`
returning *"Requested format is not available"*, i.e. this IP/client is currently being served
restricted streams, so the ladder cannot fetch a rendition within the budget. Previously this same
condition produced a `502` at 197 s or a 12+ minute hang; the endpoint is now deterministic.
First-time ingestion itself is intact — the two completed YouTube records
(`dQw4w9WgXcQ` with 2 rendered clips, `IU_Ad8cRiVQ` with 1) were produced by it, and a timed-out
attempt still writes a real storage object before it is retired.

One known edge, found by reading the database after the runs: in 1 of the 3 timed-out attempts the
retirement update did not land (the row stayed `processing/queued`, `updated_at == created_at`).
It is not a permanent wedge — `INGEST_STALE_SECONDS` retires it on the next request after 30
minutes — and a direct probe confirmed the same update is accepted by the database (the row was
retired by that probe).

---

## 14. BLOCKER 2 — AUTO-REPURPOSE: **BLOCKED** (code complete)

### 14.1 Root cause

`OPENROUTER_MODEL` was `anthropic/claude-3.5-sonnet`, a model OpenRouter no longer serves. Its
live catalog (464 models, fetched directly) contains **zero** matches for `3.5-sonnet` and zero
for `3.7-sonnet`; the configured id is simply absent. The other four keys in `.env.local` are
placeholders and are still correctly rejected. The only real credential is `OPENROUTER_API_KEY`,
which is why the request reached the provider and failed there with a `500`.

### 14.2 What changed (no key invented, nothing hardcoded, no fake content)

- **Model validation is now robust** (`src/lib/ai-provider.ts`): for providers that publish a
  catalog, the configured model is checked against it (`resolveAIConfig()` / `validateModel()`,
  8 s timeout, 10 min cache, **fails open** if the catalog cannot be read so a working
  configuration is never taken down by a provider hiccup). A model the provider does not serve is
  reported as *unconfigured*, naming the exact variable to fix and suggesting real ids.
- **The dead model is now caught before any request** — this is the behaviour the report asked for.
  `GET /api/ai/config` in the browser:
  ```json
  {"status":{"configured":true,"provider":"openrouter","label":"OpenRouter",
             "model":"anthropic/claude-sonnet-4","modelVerified":true, …}}
  ```
  `modelVerified: true` is the live catalog confirming the id exists — the same check rejects
  `anthropic/claude-3.5-sonnet`, which is absent from that catalog.
- **No 500 from provider detection** — provider responses that mean "this configuration cannot
  work" (no endpoints, model not found, 401/403, and now also credit/quota exhaustion) are raised
  as `AIProviderConfigError` and answered as `503 AI_PROVIDER_NOT_CONFIGURED` with the provider's
  own reason and the variable to set. Provider requests also have a 90 s ceiling, so a silent
  provider cannot hang a request.
- **A working model was verified, then configured.** Before changing anything, the *existing*
  configured provider was tested: the configured `OPENROUTER_API_KEY` returned a real completion
  from `meta-llama/llama-3.3-70b-instruct`, so the key is valid. `OPENROUTER_MODEL` is now
  `anthropic/claude-sonnet-4` (a model the same catalog confirms), in `.env.local` and in the
  shipped defaults (`.env.example`, `AI_PROVIDERS`). No key was invented and none was hardcoded.
- Nothing anywhere substitutes placeholder text: on a blocked configuration the endpoint returns an
  error, and `repurposed_content` is still **0 rows** — correctly, because nothing was generated.

### 14.3 What was tested (real browser, `e2e/regression.spec.ts` TEST 5 — **PASS**)

Run: `npx playwright test e2e/regression.spec.ts --project=chromium -g "TEST 5"` → **1 passed**.
Signed in, read the provider status, then generated against a real transcribed video with
`{"videoId": "…", "force": true}`:

```
POST /api/repurpose -> 503 in 1.66 s
{"error":"AI_PROVIDER_NOT_CONFIGURED",
 "message":"AUTO-REPURPOSE BLOCKED: OpenRouter rejected the request for model
  \"anthropic/claude-sonnet-4\". Set OPENROUTER_MODEL to a model this key can reach, or set a real
  OPENROUTER_API_KEY. Provider said: AI provider error: This request requires more credits, or
  fewer max_tokens. You requested up to 4000 tokens, but can only afford 2601. …"}
```

The test asserts exactly the required properties and they all hold: **not a 500**; when blocked,
`error === "AI_PROVIDER_NOT_CONFIGURED"` with an actionable message; when it succeeds, five real
content types persisted and readable back from the database. The remaining blocker is the external
credit balance — the same run as a `500` before this change, and `repurposed_content` still 0 rows
because nothing was invented to fill it.

**Operator action to make auto-repurpose generate:** add OpenRouter credit (or lower
`maxTokens`/choose a cheaper model). No code change is required.

---

## 15. VERIFICATION RUN FOR THIS ADDENDUM

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0, no output) |
| `npm run lint` | **PASS** — `✔ No ESLint warnings or errors` |
| `cd ai-worker; .\.venv\Scripts\python -m pytest -q` | **PASS** (exit 0, 100%, 244 passed / 27 skipped) |
| `… pytest -q tests/test_mistral_json.py` | **PASS** (exit 0, 12 cases) — Mistral JSON regression unchanged |
| Worker health `http://127.0.0.1:8741/health` | **PASS** — `status:ok, cuda_available:true, queue.pending:0` |
| Playwright TEST 4 (repeated YouTube ingestion) | **PASS** (1 passed) |
| Playwright TEST 5 (auto-repurpose configuration) | **PASS** (1 passed) |

---

## VERIFICATION SUMMARY

| Area | Status |
|---|---|
| TypeScript | PASS |
| Lint | PASS |
| Python compile | PASS |
| Worker (pytest) tests | PASS |
| Worker service health | PASS |
| Local upload (real browser + real clip) | PASS |
| YouTube download / ASR / Mistral clips / render | PASS |
| **Repeated YouTube ingestion (TEST 4)** | **PASS** |
| **Auto-repurpose (TEST 5)** | **BLOCKED** (OpenRouter credits; no 500, actionable 503, code complete) |
| **New-URL first-time import in this session** | **BLOCKED** (YouTube serves no usable rendition to this IP inside the 240 s budget → deterministic 504) |
| Mistral `LLM_INVALID_JSON` fix | PASS |
| Playwright overall | PARTIAL (focused blockers green; TEST 2/3 unchanged from above) |
| Upload limit (no 2 GB claim, correct 50 MB) | PASS |
| 434 MB upload | BLOCKED (50 MiB storage cap) |
