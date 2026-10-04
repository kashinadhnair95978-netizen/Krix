# Krix P0 Implementation Report

Status of the P0 launch blockers in `docs/KRIX_PROJECT_PLAN.md` (audit findings
A-01 … A-12). Written against commit `5711f9d` on `main`.

Every item below is classified **COMPLETE**, **IN PROGRESS**, **NOT STARTED**, or
**BLOCKED BY EXTERNAL DEPENDENCY**, with the evidence that produced the
classification. Nothing is marked COMPLETE on the strength of having been typed;
each one names a check that was actually run.

Scope decisions carried from the plan and held to here:

- Full-video visual sampling with Qwen3-VL is **P1-9** and thumbnail failure is
  **P1-8**. Both are out of P0 scope. Qwen3-ASR, Qwen3-ForcedAligner,
  Qwen3-VL, Mistral, ModelManager, FFmpeg, captions, storage, clip validation,
  and the GPU memory strategy were left untouched.

---

## 1. Payment: real checkout, provider-authoritative activation

**COMPLETE (code) / BLOCKED BY EXTERNAL DEPENDENCY (live checkout)**

What the P0 required: no client-supplied payload may decide that a payment
happened.

What changed:

- `src/app/api/payments/create/route.ts` (new, replaces the deleted
  `stripe/route.ts` and `razorpay/route.ts`) is the single checkout entry point.
  It requires a Supabase session, resolves the plan through `src/lib/plans.ts`,
  and creates a real Stripe Checkout Session or a real Razorpay subscription
  using server-held keys. The browser only ever receives an opaque checkout URL
  or `subscriptionId`; no secret crosses the wire.
- `src/app/api/payments/razorpay/confirm/route.ts` (new) handles Razorpay's
  return. The client handler is treated as an untrusted hint: the route checks
  the `HMAC_SHA256(order_id + "|" + payment_id, key_secret)` signature, then
  re-reads the payment and subscription from Razorpay's API before writing.
  Activation requires the provider's own captured state.
- `src/app/api/payments/verify/route.ts` (deleted). This was the P0 bug: it
  activated a subscription from `paymentId` + `signature` that the client
  supplied, and a signature alone is not proof of capture.
- `src/app/api/payments/webhook/route.ts` is now the authority. It verifies
  Stripe's `stripe-signature` and Razorpay's `x-razorpay-signature` before
  touching the database, handles `checkout.session.completed`,
  `customer.subscription.*`, `invoice.paid`, `subscription.activated`,
  `payment.captured`, and `subscription.cancelled`, and guards every ledger
  write against replay by checking for an existing payment row first.
- `src/lib/plans.ts` (new) is the plan catalogue. Price and plan ids come from
  the environment with no hardcoded defaults, so a missing id produces
  `PAYMENT_PROVIDER_NOT_CONFIGURED` (503) rather than charging a guessed amount.
- `src/lib/stripe.ts` and `src/lib/razorpay.ts` now fail closed: a placeholder or
  absent key throws instead of constructing a client that appears to work.

Evidence: `tsc --noEmit` clean. `P0-SEC-1`, `P0-SEC-2`, `P0-SEC-5`, `P0-SEC-6`
pass (see §9). `P0-SEC-5` asserts the fail-closed 503 path, which is the only
payment behaviour testable here.

**BLOCKED BY EXTERNAL DEPENDENCY:** no real Stripe or Razorpay credentials,
price ids, plan ids, or webhook secrets exist in this environment. A live
charge, signature acceptance, and webhook-driven activation are therefore
**unverified**. Do not treat this section as "billing works"; treat it as "the
code no longer trusts the client".

---

## 2. Payment security helpers

**COMPLETE**

`src/lib/payment-security.ts` (new) provides constant-time string comparison,
Razorpay HMAC in the `order_id|payment_id` form, and a single
`paymentError()` shape so no handler can accidentally leak a stack trace or
provider response. `src/lib/auth-utils.ts` uses the same comparison for the
internal service key. `ai-worker/app/main.py` was changed from `!=` to
`hmac.compare_digest` for the worker bearer token, closing the same timing
oracle on the Python side.

Evidence: `tsc --noEmit` clean. `ai-worker` pytest suite: **244 tests, 0 failures,
0 errors, 28 skipped** (69.97s) on this CPU-only box; the skips are the GPU
integration tests, which self-skip without CUDA. `P0-KEY-1` … `P0-KEY-3` pass.

---

## 3. Content API ownership

**COMPLETE**

`src/app/api/content/[id]/route.ts` read a many-to-one `videos` join as if it
were an array, so PUT and DELETE failed for *every* id. It now selects the
owning `videos.user_id`, scopes both statements to the authenticated user, and
has explicit branches for malformed ids and missing rows so neither can reach a
500.

