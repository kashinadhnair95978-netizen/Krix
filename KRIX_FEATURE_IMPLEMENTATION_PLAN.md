# KRIX — FEATURE IMPLEMENTATION PLAN

**Date:** 2026-09-30
**Companion documents:** `FRONTEND_FEATURE_AUDIT.md` (the evidence), `KRIX_PRODUCTION_READINESS_REPORT.md` (the verdict)
**Nature:** PLAN ONLY. No code in this repository was changed while producing this document.

---

## 1. THE SITUATION IN ONE PARAGRAPH

Krix has one genuinely finished product loop: a user uploads a local video, and the system produces real transcripts, real word-level alignment, real visual analysis, real Mistral-scored clip candidates, real 1080x1920 renders with burned-in captions, and real signed-URL preview and download — all persisted in Postgres under RLS with per-user ownership. That loop is protected by 222 passing worker tests — 34 of which run real ASR, real FFmpeg, and real Qwen3-VL and Mistral on a GPU — plus 3 Playwright browser specs, and it should not be disturbed.

Everything around that loop is one of three things: **correct code that is externally blocked** (text repurposing, first-time YouTube import), **a UI sitting on top of hardcoded arrays** (analytics, calendar, projects, team, API keys, inspiration, pricing), or **marketing copy for a capability that was never built** (Smart Reframe, B-roll, AI Producer, the editor, the scheduler, social publishing, MCP, the public API, API keys, brand templates, AI thumbnails, XML export).

Of 177 audited features, 47 work, 46 are partial, and 75 — **42%** — are missing or mocked. Meanwhile the landing page advertises roughly 30 capabilities, of which about 6 exist. There is no revenue path: a user can sign up, use every feature forever, and never be charged. And one payment route lets any signed-in user activate a paid plan on their own account without paying.

**Therefore this plan does not begin with new features. It begins with making the product stop lying and stop being exploitable.**

---

## 2. SEQUENCING PRINCIPLES

Five rules govern the order of work. Violating any of them will make things worse, not better.

1. **Security before features.** A product in which any signed-in user can grant themselves a paid plan cannot be made safe by adding features to it.
2. **Honesty before breadth.** Deleting a false claim costs hours. Being caught claiming something that does not exist costs the company.
3. **Reuse before build.** Several "missing" features are mostly a database table plus a CRUD route plus a real page. The backend work is small; the honesty work is the point.
4. **Never regress the pipeline.** Every change in section 4 touches the worker. Each one requires the full test suite plus one real E2E run. The pipeline is the asset.
5. **Ship honesty, not stubs.** Where a feature cannot be built in this phase, the correct action is to remove or relabel the claim — not to add a "Coming Soon" modal to a promise that has no date.

---

## 3. PHASE 0 — STOP-SHIPPERS (P0) · 6–9 days · 12 items

Nothing else in this plan may begin until P0 is merged. Three of these are one-line changes.

### P0-1 · Remove the client-callable payment verify route — 0.1 day

**Why first:** the highest-risk defect on the payments surface. `/api/payments/verify` is *not* the unauthenticated free-plan machine it may appear to be — it **is** authenticated (lines 8-11) and **is** ownership-scoped (`.eq('user_id', userId)`, line 39), so it cannot grant a plan to another account. The real flaw is narrower and just as serious:

> Signature verification runs **only** when `provider === 'razorpay'` (line 17). Any other value — `'stripe'`, or omitting the field entirely — skips verification and still executes `update({ status: 'active' })` (line 35). **A signed-in user can self-activate their own paid plan without paying anything.**

Three secondary defects in the same file: the HMAC signs `${razorpayPaymentId}|${subscriptionId}`, which does not match Razorpay's `order_id|payment_id` scheme, so verification likely never succeeds for genuine payments either; the comparison uses `!==` rather than a constant-time compare; and the route prefers a **global** `STRIPE_SECRET_KEY` (see P0-2).

**Action:** delete the route and the `verifyPayment` method in `api-client.ts`. Ensure no route fulfils a subscription from client-supplied input.

