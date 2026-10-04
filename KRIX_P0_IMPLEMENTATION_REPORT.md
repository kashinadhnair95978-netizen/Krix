# Krix P0 Implementation Report

Status of the P0 launch blockers in `docs/KRIX_PROJECT_PLAN.md` (audit findings
A-01 … A-12). Remediation of commit `5711f9d` on `main`.

Every item is classified **COMPLETE**, **PARTIAL**, **BLOCKED BY EXTERNAL
DEPENDENCY**, **FAILED**, or **DEFERRED**, and each classification names the check
that produced it. Nothing is COMPLETE on the strength of having been typed.

Scope held throughout:

- Full-video visual sampling with Qwen3-VL is **P1-9** and thumbnail failure is
  **P1-8**. Both are out of P0 scope and were not touched. Qwen3-ASR,
  Qwen3-ForcedAligner, Qwen3-VL, Mistral, ModelManager, FFmpeg, captions,
  storage, clip validation, and the GPU memory strategy are unchanged.
- No P1/P2/P3 item was started. No new product feature was added.

---

## Verification log

Every command below was run with a hard timeout; none was allowed to run
indefinitely.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean, no diagnostics |
| `npm run lint` | `No ESLint warnings or errors` |
| `ai-worker/.venv/Scripts/python -m pytest -q` | 244 tests, 0 failures, 0 errors, 28 skipped (69.97 s) |
| `npx playwright test e2e/p0-security.spec.ts` | **20 passed** (2.2 m) |

The 28 pytest skips are the GPU integration tests, which self-skip through
`tests/conftest.py` when CUDA is absent. The Playwright run used a live
`next dev` server with real Supabase credentials and created no financial
transaction of any kind.

Environment facts established by read-only probe against the live Supabase
project (no writes):

- `subscriptions` and `payments` both exist and both hold **0 rows**.
- Every column the payment code reads or writes exists (16/16 probed present),
  including all four columns the migration indexes.
- `auth/v1/settings` reports **`external.google = false`** — the Google provider
  is not enabled on this project.
- No `DATABASE_URL`, `SUPABASE_DB_PASSWORD`, or `SUPABASE_ACCESS_TOKEN` exists
  in this environment, so no DDL can be executed here.

---

## 1. Payment: real checkout, provider-authoritative activation

**PARTIAL (code complete and verified) / BLOCKED BY EXTERNAL DEPENDENCY (live
checkout, webhook, subscription activation)**

What the P0 required: no client-supplied payload may decide that a payment
happened.

What changed:

- `src/app/api/payments/create/route.ts` (new, replaces the deleted
  `stripe/route.ts` and `razorpay/route.ts`) is the single checkout entry
  point. It requires a Supabase session, resolves the plan through
  `src/lib/plans.ts`, and creates a real Stripe Checkout Session or a real
  Razorpay subscription using server-held keys. The browser receives only an
  opaque checkout URL or `subscriptionId`; no secret crosses the wire, and no
  response contains a claim that a payment occurred.
- `src/app/api/payments/razorpay/confirm/route.ts` (new) treats Razorpay's
  client handler as an untrusted hint. It checks ownership first, then verifies
  `HMAC_SHA256(order_id + "|" + payment_id, key_secret)`, then re-reads the
  payment from Razorpay's API and requires a captured state. Activation cannot
  be reached with a forged signature.
- `src/app/api/payments/verify/route.ts` (deleted). This was the P0 defect: it
  activated a subscription from a client-supplied `paymentId` + `signature`, and
  a signature alone is not proof of capture.
- `src/app/api/payments/webhook/route.ts` is the authority. It verifies Stripe's
  `stripe-signature` and Razorpay's `x-razorpay-signature` before any database
  write, handles `checkout.session.completed`, `customer.subscription.*`,
  `invoice.paid`, `subscription.activated`, `payment.cancelled`,
  `payment.captured`, and de-duplicates the ledger on `external_payment_id` so
  at-least-once provider delivery cannot double-count revenue.
- `src/lib/plans.ts` (new) is the plan catalogue. Provider identifiers come from
  the environment with **no defaults**, and `isPlaceholderSecret()` treats
  `xxxxx` / `changeme` / `placeholder` / short values as unset. A missing id
  yields `PAYMENT_PROVIDER_NOT_CONFIGURED` (503), never a guessed amount.