Evidence: `P0-CONTENT-1` (401 unauthenticated), `P0-CONTENT-2` (404, not 500, for
a missing row), `P0-CONTENT-3` (client error for malformed ids) all pass against
a live server with real Supabase auth.

---

## 4. Internal service key

**COMPLETE**

`src/lib/auth-utils.ts` rejects the literal `changeme` and compares in constant
time, so a deployment that forgot to generate a key fails loudly instead of
accepting a public one. `src/middleware.ts` adds `/api/analytics`,
`/api/content`, and `/api/payments` to the protected matcher, and
`assertProductionServiceKey()` throws before serving any traffic when
`NODE_ENV === 'production'` and the key is still a placeholder — so the process
refuses to start rather than accept a public secret. That check is deliberately
skipped during `next build` (`NEXT_PHASE === 'phase-production-build'`) so a
container image can be built before production secrets are injected.
`.env.example` documents generating the value with `openssl rand -hex 32` and
notes that the Python worker independently refuses `changeme`.

Evidence: `P0-KEY-1`, `P0-KEY-2`, `P0-KEY-3` pass; `changeme` and a garbage key
are both rejected on every protected path, and all four paths return 401 with no
credentials.

---

## 5. Google OAuth callback

**IN PROGRESS**

`src/app/auth/callback/page.tsx` had a concrete Google sign-in bug: it sliced the
whole query string and handed `code=...&state=...` to `exchangeCodeForSession`,
which expects the bare code, so every Google sign-in failed. It now reads
`code`, `error`, and `error_description` with `URLSearchParams`, reports a
provider error or a missing code instead of rendering a spinner forever, checks
the `exchangeCodeForSession` error, and awaits `getSession()` before navigating —
the old code waited a fixed 200 ms and then navigated, which intermittently
produced a signed-out dashboard. It also creates the missing profile row for
OAuth users and uses a single `router.replace`, guarded by a `cancelled` flag so
a late async resolution cannot set state on an unmounted component.

Evidence: `tsc --noEmit` and lint pass. **Not verified:** no OAuth round-trip was
performed, because that needs real Google client credentials and a browser
redirect. Behaviour in the failure path is untested.

---

## 6. Rate limiting on auth

**COMPLETE**

`src/lib/rate-limit.ts` (new) is a fixed-window in-process limiter used by
`/api/auth/login` and `/api/auth/signup`. Login is throttled on two independent
keys — `login:ip:<addr>` and `login:email:<email>` — so neither a single account
brute-force from many IPs nor a distributed credential spray against one account
gets a clean run. Limits are applied before any password or email lookup, and a
`429` carries a `Retry-After` header alongside the message.

Evidence: `P0-RATE-1` (16 bad logins for one email produce at least one `429`,
and every response is `401` or `429`) and `P0-RATE-2` (signup burst is throttled)
both pass.

Limitation, stated plainly: the limiter is per-process. It is correct for the
single-instance deployment and worthless behind a multi-replica load balancer.
Moving to Redis is a follow-up, not a P0.

---

## 7. Database migration

**IN PROGRESS**

`supabase/migrations/202609300001_p0_billing_integrity.sql` (new) adds three
indexes the payment and webhook paths depend on:

- `subscriptions(recurring_id)` — every provider webhook resolves ownership by
  `recurring_id` alone, but the existing `UNIQUE(user_id, recurring_id)` index is
  keyed on `user_id` first, so those lookups were sequential scans.
- `payments(external_payment_id)` — webhook delivery is at-least-once, and both
  the webhook and the Razorpay confirm route de-duplicate on this id so a
  provider retry cannot double-count revenue.
- `subscriptions(user_id, created_at DESC)` — `GET /api/subscription` and the
  settings page both read "this user's most recent subscription".

The same three indexes are mirrored in `src/components/supabase/schema.sql` so a
fresh install matches. The migration is additive and idempotent only: no column
is dropped, no data is rewritten, no RLS policy is changed.

Deliberate omission, called out in the file itself: a `UNIQUE` index on
`payments(external_payment_id)` is **not** created. It would fail on any table
already holding duplicate provider ids, and silently de-duplicating existing
revenue rows is not a P0 change. Application-level de-duplication already
prevents new duplicates.

**Not verified:** the migration has not been applied to any database. Applying it
is a `supabase db push` against the target project, which needs credentials this
environment does not have. Review the SQL before applying.

---

## 8. Frontend payment UX

**COMPLETE**