**Acceptance:** no route outside a provider webhook can write to `subscriptions`. Grep for `subscriptions` writes; the only permitted writers are the Stripe and Razorpay webhook handlers. Test: authenticate as a user, POST to this route with `provider: 'stripe'`, and confirm no subscription is activated.

### P0-2 · Stop returning private keys to clients — 0.5 day

**Why:** `/api/payments/create-order` prefers a **global** `STRIPE_SECRET_KEY` over a per-user secret, so account creation returns `secretKey` into the browser response. Separately, `POST /api/ai/config` writes a **global** AI key shared by every user.

**Action:** never return a private key in any response branch. Adopt platform-held keys (the simplest correct option) or per-user encrypted credentials.

**Acceptance:** grep the codebase for `secretKey` and `STRIPE_SECRET_KEY` in any response object. Zero client-facing returns.

### P0-3 · Fix `PUT`/`DELETE /api/content/[id]` — 0.2 day

**Why:** both endpoints are broken for every user. `select('id, videos!inner(user_id)')` is a Supabase **many-to-one** join, so `videos` comes back as a **single object**. Both handlers treat it as an array and read `.length` and `[0]` (lines 73-74, 138-139). For an object, `.length` is `undefined`, so the `length === 0` guard evaluates `false` and execution continues to `(existing.videos)[0].user_id` — which throws `TypeError: Cannot read properties of undefined (reading 'user_id')`. The surrounding `catch` swallows it.

**Net effect: the ownership check never completes, and both endpoints return HTTP 500 for every request.** These are the only content-mutation routes in the app.

**Action:** read the joined value as an object — `(existing.videos as { user_id: string })?.user_id !== userId`. While in the file: call the imported-but-unused `sanitizeFilename`, and either implement or remove the ignored `regenerate` field.

**Acceptance:** a user can edit and delete their own content; another user receives 403 or 404. Neither case returns 500. Covered by two new route tests.

**Note:** this bug was invisible only because no UI is wired to either endpoint. P1-4 adds that UI — so P0-3 must land first, or a new UI will ship pointing at two 500s.

### P0-4 · Fix `POST /api/payments/payment-method` — 0.5 day

**Why:** a valid session is the only check. The route then stores a `pm_` string and a `last4` value **the client supplied**.

**Action:** derive `last4` and ownership from the provider. Ignore all client-supplied card data.

**Acceptance:** the value stored in `payment_methods.last4` is the provider's, provable by a test that posts a forged `last4`.

### P0-5 · Fix Google OAuth — 0.3 day

**Why:** `auth/callback/page.tsx:13-17` passes the full `"code=…&state=…"` string to `exchangeCodeForSession`, which expects the bare code, and then races the session check after 200 ms. Sign-in with Google — the only non-password path to an account — is broken.

**Action:** `new URLSearchParams(search).get('code')`; await the session rather than racing it; surface the error.

**Acceptance:** a real Google sign-in completes and lands on the dashboard.

### P0-6 · Reject placeholder service keys and close the middleware matcher gap — 0.3 day

**Why:** `.env.example` ships `INTERNAL_SERVICE_KEY=changeme` and `AI_WORKER_API_KEY=changeme` as literal defaults. The **worker** guards against this — its auth fails closed on `changeme`. The **Next.js side does not.** `isValidServiceKey` (`auth-utils.ts:10-18`) only checks `if (!secret) return false`, so `changeme` is accepted as a valid key, and `middleware.ts:24-28` returns early on a match, skipping every subsequent check. Both compare with `===` rather than a constant-time compare.

Impact is bounded but real: `getUserId` never honours the service key, so a service-key request to a user-scoped route still gets 401. The exposure is to any route that relies on middleware alone, and it becomes total if the key is weak or leaked.

**Action:**
1. Reject empty and `changeme` in `isValidServiceKey`, exactly as the worker already does.
2. Use `crypto.timingSafeEqual` for both the middleware and `isValidServiceKey` comparisons.
3. Add `/api/analytics`, `/api/content`, and `/api/payments` to the middleware matcher. These routes already check the session themselves, so this is defense in depth — but a route that forgets its own check would currently be unprotected.
4. Fail application startup if `INTERNAL_SERVICE_KEY` is still a placeholder in a production build.

