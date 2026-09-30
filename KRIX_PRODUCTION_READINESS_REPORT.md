# KRIX â€” PRODUCTION READINESS REPORT

**Date:** 2026-09-30
**Scope:** the complete product â€” marketing site, authentication, dashboard, AI pipeline, repurposing, payments, developer surface, data model, security, testing, operations, and legal.
**Companions:** `FRONTEND_FEATURE_AUDIT.md` (evidence), `KRIX_FEATURE_IMPLEMENTATION_PLAN.md` (remediation)
**Nature:** ASSESSMENT ONLY. No application code was modified.

---

## 1. VERDICT

> ## NOT PRODUCTION READY
> ### Conditional verdict on the core: **APPROVED**
> ### Conditional verdict on everything else: **REJECTED**

Krix contains one genuinely finished product and a large amount of unfinished surface presented as finished product.

The **core video pipeline is real, tested, and would survive technical diligence.** The **company** is not launch-ready, because 42% of the audited surface is mocked or missing, the public site advertises roughly 30 capabilities of which about 6 exist, there is no revenue path, and one payment route lets any signed-in user activate a paid plan for free.

**This is not a verdict that should surprise anyone.** It is the verdict that appears whenever a strong engineering effort is followed by a marketing effort that runs ahead of it. Krix's engineering is better than its marketing by a wide margin, and the gap is the problem.

---

## 2. SCORECARD

| Dimension | Score | Gate | Basis |
|---|---|---|---|
| Core AI pipeline | **9 / 10** | PASS | 222 worker tests and 3 Playwright specs against a real GPU, 3 specific fixable weaknesses |
| Upload and processing UX | **8 / 10** | PASS | Real size validation, real byte progress, real end-to-end output |
| Data model maturity | **6 / 10** | CONDITIONAL | Real RLS and private buckets; no FKs, checks, indexes, or migrations |
| Authentication | **5 / 10** | CONDITIONAL | Email/password works; Google OAuth broken; no reset; no rate limits; verification bypassed |
| Testing and CI | **5 / 10** | CONDITIONAL | Excellent in the worker (222 tests), **zero** in the app; no CI runs anything |
| Observability | **3 / 10** | FAIL | `console.log` only; silent repurpose failures; no error tracking |
| Security | **3 / 10** | **FAIL** | 1 critical, 3 high, 6 medium |
| Dashboard honesty | **2 / 10** | **FAIL** | 6 of 8 dashboard routes are mock or blocked; errors render as invented data |
| Monetization | **1 / 10** | **FAIL** | No revenue path exists end to end; no plan is ever enforced |
| Developer platform | **1 / 10** | **FAIL** | API key fabricated in the browser; 6 fictional endpoints; no MCP |
| Marketing accuracy | **1 / 10** | **FAIL** | ~30 capabilities claimed, ~6 delivered; 6 invented testimonials, 10 invented brands, ~14 invented statistics |
| **Overall** | **4 / 10** | **FAIL** | |

### Gate summary

| Gate | Dimensions passing | Result |
|---|---|---|
| Core product | 2 of 2 | **PASS** |
| Security | 0 of 1 | **FAIL** |
| Monetization | 0 of 1 | **FAIL** |
| Honesty | 0 of 1 | **FAIL** |
| Reliability | 1 of 3 (observability fails, CI conditional) | **FAIL** |

**Three independent gates fail.** Any one of them alone is enough to withhold a launch decision; all three are present simultaneously.

---

## 3. WHAT PASSES

A readiness report that lists only failures is not useful. Krix has real strengths, and they are unusual.