`src/app/pricing/page.tsx` polls subscription state after checkout and reflects
what the *server* says, so the success screen is not driven by a client-side
assumption. `PaymentSelector.tsx` was updated for the new response shape.
`StripeCheckout.tsx` and `RazorpayCheckout.tsx` were rewritten: both post to
`/api/payments/create`, and the Razorpay component reports success only when
`/api/payments/razorpay/confirm` returns `verified: true`. The removed
`verifyPayment` client helper was replaced by `createPayment` and
`confirmRazorpayPayment` in `src/lib/api-client.ts`.

Evidence: `tsc --noEmit` and lint pass.

**Not verified:** no checkout was driven through a real provider, so the UI was
never exercised against a live Stripe or Razorpay page.

---

## 9. Security regression tests

**COMPLETE**

`e2e/p0-security.spec.ts` (new) is an API-level suite, because every bug in
§1–§6 is "the route answered 200 where it should have answered 401/404". It signs
up real users through the app's own signup route, signs them in through the real
login form, and asserts on the boundary rather than internals. No test performs a
real financial charge.

17 tests, **all passing** against a live dev server with real Supabase
credentials:

| Test | Asserts |
| --- | --- |
| P0-SEC-1 | the deleted verify route does not accept a forged payload |
| P0-SEC-2 | a forged provider payload activates nothing; subscription stays null |
| P0-SEC-3 | checkout requires a session; error carries no stack trace |
| P0-SEC-4 | unknown plan and unknown provider are 400 |
| P0-SEC-5 | unconfigured provider fails closed 503 with an actionable message |
| P0-SEC-6 | no payment response body ever contains a provider secret |
| P0-SEC-7 | unsigned / bad-signature webhooks are refused |
| P0-SEC-8 | user B cannot confirm user A's subscription; B still has none |
| P0-SEC-9 | payment-method update needs auth and refuses a foreign `pm_` id |
| P0-CONTENT-1/2/3 | 401 unauthenticated, 404 for missing, client error for malformed |
| P0-KEY-1/2/3 | `changeme` and garbage keys rejected; no-credentials is 401 |
| P0-RATE-1/2 | login and signup both throttle |

Run with `npm run test:e2e` (needs a server on `KRIX_APP_URL`).

---

## 10. CI and test scripts

**COMPLETE**

`package.json` gains `typecheck`, `test:worker`, `test:e2e`, `test:e2e:all`, and
an aggregate `test`. `.github/workflows/ci.yml` runs three jobs on push and pull
request: TypeScript + lint on every change; the full `pytest` suite for the
worker on every change (with ffmpeg installed and an explicit libass check,
because captions are burned in via the `ass` filter and a build without it drops
the caption step); and the Playwright suite.

The Playwright job is gated on the repository variable
`PLAYWRIGHT_HAS_SUPABASE == 'true'` and documented with the secrets it needs
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_SERVICE_KEY`). Every spec signs up real
users, so running it without credentials would report a red build meaning "no
credentials" rather than "broken code". It is skipped, loudly, instead.

---

## Summary

| # | Item | Status |
| --- | --- | --- |
| 1 | Payment: provider-authoritative activation | COMPLETE (code) / BLOCKED BY EXTERNAL DEPENDENCY (live checkout) |
| 2 | Payment security helpers | COMPLETE |
| 3 | Content API ownership | COMPLETE |
| 4 | Internal service key | COMPLETE |
| 5 | Google OAuth callback | IN PROGRESS |
| 6 | Auth rate limiting | COMPLETE |
| 7 | Database migration | IN PROGRESS |
| 8 | Frontend payment UX | COMPLETE |
| 9 | Security regression tests | COMPLETE |
| 10 | CI and test scripts | COMPLETE |

### What must happen before launch

1. Configure real Stripe and Razorpay test credentials, price ids, and plan ids;
   register the webhook at `POST {KRIX_APP_URL}/api/payments/webhook`; re-run
   `npm run test:e2e` and then drive one real test-mode checkout per provider to
   confirm activation happens from the webhook, not from the return trip.
2. Apply `supabase/migrations/202609300001_p0_billing_integrity.sql` to the
   target project.
3. Confirm `INTERNAL_SERVICE_KEY` and `AI_WORKER_API_KEY` are generated, unique
   per environment, and identical between the Next.js app and the worker. Both
   values in the current `.env.local` are real (32- and 36-character, no
   placeholder marker), so the production guard will not fire for them — that is
   the right outcome, but nothing verifies they are *not* committed or reused
   from `.env.example` in another environment. Also note `AI_WORKER_API_KEY`
   must be 32 hex characters to match the worker's own validation.
4. Complete the OAuth callback verification with real Google credentials.

### Explicitly deferred to P1

- P1-8: thumbnail failure.
- P1-9: full-duration Qwen3-VL visual sampling.

Neither was modified.