**Acceptance:** a request carrying `x-service-key: changeme` is rejected on every protected path.

### P0-7 · Align every marketing claim with the code — 1 day

**Why:** the largest single risk in the company. The site advertises ~30 capabilities and delivers 6, and it does so with 6 fabricated testimonials, 10 invented brand logos, 4 invented statistics, 10 invented solution stats, and a performance table naming 5 platforms this product has never posted to. Section 3 of the audit contains the full claim-by-claim list and the recommended replacement copy.

**Action:** apply the replacements. For each capability that does not exist, either remove the card or use the existing `ComingSoon` primitive — which is already built, works, and is the correct pattern.

**Acceptance:** a stranger reading the site and a stranger reading the code would reach the same conclusions.

**This is the highest-value single day in the plan.** It costs nothing and removes the largest reputational exposure.

### P0-8 · Strip fabricated analytics; add real error states — 0.5 day

**Why:** the analytics page mixes 5 genuinely real counters with roughly 12 hardcoded series, including a "Viral Score 8.4" hero tile and complete performance data for 5 platforms. Worse, `hooks.ts:99-101` swallows every error and returns the fallback, so a server error renders the invented dashboard instead of an error message. **A mock that renders on failure is worse than no feature, because it is indistinguishable from success.**

**Action:** delete every hardcoded series and show only the real counters. Then add an error state so a failed fetch cannot masquerade as data.

**Acceptance:** block the network on the analytics page — it shows an error, not a dashboard. This is a five-minute manual test that must be performed.

### P0-9 · Make one checkout work end to end — 2 days

**Why:** there is currently no revenue path whatsoever. A user cannot pay, and no code ever writes to `subscriptions`.

**Action, in order:**
1. Real Stripe price IDs in `stripe.ts` in place of `price_xxxxx` / `plan_xxxxx`.
2. Create the `/checkout/stripe` route that `StripeCheckout.tsx:41` already points at.
3. Verify the webhook with `stripe.webhooks.constructEvent`; handle `payment_intent.succeeded` and the subscription events; upsert `subscriptions`.
4. Implement Razorpay order verification (order creation is real; verification never happens, so a success state is unreachable).
5. Remove the non-functional "Choose your payment method" modal from `/pricing` until steps 1–3 are verified.

**Acceptance:** a real test-mode payment produces a `subscriptions` row, the plan appears on `/dashboard/settings`, and `/api/subscription` reflects it.

**Depends on:** P0-1 and P0-2 must land first, or this work builds on a compromised foundation.

### P0-10 · Auth rate limiting — 0.5 day

**Why:** login and signup are unmetered and unauthenticated, enabling credential stuffing, mass account creation, and free-tier quota farming.

**Action:** per-IP and per-email limits on `/api/auth/login`, `/api/auth/signup`, and the browser-side login call. Add alerting on threshold breaches.

### P0-11 · CI — 0.5 day

**Why:** nothing runs on push. There is no `test` script in `package.json`; the 222 worker tests and 3 Playwright specs exist but are never executed automatically, so any change can silently break the pipeline.

**Action:** a GitHub Actions job running `tsc --noEmit`, `npm run lint`, `pytest`, and the Playwright suite. Add `test`, `test:unit`, `test:e2e` scripts to `package.json`. Add a pre-commit hook via lint-staged.

**Acceptance:** a deliberately broken test fails the pipeline.

### P0-12 · Legal and data rights — 1 day

**Why:** 17 dead footer links point at `/privacy` and `/terms` that do not exist. There is no cookie consent, no data export, and no account deletion. The product collects email addresses, payment identifiers, and uploaded video.

**Action:** publish `/privacy` and `/terms`; add cookie consent; implement account deletion and data export; then repair the 17 footer links.

**Acceptance:** every footer link resolves to a real page.

---

## 4. PHASE 1 — LAUNCH COHERENCE (P1) · 8–12 days · 20 items

Phase 1 turns a working pipeline into a coherent product. It is mostly wiring real endpoints to real UI.

### Group 1 — Unblock the headline feature (repurposing)