- `src/lib/stripe.ts` and `src/lib/razorpay.ts` fail closed: a placeholder or
  absent key throws rather than constructing a client that appears functional.
- `src/app/api/subscription/payment-method/route.ts` resolves the owning Stripe
  customer server-side and takes `last4` / `brand` from the provider, never from
  the request body.

Verified: `P0-SEC-1`, `P0-SEC-2`, `P0-SEC-3`, `P0-SEC-4`, `P0-SEC-5`, `P0-SEC-6`,
`P0-SEC-7`, `P0-SEC-8`, `P0-SEC-9` — all pass. `P0-SEC-5` and `P0-SEC-6` are
meaningful precisely because the placeholder credentials **cannot** produce a
fake success: they assert the 503 fail-closed path and the absence of any
secret in any response body.

### BLOCKED BY EXTERNAL DEPENDENCY — exact configuration required

No real credentials exist. `.env.local` contains only placeholders
(`sk_live_xxxxx`, `pk_live_xxxxx`, `whsec_xxxxx`, `rzp_live_xxxxx`, empty
`RAZORPAY_KEY_SECRET`) and `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` are empty. **No real charge was attempted.**

To unblock, set these and restart:

Stripe — `STRIPE_SECRET_KEY` (`sk_test_…` first), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
(`pk_test_…`), `STRIPE_WEBHOOK_SECRET` (`whsec_…` from the webhook endpoint),
plus one recurring price id per plan: `STRIPE_PRICE_BASIC`,
`STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`.

Razorpay — `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` (`rzp_test_…`),
plus one plan id per plan: `RAZORPAY_PLAN_BASIC`, `RAZORPAY_PLAN_PRO`,
`RAZORPAY_PLAN_ENTERPRISE`.

Webhook — register `POST {KRIX_APP_URL}/api/payments/webhook` in both
dashboards, subscribed to `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid` (Stripe) and
`subscription.activated`, `subscription.cancelled`, `payment.captured`
(Razorpay).

Then: re-run `npm run test:e2e`, and drive one real test-mode checkout per
provider to confirm the subscription activates **from the webhook**, not from
the return trip. Until that happens, this section must not be read as "billing
works" — only as "the code no longer trusts the client".

---

## 2. Payment security helpers

**COMPLETE**

`src/lib/payment-security.ts` (new) provides constant-time comparison,
`hmacSha256Hex`, Razorpay signature verification in the documented
`order_id|payment_id` form (the previous code signed
`payment_id|subscription_id`, which can never match, and compared with `!==`),
and one `paymentError()` shape so no handler can leak a stack trace or a raw
provider response. `src/lib/auth-utils.ts` uses the same constant-time compare
for the internal service key, and `ai-worker/app/main.py` was changed from `!=`
to `hmac.compare_digest` for the worker bearer token, closing the same timing
oracle on the Python side.

Verified: `tsc --noEmit` clean; full pytest suite green; `P0-KEY-1` … `P0-KEY-3`
pass.

---

## 3. Content API ownership

**COMPLETE**

`src/app/api/content/[id]/route.ts` read a many-to-one `videos` join as if it
were an array, so `PUT` and `DELETE` failed with HTTP 500 for *every* id. It now
selects the owning `videos.user_id`, scopes both statements to the authenticated
user, and has explicit branches for malformed ids and missing rows so neither
can reach a 500.

Verified: `P0-CONTENT-1` (401 unauthenticated), `P0-CONTENT-2` (404, not 500, for
a missing row), `P0-CONTENT-3` (client error for `not-a-uuid`, `../../etc/passwd`
and `%00`) all pass against a live server with real Supabase auth.

---

## 4. Internal service key

**COMPLETE**

`src/lib/auth-utils.ts` rejects the literal `changeme` and compares in constant
time. `src/middleware.ts` adds `/api/analytics`, `/api/content`, and
`/api/payments` to the protected matcher, and `assertProductionServiceKey()`
throws before serving any traffic when `NODE_ENV === 'production'` and the key is
still a placeholder, so the process refuses to start rather than accept a public
secret. That check is deliberately skipped during `next build`
(`NEXT_PHASE === 'phase-production-build'`) so a container image can be built
before production secrets are injected. `.env.example` documents generating the
value with `openssl rand -hex 32` and notes the Python worker independently
refuses `changeme`.