| Area | Assessment |
|---|---|
| **The AI pipeline is genuinely excellent.** | ASR with 300-second chunking and overlap stitching, verified at 4,704 aligned words on a 60-minute file. Monotonic word timings with a 40 ms floor. A 7-score bounded Mistral schema with three-layer JSON defence and one corrective re-ask. A 25-test clip validator that refuses inverted, over-long, out-of-range, below-threshold and overlapping candidates, and **never widens a range server-side**. GPU backpressure with a counter-based pending count, so capacity cannot race. A single-slot model cache with CUDA cache clear. |
| **The rendering contract is solid and honoured end to end.** | 1080x1920, 30 fps, CRF 23, AAC 128k, `+faststart`. A missing or zero-byte output raises `RENDER_FAILED` rather than silently succeeding. Word-timed captions burned in via libass, with 23 passing tests and confirmed presence in real output. |
| **The security instincts in the *original* design are good.** | All 24 API routes derive identity from the server-side session, not from client input. Storage buckets are `PRIVATE` and correctly namespaced per user, with ownership checked before every signed URL. Worker auth **fails closed** on empty or `changeme` values. The repurpose callback cannot fabricate content â€” it sends only a `videoId`, and the callback URL is not caller-controllable. `/api/ai/config` GET is a model of least privilege: masked keys, booleans only, no secret ever returned. Log redaction exists. Passwords are never stored, logged, or returned. |
| **The test suite in the worker is the strongest asset in the repository.** | 18 files, 222 tests, all passing. This is why the core can be certified at all. |
| **TypeScript and lint are clean.** | `tsc --noEmit` and `npm run lint` both pass with zero errors as of this audit. |
| **The upload path is properly defensive.** | Content-length pre-check, MIME plus extension allowlist, an explicit `413 MEDIA_TOO_LARGE`, and a UI limit **driven by the live API value** rather than hardcoded â€” a small detail that shows real care. |
| **The `ComingSoon` primitive already exists and works.** | The organisation already knows how to label an unbuilt feature honestly. The problem is that it is used in only two of roughly thirty places. |

---

## 4. WHAT FAILS

### 4.1 Security â€” FAIL

| # | Severity | Finding |
|---|---|---|
| 1 | **CRITICAL** | **A signed-in user can self-activate their own paid subscription without paying.** `/api/payments/verify` verifies the Razorpay HMAC only when `provider === 'razorpay'`; any other or missing value skips verification and still writes `status: 'active'`. The route is authenticated and ownership-scoped, so it cannot affect another account â€” but no payment is required for one's own plan. The same file also signs a payload that does not match Razorpay's documented scheme, compares with `!==`. |
| 2 | **HIGH** | **Payment methods are client-trusted.** A valid session is the only check; the route then stores a `pm_` string and a `last4` the client supplied. |
| 3 | **HIGH** | **No auth rate limiting.** Unmetered, unauthenticated login and signup permit credential stuffing, mass account creation, and quota farming. |
| 4 | **HIGH** | **Google OAuth is broken** â€” a full `code=â€¦&state=â€¦` string is passed where a bare code is expected, plus a 200 ms session race. The only non-password signup path is unavailable. |
| 5 | **MEDIUM** | **No CI, no pre-commit, no component tests, no billing tests, no security tests.** 222 tests exist and are never run automatically. |
| 6 | **MEDIUM** | **Worker `/status` and `/jobs` are unauthenticated**, publishing model IDs, quantization, full pipeline config, and 25 `video_id`s. |
| 7 | **MEDIUM** | **`INTERNAL_SERVICE_KEY` has no placeholder guard on the Next.js side, and `.env.example` ships it as `changeme`.** The worker fails closed on `changeme`; `isValidServiceKey` and `middleware.ts` do not — the latter returning early on a match and skipping every later check. Both use `===` rather than a constant-time compare. |
| 8 | **MEDIUM** | **No legal pages, no cookie consent, no data export, no account deletion** â€” while 17 dead footer links imply all of them exist. |
| 9 | **MEDIUM** | **No rate limiting on any route**, including `/api/ingest-url` and `/api/payments/create` (both session-authenticated, but neither rate limited). |
| 10 | **MEDIUM** | **No error tracking** on either tier. A failed LLM call leaves no row, no log, and no alert. |
| 12 | LOW | Silent failures render as data (`hooks.ts:99-101`); client-supplied `x-user-id` is still sent on every request; `api_keys` has RLS with zero policies and no FK; non-constant-time worker token compare; `"oom"` substring matching also matches "Zoom", "Broom", "Bloom"; interactive `<span>` elements are not keyboard-reachable; no FKs, CHECKs, or list indexes; secret redaction covers only two key names; storage cleanup is not surfaced on delete. |