| # | Item | Effort | Detail |
|---|---|---|---|
| P1-1 | **Unblock and expose repurposing** | 1.5 d | Set `max_tokens=2000` (the brief needs ~800–1,500, so the 4,000 cap forces 10,000 billing units and exceeds the available 2,601). Wire the existing local heuristic at `ai-provider.ts:109-134` — which builds a deterministic transcript-derived 5-content pack and is then **discarded** by the `else` in `repurpose/route.ts:230-259` — as a clearly-labelled draft path. Record failures durably, because a blocked LLM call currently leaves no row, no log, and no alert. |
| P1-2 | **Prove and show AI timestamps** | 1 d | The UI claims clips contain timestamps, but the repurpose prompt is called with no video metadata, so the model cannot know a single timestamp. Pass `{videoId}` so the worker's `aigc.json` seed is used, and surface the timestamps. |
| P1-6 | **Rename retry/regenerate** | 0.5 d | Both buttons call `/api/repurpose`, which regenerates **text only** — no clip is ever re-rendered. Rename to "Regenerate copy", or add a real clip re-run. |

The heuristic is the single most valuable item in this group. It is already written, deterministic, requires no credits, and is 3 lines away from being used. It converts the product's headline promise from "never produced a single row" to "works offline today."

### Group 2 — Turn dead routes into working features

| # | Item | Effort | Detail |
|---|---|---|---|
| P1-3 | **Projects (real)** | 2 d | Add `projects` and `project_members`, per-user RLS, and `/api/projects` CRUD. Replace `useState(initialProjects)`. |
| P1-7 | **Calendar (real)** | 2 d | Add `content_calendar` and `/api/calendar`. Replace `useState(seedPosts)`. **Do not** build publishing in this phase — see P2-8. |
| P1-4 | **Content edit + delete UI** | 1 d | Wire to the endpoints P0-3 repaired. Two working endpoints currently have zero callers. |
| P1-5 | **Video delete UI** | 0.5 d | `DELETE /api/videos/[videoId]` and `api-client.deleteVideo` exist and are never called. Add the action with confirmation, and delete the DB rows **and** both storage prefixes. |
| P1-12 | **Poll to a terminal state** | 0.3 d | Stop optimistically setting `status: 'completed'` and halting the poll. Users are currently told a clip is ready while it is still generating or has failed. |

**Decision required before P1-3 or P1-7:** Projects, Calendar, and Team each imply multi-tenancy. See section 6.

### Group 3 — Repair the data model's honesty and correctness

| # | Item | Effort | Detail |
|---|---|---|---|
| P1-8 | **Make the thumbnail optional** | 0.3 d | `_write_thumbnail` returns a path on every branch, so a failed thumbnail makes `storage.py:112` open a missing file **outside** its `try` — failing an otherwise perfectly rendered video. A cosmetic failure is destroying real output. |
| P1-9 | **Sample Qwen3-VL across the full duration** | 0.5 d | 12 frames are sampled at `start + i * 2.0`, so a 1-hour video is analysed as though it were 2 minutes long. Every downstream clip decision is biased toward the opening. |
| P1-10 | **Make unmeasured scores nullable** | 0.5 d | 6 of 7 clip sub-scores default to `0` and persist indistinguishably from a real zero, so the score badge cannot distinguish "perfect" from "not measured". Also lower `MIN_SCORE` from `0.0`, which currently makes the filter a no-op. |
| P1-11 | **Map all 12 processing stages** | 0.3 d | `PipelineProgress` and `StatusPill` map 6. `extracting`, `aligning`, `uploading`, `repurposing` return index `-1` and render as pending. |
| P1-17 | **Keys, checks, indexes, migrations** | 1 d | `ai_pipeline.sql` has no FK, no CHECK, no unique constraint, no index on any FK, and no index on `(user_id, created_at)` — which every list query uses. `supabase/migrations/` is empty while three competing SQL files sit side by side. |

### Group 4 — Frontend correctness and coverage