Verified: `P0-KEY-1`, `P0-KEY-2`, `P0-KEY-3` pass — `changeme` and a garbage key
are rejected on every protected path, and all four return 401 with no credentials.

Note for the operator: both `INTERNAL_SERVICE_KEY` and `AI_WORKER_API_KEY` in
`.env.local` are real values (36 and 32 characters, no placeholder marker), so
the production guard will **not** fire for them. Nothing verifies they are not
reused from another environment.

---

## 5. Google OAuth

**PARTIAL (fix verified) / BLOCKED BY EXTERNAL DEPENDENCY (real round-trip)**

The defect was concrete: `src/app/auth/callback/page.tsx` sliced the whole query
string and handed `code=…&state=…` to `exchangeCodeForSession`, which expects the
bare code, and then navigated after a fixed 200 ms sleep. Every Google sign-in
failed and some produced a signed-out dashboard.

The fix reads `code`, `error`, and `error_description` with `URLSearchParams`,
reports a provider error or a missing code instead of spinning forever, checks
the `exchangeCodeForSession` error, awaits `getSession()` before navigating,
creates the missing profile row for OAuth users, and uses a single
`router.replace` guarded by a `cancelled` flag so a late async resolution cannot
set state on an unmounted component. The initiation side
(`src/components/auth/GoogleSignIn.tsx`) was confirmed to request
`redirectTo: ${origin}/auth/callback`, which is the route under test — so the
two halves agree.

Verified: `P0-OAUTH-1` (a callback with no code reports the failure, shows a
recovery link, throws no page error, and does not navigate), `P0-OAUTH-2` (a
rejected code establishes no session and does not reach `/dashboard`), and
`P0-OAUTH-3` (the Google button either redirects to the provider or reports an
error — never an indefinite spinner) all pass.

### BLOCKED BY EXTERNAL DEPENDENCY — exact configuration required

A completed round-trip cannot be performed here, and **no credentials were
invented**:

- `auth/v1/settings` on the live project reports **`external.google = false`** —
  the Google provider is disabled, so there is nothing for a code exchange to
  succeed against.
- No Google client id or secret exists in `.env.local` or any other env file.
- A round-trip also requires a real Google account, which cannot be automated.

To unblock: in Supabase → Authentication → Providers, enable **Google** with a
Google Cloud OAuth client id and secret; in Google Cloud Console, register the
authorized redirect URI `{NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback` and add
`http://localhost:3000/auth/callback` to the Supabase project's allowed redirect
URLs; then re-run the `P0-OAUTH-*` tests plus one manual sign-in.

Until then this item is **not** COMPLETE. The fix is verified; the round-trip is
not.

---

## 6. Rate limiting on auth

**COMPLETE**

`src/lib/rate-limit.ts` (new) is a fixed-window in-process limiter. Login is
throttled on two independent keys — `login:ip:<addr>` and
`login:email:<email>` — so neither a single account brute-forced from many IPs
nor a distributed spray against one account gets a clean run. Signup is throttled
per IP and per email. Limits are applied before any password or email lookup, and
a `429` carries a `Retry-After` header alongside the message.

Verified: `P0-RATE-1` (16 bad logins for one email produce at least one `429`,
every response is `401` or `429`) and `P0-RATE-2` (signup burst is throttled)
both pass.

One finding from this work, recorded because it changes how the suite is run: the
signup limiter (10 per IP per hour) legitimately throttles a second suite run
against a long-lived dev server. That is the P0 rate limiting working, not a
defect. `e2e/p0-security.spec.ts` therefore uses deterministic account emails and
falls back to signing the existing account back in when signup answers `400
already registered` or `429`. The `resetRateLimiting` test seam in
`rate-limit.ts` is intentionally **not** exposed over HTTP; wiring a limiter
reset to a route would be a new backdoor.

Limitation stated plainly: the limiter is per-process. It is correct for the
single-instance deployment and ineffective behind a multi-replica load balancer.
Redis is the documented upgrade path and needs no call-site change.

---

## 7. Database migration

**BLOCKED BY EXTERNAL DEPENDENCY (migration verified applicable; cannot be
applied from this environment)**

The exact migration is
`supabase/migrations/202609300001_p0_billing_integrity.sql`. It creates three
indexes and nothing else:

- `idx_subscriptions_recurring_id` on `subscriptions (recurring_id)` — every
  provider webhook resolves ownership by `recurring_id` alone, but the existing
  `UNIQUE(user_id, recurring_id)` index is keyed on `user_id` first, so those
  lookups were sequential scans.
- `idx_payments_external_payment_id` on `payments (external_payment_id)` —
  webhook delivery is at-least-once, and both the webhook and the Razorpay
  confirm route de-duplicate on this id so a provider retry cannot double-count
  revenue.
- `idx_subscriptions_user_created` on `subscriptions (user_id, created_at DESC)`
  — `GET /api/subscription` reads "this user's most recent subscription".

It is additive and idempotent: `CREATE INDEX IF NOT EXISTS` only, no column
dropped, no data rewritten, no RLS policy changed, existing rows untouched. The
same three indexes are mirrored in `src/components/supabase/schema.sql` so a
fresh install matches.

Deliberate omission, documented in the file itself: a `UNIQUE` index on
`payments(external_payment_id)` is **not** created. It would fail on any table
already holding duplicate provider ids, and silently de-duplicating revenue rows
is not a P0 change. Application-level de-duplication already prevents new
duplicates.

### Pre-flight verification performed against the live project (read-only)

- All four indexed columns exist: `subscriptions.recurring_id`,
  `subscriptions.user_id`, `subscriptions.created_at`,
  `payments.external_payment_id`. **The migration will apply cleanly.**
- A wider conformance probe confirmed **16 of 16** columns the payment code
  reads or writes are present, including `subscriptions.payment_id`,
  `payment_method`, `monthly_price`, `currency`, and every `payments` ledger
  column. No payment write would fail on a missing column.
- `subscriptions` and `payments` each hold **0 rows**, so the migration cannot
  lock or slow a live table.
- Nothing was created, altered, or dropped. The probe used PostgREST `select`
  only.

### Why it is still BLOCKED

DDL cannot be executed from this environment: there is no `DATABASE_URL`, no
`SUPABASE_DB_PASSWORD`, and no `SUPABASE_ACCESS_TOKEN`, and the service-role key
exposes only REST/RPC — it cannot run arbitrary SQL. No destructive SQL was
attempted.

Required action, one of:

1. **Supabase SQL Editor** — paste the contents of
   `supabase/migrations/202609300001_p0_billing_integrity.sql` and run.
2. **CLI** — `supabase link --project-ref <ref>` then `supabase db push`
   (requires the database password).
3. **psql** — `psql "$DATABASE_URL" -f supabase/migrations/202609300001_p0_billing_integrity.sql`.

Verify afterwards with:

```sql
select indexname from pg_indexes
where indexname in (
  'idx_subscriptions_recurring_id',
  'idx_payments_external_payment_id',
  'idx_subscriptions_user_created'
);
```

Three rows must be returned. Until that query returns three rows, this item is
not COMPLETE.

---

## 8. Frontend payment UX

**PARTIAL (code complete and type-checked) / BLOCKED BY EXTERNAL DEPENDENCY (never
exercised against a live provider)**

`src/app/pricing/page.tsx` polls subscription state after checkout and reflects
what the *server* reports, so the success screen is not driven by a client-side
assumption. `PaymentSelector.tsx` was updated for the new response shape.
`StripeCheckout.tsx` and `RazorpayCheckout.tsx` were rewritten: both post to
`/api/payments/create`, and the Razorpay component reports success **only** when
`/api/payments/razorpay/confirm` returns `verified: true` — its failure path
tells the user their plan is unchanged rather than showing a false success. The
removed `verifyPayment` client helper was replaced by `createPayment` and
`confirmRazorpayPayment` in `src/lib/api-client.ts`.

Verified: `tsc --noEmit` clean, `npm run lint` clean.

Not verified: no checkout was driven through a real provider, so this UI has
never been exercised against a live Stripe or Razorpay page. That depends on §1.

---

## 9. Security regression tests

**COMPLETE**

`e2e/p0-security.spec.ts` is an API-level suite, because every bug in §1–§6 is
"the route answered 200 where it should have answered 401 or 404". It signs up
real users through the app's own signup route, signs them in through the real
login form, and asserts on the boundary rather than internals. No test performs a
real financial charge.

**20 tests, all passing** against a live dev server with real Supabase
credentials:

| Test | Asserts |
| --- | --- |
| P0-SEC-1 | the deleted verify route does not accept a forged payload |
| P0-SEC-2 | a forged provider payload activates nothing; subscription stays null |
| P0-SEC-3 | checkout requires a session; the error carries no stack trace |
| P0-SEC-4 | unknown plan and unknown provider are 400 |
| P0-SEC-5 | unconfigured provider fails closed 503 with an actionable message |
| P0-SEC-6 | no payment response body ever contains a provider secret |
| P0-SEC-7 | unsigned / bad-signature webhooks are refused |
| P0-SEC-8 | user B cannot confirm user A's subscription; B still has none |
| P0-SEC-9 | payment-method update needs auth and refuses a foreign `pm_` id |
| P0-CONTENT-1/2/3 | 401 unauthenticated, 404 for missing, client error for malformed |
| P0-KEY-1/2/3 | `changeme` and garbage keys rejected; no-credentials is 401 |
| P0-RATE-1/2 | login and signup both throttle |
| P0-OAUTH-1/2/3 | callback failure paths report instead of hanging; no session from a rejected code; the Google button never spins forever |

Run with `npm run test:e2e` (needs a server on `KRIX_APP_URL`).

---

## 10. CI and test scripts

**COMPLETE**

`package.json` gains `typecheck`, `test:worker`, `test:e2e`, `test:e2e:all`, and
an aggregate `test`. `.github/workflows/ci.yml` runs three jobs on push and pull
request:

- **static** — `npx tsc --noEmit` and `npm run lint` on every change.
- **worker** — the full pytest suite on every change, with ffmpeg installed and an
  explicit libass assertion, because captions are burned in via the `ass` filter
  and a build without it silently drops the caption step.
- **e2e** — the Playwright suite, gated on the repository variable
  `PLAYWRIGHT_HAS_SUPABASE == 'true'` and documented with the secrets it needs
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_SERVICE_KEY`). Every spec signs up real
  users, so running it without credentials would report a red build meaning "no
  credentials" rather than "broken code". It is skipped loudly instead.

The workflow has not been executed — this repository has no remote CI run in its
history — so it is COMPLETE as configuration, not as a green badge.

---

## Summary

| # | Item | Status |
| --- | --- | --- |
| 1 | Payment: provider-authoritative activation | **PARTIAL** — code verified; **BLOCKED BY EXTERNAL DEPENDENCY** for live checkout/webhook |
| 2 | Payment security helpers | **COMPLETE** |
| 3 | Content API ownership | **COMPLETE** |
| 4 | Internal service key | **COMPLETE** |
| 5 | Google OAuth | **PARTIAL** — failure paths verified; **BLOCKED BY EXTERNAL DEPENDENCY** for the round-trip |
| 6 | Auth rate limiting | **COMPLETE** |
| 7 | Database migration | **BLOCKED BY EXTERNAL DEPENDENCY** — pre-flight verified, cannot be applied here |
| 8 | Frontend payment UX | **PARTIAL** — code verified; never run against a live provider |
| 9 | Security regression tests | **COMPLETE** — 20/20 |
| 10 | CI and test scripts | **COMPLETE** — configuration written, not yet executed in CI |

No item is **FAILED**. No item is **DEFERRED** within P0.

### Remaining external requirements, in order

1. **Apply the migration.** Paste or push
   `supabase/migrations/202609300001_p0_billing_integrity.sql`, then confirm the
   `pg_indexes` query in §7 returns three rows.
2. **Configure Google OAuth.** Enable the provider in Supabase with a Google
   Cloud client id/secret and register `{SUPABASE_URL}/auth/v1/callback`. Then
   run one manual sign-in.
3. **Configure Stripe and Razorpay test mode** with the variables listed in §1,
   register the webhook at `POST {KRIX_APP_URL}/api/payments/webhook`, then drive
   one real test-mode checkout per provider and confirm activation arrives via
   the webhook.
4. **Enable the CI e2e job** by setting `PLAYWRIGHT_HAS_SUPABASE=true` and the
   four Supabase/service-key secrets.

Items 1–3 are configuration and credentials, not code. No further code change is
required for them.

### Explicitly deferred to P1

- P1-8: thumbnail failure.
- P1-9: full-duration Qwen3-VL visual sampling.

Neither was modified.