### 4.2 Monetization â€” FAIL

**There is no revenue path. A user can sign up, use every capability forever, and never be charged.**

- All 4 landing pricing CTAs route to `/auth/signup`. Nothing is purchasable.
- `stripe.ts` ships `price_xxxxx` / `plan_xxxxx` placeholders; `/checkout/stripe` **does not exist** even though `StripeCheckout.tsx` navigates to it.
- No code in the repository ever writes to `subscriptions`. `/api/subscription` reads a table nothing populates.
- No route checks a plan. Every paid capability would be free for every user.
- No trial field, no trial logic. The "7-day free trial" claim has no implementation.
- No usage metering â€” `usage_logs` exists and is never read or written, so the "3 videos/month" free tier does not exist.
- No watermarking code in either direction, so both "No watermark" and "Watermarked exports" are false.
- No seat model, so "per seat" and "5 team seats" have nothing behind them.

### 4.3 Honesty â€” FAIL

**This is the finding that should carry the most weight in the launch decision, and it is the one least likely to be raised by the engineering team.**

The public site presents, as fact: 6 named testimonials with roles and follower counts; 10 brand logos and "10,000+ creators" for a product with zero users; ~14 performance statistics including "+266% impressions" and "1â†’3% to 12%+ full-view"; a table showing complete performance for 5 social platforms this product has never posted to; "97%+ caption accuracy" and "14 languages" (the second true, the first unmeasured); "AI Producer", "AI B-Roll", "AI Reframe", "AI Editor", "Animated captions", "Social scheduler", "XML export", "AI thumbnails", "Brand templates", "Team workspace" â€” ten capabilities with no code, no tables, and no routes; a public REST API and MCP server that do not exist, presented without a "Soon" label in two of three places; and an API page that **fabricates an API key in the browser** (`'kx_live_' + 'x'.repeat(32)`) so that a user who copies it gets a literal run of 32 `x`s.

**None of this appears malicious, and that is precisely the problem.** Each of these was almost certainly written as aspirational copy, then never reconciled against the code as the code grew. But the compounding effect is that a technical reader, a customer, or a journalist comparing the site to the repository will conclude the product is not trustworthy â€” and on the evidence available to them, that conclusion would be correct.

The remedy is cheap. Section 3 of the audit contains a claim-by-claim list with recommended replacement copy, and the work is roughly one day.

### 4.4 Reliability and observability â€” FAIL

The pipeline fails loudly and precisely, which is excellent: 16 error codes mapped to HTTP statuses, sanitized messages, 21 passing error tests, and a `RENDER_FAILED` that cannot be silently swallowed.

The **application** fails quietly. `hooks.ts:99-101` swallows every error and returns the fallback, so a 500 on the analytics page renders the page's fabricated dashboard instead of an error message. A blocked LLM call records nothing. There is no error tracking on either tier, no metrics, no tracing, and no alerting. A production incident in the app would be discovered by a user, not by a monitor.

### 4.5 Data model â€” CONDITIONAL

`schema.sql` and `ai_pipeline.sql` are real, with RLS enabled and `PRIVATE` buckets. But `ai_pipeline.sql` has no foreign keys, no CHECK constraints, no unique constraints, no index on any foreign key, and no index on `(user_id, created_at)` â€” which every dashboard list query depends on. `supabase/migrations/` is empty while three competing SQL files sit side by side, inviting drift. `api_keys` has RLS enabled with zero policies and a `user_id` with no foreign key, making it effectively ownerless, and it ships a `SECURITY DEFINER` lookup RPC that nothing consumes.

---