| # | Item | Effort | Detail |
|---|---|---|---|
| P1-13 | **API rate limiting** | 0.5 d | None exists on any route, including unauthenticated `/api/ingest-url` and `/api/payments/create-order`. |
| P1-14 | **Delete the fake API-key generator** | 0.3 d | `api/page.tsx:43` fabricates `'kx_live_' + 'x'.repeat(32)` in the browser. A user will paste that into a terminal and it will mean nothing. Remove the button; label the surface Soon; then build for real in P2-7. |
| P1-15 | **Error boundaries and error tracking** | 0.5 d | Sentry on Next.js and the worker. Only `console.log` exists today, and a silent repurpose failure is currently indistinguishable from success. |
| P1-16 | **Component tests** | 2 d | Zero frontend tests, no jsdom, no RTL, no test ids. Add RTL coverage for the six pages that were mocks, plus the auth forms and the upload flow. |
| P1-18 | **Complete `.env.example`** | 0.2 d | Missing `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_API_KEY`, storage vars, and OpenRouter. Every one of these has been misconfigured or missed. |
| P1-19 | **Caption templates** | 1 d | `config.py:205-211` is one hardcoded ASS style, marketed as "templates to choose from". Add a real table. Requires FFmpeg **with libass** — document as a hard prerequisite. |
| P1-20 | **Worker hardening** | 0.3 d | Bearer auth on `/status` and `/jobs`, which currently publish model IDs, quantization, pipeline config, and 25 `video_id`s unauthenticated. `hmac.compare_digest` for the token. Replace the `"oom"` substring match in `errors.py:73`, which also matches "Zoom", "Broom", and "Bloom". |

---

## 5. PHASE 2 — DIFFERENTIATION (P2) · 15–25 days · 15 items

These are the capabilities the marketing site already promises. They are ordered by return on effort, **not** by how prominently they appear on the site.

### P2-1 · Smart Reframe — 4 days · BUILD FIRST

**The highest-leverage item in the entire plan.**

`models/vision.py:187-190` already computes `speaker_position` and `visual_interest` from Qwen3-VL, stores them, and then **throws them away**. `services/rendering.py:53` performs a fixed centre crop — and its own docstring says "future phases add smart reframing". The marketing site advertises "keeps moving subjects centered with AI object tracking" as a headline capability.

So the data is already being paid for and discarded. The work is:

1. Persist the per-clip reframe signals properly, including a time series rather than one summary value.
2. Compute a time-varying horizontal crop offset in `rendering.py`, interpolated between analysed samples, clamped so the crop window never leaves the frame.
3. Honour the existing 9:16 render contract — resolution, fps, CRF, audio, `+faststart`, and the `RENDER_FAILED` behaviour must not change.
4. Fall back to centre crop when no signal exists, so the change can never make a render fail.

**Why first:** it is the only P2 item where the expensive analysis already runs. Everything else needs new models, new providers, or new tables. This needs arithmetic.

### P2-2 · AI B-roll — 4 days

New table, provider integration, an insert pass, and selection inside the Mistral prompt. Currently zero code.

### P2-3 · AI Producer — 6 days

Music, motion design, intros and outros. Currently zero code. The most expensive P2 item and the least differentiated — competitors bundle this with their editors.

### P2-4 · Inline editor — 6 days

Trim, split, reorder, overlays, and **filler-word removal**. The last one is much cheaper than it looks: deletion ranges are already present in `transcript_segments.words` from the forced aligner, so the work is largely a rendering change — remove the words, reflow the captions, re-render. Note the current clip validation rejects spans under 20 s, so aggressive filler removal will require relaxing `MIN_CLIP_DURATION` and re-running the validation tests.

### P2-5 · AI thumbnails — 3 days

Currently an ffmpeg frame grab at the clip midpoint with no text and no branding. Needs an image provider, typography, and a template. If the image provider cannot be funded, relabel rather than ship.

### P2-6 · Real analytics — 5 days

`clip_events` table, ingest endpoint, and a dashboard built on it. This is what makes the analytics page honest rather than merely emptied. The page already acknowledges its data is fabricated; the fix is to give it something real.

### P2-7 · Public API `/v1` — 6 days

Server-issued keys stored in the existing but orphaned `api_keys` table, `Authorization: Bearer`, rate limiting (P1-13), the 6 advertised endpoints, and real docs at `/docs`.

**Sequence matters.** This must not ship before P1-13, or Krix will have a public, unthrottled, unmetered API for video processing. `api_keys` also needs an FK and per-user RLS first — it currently has RLS enabled with **zero policies** and a `user_id` with no foreign key, so it is effectively ownerless, and it ships a `SECURITY DEFINER` lookup RPC that nothing consumes.

### P2-8 · Scheduler and platform publishing — 8 days

`content_calendar` from P1-7 is the scheduling half. The publishing half is 6 platform OAuth integrations, token storage and refresh, a publish queue, and per-platform rate limits.

**This is the largest item in the plan and the one most likely to be misjudged.** Each platform is a separate approval process, a separate token lifecycle, and a separate failure mode. Ship **one** platform end to end, then reassess. Do not commit to "all 6 platforms" — that claim is currently on the site and is false.

### P2-9 · MCP server — 3 days

Builds on P2-7. The footer already labels this "Coming soon" correctly; the capability card and the API page do not. Fix the labelling in P0-7 regardless of whether this ever ships.

### P2-10 · Trials, entitlements, metering, watermarking — 6 days

`trials` (no field, no logic, no expiry), per-plan entitlement enforcement (no route checks a plan), a usage meter (`usage_logs` exists and is never read or written), and watermarking (no watermarking code exists in either direction, so both "No watermark" and "Watermarked exports" are false).

**No pricing claim can be published honestly until this lands.** P0-9 makes a payment *possible*; this makes the *plans* meaningful.

### P2-11 · Brand templates — 4 days

Fonts, colours, logo, intro, outro, per user. A real table plus a caption/overlay renderer driven by it.

### P2-12 · Premiere / DaVinci XML export — 2 days

The cheapest P2 item. There is no XML anywhere in the repository today. A Final Cut XML or FCPXML document is well-specified and requires no model.

### P2-13 · Teams, workspaces, roles, seats — 10 days

See section 6. This is a multi-tenancy project, not a page.

### P2-14 · Source connectors — 1.5 days each

Drive, Vimeo, Loom, Riverside, StreamYard, Twitch, Facebook, LinkedIn, Zoom, Rumble. All ten are listed on the upload page, but only YouTube is accepted — the other nine silently 400. The site already discloses them as "coming", which is correct. **Fix P0-7 to drive the chips from the live `providers` array** so the UI can never again list a connector that returns 400, then ship them one at a time.

### P2-15 · Custom AI training — 10 days

Marketed on the pricing page. No code, no plan, and it is a research project rather than a feature. Remove the claim in P0-7 unless there is genuine intent to build it.

---

## 6. A DECISION THAT MUST BE MADE BEFORE PHASE 1

**Projects, Calendar, and Team each imply multi-tenancy. Krix has none.**

Every table today is single-tenant by `user_id`. Building a Projects page means either a lightweight per-user grouping (two tables, straightforward) or a genuine workspace with membership, roles, and invitations (touching every content table, every RLS policy, the auth layer, and storage paths).

**Recommendation: build the lightweight version, and remove Team from the navbar until it can be built properly.**

- **Projects** — per-user only. `projects(user_id, name, …)`. No sharing, no invitations, no roles. Two days, and it is honest as long as the copy does not say "collaborate".
- **Team** — do not build the page. Either delete the route and the capability card, or accept a ~10-day multi-tenancy project in Phase 2. A Team page that shows 4 hardcoded members and an "Upgrade to add seats" button that does nothing is worse than no page.
- **Calendar** — per-user scheduling only. Publishing is P2-8.

The trap to avoid is building three pages that each imply collaboration while sharing nothing. That produces a product that looks like a team tool and functions as three separate single-user spreadsheets.

---

## 7. WHAT NOT TO DO

Explicit anti-goals, because the shape of the codebase makes several of them tempting.