## 5. THE THREE-WEEK PATH TO LAUNCH

Full sequencing is in `KRIX_FEATURE_IMPLEMENTATION_PLAN.md`. The shortest credible route:

| Days | Work | Result |
|---|---|---|
| **1** | P0-7: align every marketing claim with the code. Apply the replacements in audit section 3. Remove the fake API-key generator. | The single largest reputational risk is closed. Cost: hours. |
| **0.5** | P0-1: delete the client-callable payment verify route. | Critical finding closed. |
| **0.5** | P0-2, P0-4: stop returning private keys; derive `last4` from the provider. | High findings closed. |
| **0.5** | P0-3: fix the `videos!inner` object/array bug. | Content edit and delete go from 500 to working. |
| **0.5** | P0-5, P0-6: fix Google OAuth; reject placeholder `INTERNAL_SERVICE_KEY` values; close the middleware matcher gap. | High findings closed. |
| **0.5** | P0-8: strip the fabricated analytics; add real error states. | Dashboard honesty closed. |
| **2** | P0-9: one working checkout â€” real price IDs, the missing `/checkout/stripe` route, verified webhooks, subscription upsert. | A revenue path exists. |
| **1** | P0-10, P0-11: auth rate limiting; CI running `tsc`, `lint`, `pytest`, Playwright. | Abuse controls; regressions caught. |
| **1** | P0-12: `/privacy`, `/terms`, cookie consent, export and delete. | Legal exposure closed. |
| **1.5** | P1-1: unblock repurposing â€” `max_tokens=2000`, wire the already-written local heuristic as a labelled draft, record failures durably. | The headline promise produces output. |
| **~8** | Remainder of P1. | Every dashboard route shows real data. |

**Approximately 3 weeks of focused work to reach honest, safe, sellable early access.**

### The three items with the best return on effort

1. **Align the marketing claims (1 day).** Removes the largest reputational exposure in the company for the cost of a day.
2. **Wire the existing local heuristic (0.5 day).** `ai-provider.ts:109-134` already computes a deterministic, transcript-derived 5-content pack that the code then discards. It is three lines from being used, requires no credits, and converts "repurposing has never produced a single row" into "works offline today."
3. **Build Smart Reframe, but first** â€” it is P2, not P1, precisely so it does not get rushed. `vision.py` already computes `speaker_position` and `visual_interest` and throws them away, so the expensive analysis is already paid for. The remaining work is arithmetic in the renderer. The marketing site should not claim it until then.

---

## 6. LAUNCH GATE

A launch decision should be **denied** today. It should be **granted** when all of the following are demonstrably true â€” each is testable, and each is listed so the decision cannot be made on sentiment.

| # | Gate criterion | Verified by |
|---|---|---|
| 1 | No route outside a signature-verified provider webhook can write to `subscriptions` | Code review plus a test posting a forged payload to every payment route |
| 2 | No private key appears in any HTTP response | Already satisfied: `secretKey` appears 0 times in `src/`; no payment route returns a private key. Re-verify after any billing change |
| 3 | `PUT` and `DELETE /api/content/[id]` succeed for the owner and fail for everyone else, returning neither 500 | Two route tests |
| 4 | Google sign-in completes | Manual test |
| 5 | A test-mode payment produces a `subscriptions` row visible on `/dashboard/settings` | Manual end-to-end test |
| 6 | No claim on the public site describes a capability absent from the code | Line-by-line review against audit section 3 |
| 7 | No fabricated testimonial, brand, follower count, or performance statistic remains | Review |
| 8 | With the network blocked, the analytics page shows an error and never a dashboard | Manual test |
| 9 | Every footer link resolves to a real page | Link checker in CI |
| 10 | Login and signup are rate limited | Test |
| 11 | `tsc`, `lint`, `pytest`, and Playwright all run on every push | CI goes red on a deliberate failure |
| 12 | `x-service-key: changeme` is rejected on every protected path, and `/api/analytics`, `/api/content`, `/api/payments` are in the middleware matcher | Test |
| 13 | A 1-hour video has frames analysed across its full duration | Measure sample timestamps |
| 14 | A thumbnail failure does not fail a render | Fault-injection test |

**Criteria 6, 7, and 8 are the ones that will be checked by someone outside engineering.** They are listed explicitly because they are the ones most likely to be quietly dropped under delivery pressure, and because they are the difference between a product that is merely unfinished and a product that is misleading.

### What may ship at the gate

- **The marketing site**, rewritten honestly, with a reduced capability set.
- **Email/password authentication** and Google OAuth once fixed.
- **The upload and processing experience** â€” genuinely good.
- **The clip pipeline** â€” genuinely excellent.
- **One working checkout** on real price IDs.
- **The analytics page showing five real counters**, honestly labelled as a starting point.

### What must wait

Anything requiring multi-tenancy (Team), anything requiring new model providers (B-roll, AI thumbnails, Custom AI Training), platform publishing across more than one network, the public `/v1` API, and the MCP server.

---

## 7. RISK REGISTER

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | The site continues to advertise unbuilt capabilities while a real user is onboarded | **High** | Severe â€” reputational, and legally risky once payment data is collected | P0-7 as a hard gate, not a backlog item |
| R2 | A user self-activates a paid plan, then the product is shipped in that state | **High** | Moderate â€” direct revenue loss, plus a bad first impression | P0-1 |
| R3 | Supabase or service credentials are committed to git, or a placeholder service key reaches production | **Low** | **Severe** - full database compromise | `.gitignore` is already correct; P0-6 rejects placeholder keys at runtime; audit `git log` and rotate if an env file is found |
| R4 | A pipeline regression ships undetected | **Medium** | Severe â€” the only real asset | P0-11 CI |
| R5 | A failed repurpose is reported as a success, or never noticed | **High** | Moderate | P1-1 durable failure records; P1-15 error tracking |
| R6 | Analytics continue to render invented data after a fetch failure | **High** | Severe â€” the product appears to work while lying | P0-8, verified by gate criterion 8 |
| R7 | Multi-tenancy is started casually for Projects/Team and stalls | **Medium** | High â€” a half-built tenancy model is worse than none | Section 6 of the implementation plan; decide before Phase 1 |
| R8 | A public API ships before rate limiting | **Low** | High â€” unmetered video processing exposed | Enforce P1-13 before P2-7 |
| R9 | `max_tokens` is raised to "fix" the credit error, burning more quota for the same output | **Medium** | Low | Documented in the implementation plan's anti-goals; the fix is 2000, not more |
| R10 | The thumbnail bug destroys good renders in production | **Medium** | Moderate | P1-8; gate criterion 14 |

---

## 8. FINAL ASSESSMENT

Krix is **not a prototype**. The upload-to-clip path is real, tested, and defensible in front of a technical audience: 222 passing worker tests (34 of them real GPU and FFmpeg integration) and 3 Playwright browser specs, private per-user storage with ownership checks on every read, and genuinely careful handling of the hardest problems â€” overlapping ASR chunks, monotonic word timings, bounded LLM output, adversarial clip candidates, and GPU memory pressure on a single card.

Krix is **not yet a product**. Of 177 audited features, 47 work. Six of the eight dashboard routes are mock or blocked. There is no revenue path, no analytics, no projects, no calendar, no team, no API, and no MCP. The site promises roughly 30 capabilities and delivers 6, backed by 6 invented testimonials and 14 invented statistics.

**The gap is not technical capability. It is the distance between what the engineering built and what the company claims.** That distance is unusually large, and it is unusual in a recoverable way: the fix is mostly deletion â€” of copy, of mocks, and of one unsafe route â€” plus about three weeks of wiring real endpoints to real pages.

**Recommendation: deny the launch, fund the three-week plan, and re-review against the 14 gate criteria in section 6.** Do not start Phase 2. Do not add a single new AI capability. The core does not need more AI; the product needs to become true.