| Do not | Why |
|---|---|
| Rewrite the AI pipeline | It is the one thing that works: 222 worker tests including 34 real GPU/ffmpeg integration tests, 3 Playwright specs, and correct handling of overlapping ASR chunks, monotonic word timings, bounded LLM output, and adversarial clip candidates. |
| Change `MINIMAX_CONFIG.max_tokens` above 2,000 | The brief needs 800–1,500 tokens. A 4,000 cap forces 10,000 billing units against 2,601 affordable. Raising it burns more quota to produce the same content. |
| Re-enable `email_confirm: false`-style signup shortcuts | Signup currently bypasses verification. That is a launch-blocker in most markets; it is not a convenience. |
| Add more `console.log` for observability | P1-15 introduces real error tracking. More logging is not the same thing. |
| Re-enable `x-user-id` as a server-side identity source | It is dead code today (`auth-utils.ts:51-54` returns `null`) but still sent on every request. Remove it from both sides; it is a standing auth-bypass invitation. |
| "Coming Soon" a feature that has no committed date | P0-7 removes the claim. A Soon badge on an undeliverable promise just moves the deception. |
| Build publishing for 6 platforms at once | Each is a separate OAuth approval and token lifecycle. Ship one. |
| Add a public API before rate limiting | P2-7 after P1-13, always. |
| Trust client-supplied financial data | That is P0-4. `last4` and payment-method identifiers must come from the provider. |

---

## 8. EFFORT AND SEQUENCING SUMMARY

| Phase | Items | Effort | Gate |
|---|---|---|---|
| P0 — Stop-shippers | 12 | 6–9 days | **Hard gate.** Nothing else begins until merged. |
| P1 — Launch coherence | 20 | 8–12 days | Requires P0 |
| P2 — Differentiation | 15 | 15–25 days | Requires P1-13 before P2-7; P1-3/P1-7 before P2-8 |
| P3 — Hygiene | 11 | 3–5 days | Any time |
| **Total** | **58** | **32–51 days** | |

### Milestones

| Milestone | After | Meaning |
|---|---|---|
| **Safe** | P0 (6–9 d) | No exploitable route, no leaked secret, no false public claim |
| **Sellable** | P1 (14–21 d) | A customer can pay, and every dashboard route shows real data |
| **Differentiated** | P2-1 (18–25 d) | Smart Reframe — the one capability competitors cannot trivially copy, because the signals already exist |
| **Complete** | P2 (32–51 d) | The advertised product, honestly delivered |

**The recommended first three weeks are P0-7 (align the claims), P0-1 (delete the payment route), and P1-1 (unblock repurposing).** That sequence converts Krix from a demo with a dangerous edge into an honest early-access product in roughly three weeks — and it does so with almost no new AI work, because the existing pipeline is already good enough.

---

## 9. ACCEPTANCE CRITERIA FOR "LAUNCH READY"

A single, testable bar. Every line must pass.

| # | Criterion | How it is verified |
|---|---|---|
| 1 | No route writes to `subscriptions` except a signature-verified webhook | Code review plus a test that posts a forged payload to every payment route |
| 2 | No private key appears in any HTTP response | Grep for `secretKey` in response objects; test the signup response body |
| 3 | `PUT` and `DELETE /api/content/[id]` work for the owner and fail for everyone else | Two route tests |
| 4 | Google sign-in completes | Manual test |
| 5 | A test-mode payment produces a `subscriptions` row visible on `/dashboard/settings` | Manual end-to-end test |
| 6 | No claim on the public site describes a capability absent from the code | Line-by-line review of the site against section 3 of the audit |
| 7 | With the network blocked, the analytics page shows an error and never a dashboard | Manual test |
| 8 | Every footer link resolves to a real page | Link checker in CI |
| 9 | `tsc --noEmit`, `lint`, `pytest`, and Playwright all run on every push | CI is green on a deliberate failure |
| 10 | No fabricated testimonial, follower count, brand, or performance statistic remains on the site | Review |
| 11 | Login and signup are rate limited | Test |
| 12 | A 1-hour video has frames analysed across its full duration | Measure sample timestamps |
| 13 | A thumbnail failure does not fail a render | Fault-injection test |

Criteria 6, 7, and 10 are the ones that will be checked by someone other than the engineering team. They are listed here because they are the ones most likely to be quietly dropped under delivery pressure.

