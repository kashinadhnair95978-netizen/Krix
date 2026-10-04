/**
 * P0 security regression suite.
 *
 * Runs against a live server with real Supabase auth. Every assertion is about
 * a boundary: an unauthenticated caller, a legitimate user, a legitimate user
 * reaching for someone else's row, and a caller forging a payment.
 *
 * These are deliberately API-level tests (Playwright's `request` context), not
 * unit tests: the bugs under test are all "the route answered 500 / 200 when it
 * should have answered 404 / 401", which only a real HTTP surface can show.
 *
 * No test performs a real financial charge. Stripe and Razorpay are unconfigured
 * in CI, so the checkout endpoint must fail closed with 503 — and that is itself
 * asserted, because "checkout silently pretended to work" is the failure mode
 * this suite exists to catch.
 */
import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';

const APP_URL = process.env.KRIX_APP_URL || 'http://localhost:3000';

/** A syntactically valid but non-functional key must never authenticate. */
const PLACEHOLDER_KEY = 'changeme';

/**
 * Deterministic email per logical test user, so a re-run reuses the account
 * instead of demanding another signup.
 */
function accountEmail(name: string): string {
  return `krix.p0.${name}@example.com`;
}

const PASSWORD = 'Str0ng!Passw0rd!42';

/**
 * Create a real user through the app's own signup route, so the test exercises
 * the same path a person does and leaves a real session-independent account.
 *
 * Two responses mean "this account already exists", not "the app is broken":
 *   400 "already registered" — a previous suite run created it;
 *   429 — the signup limiter (10 per IP per hour) refused, which is the P0 rate
 *         limiting working as designed.
 * In both cases the account is reusable, so sign it back in and carry on. This
 * is what keeps the suite re-runnable against a long-lived dev server; CI starts
 * a fresh server per run, so it always takes the signup path.
 */
async function signup(request: APIRequestContext, email: string) {
  const res = await request.post(`${APP_URL}/api/auth/signup`, {
    data: { email, password: PASSWORD, name: 'P0 Tester' },
  });
  if (res.status() === 200) return email;

  if (res.status() === 400 || res.status() === 429) {
    const login = await request.post(`${APP_URL}/api/auth/login`, {
      data: { email, password: PASSWORD },
    });
    if (login.status() === 200) return email;
    expect(
      login.status(),
      `signup answered ${res.status()} (${await res.text()}) and the fallback login failed: ${login.status()} ${await login.text()}`
    ).toBe(200);
  }

  expect(res.status(), `signup failed: ${res.status()} ${await res.text()}`).toBe(200);
  return email;
}

/**
 * A cookie jar that holds one user's session. Playwright's `request` context
 * already persists cookies per context; this is just a named handle so tests can
 * express "user A" vs "user B" without cross-talk.
 */
async function signIn(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: APP_URL });
  const page = await context.newPage();
  await page.goto('/auth/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 60_000 }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
  return context;
}

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// 1. Payments: no route outside a verified provider event may activate a plan
// ---------------------------------------------------------------------------

test('P0-SEC-1: the client-callable payment verify route no longer exists', async ({ request }) => {
  const res = await request.post(`${APP_URL}/api/payments/verify`, {
    data: {
      provider: 'stripe',
      subscriptionId: 'sub_attacker',
      razorpayPaymentId: 'pay_attacker',
      razorpaySignature: 'forged',
    },
  });
  // 401 = middleware stopped it before routing, 404/405 = the handler is gone.
  // Any of these is a refusal; the failure this guards against is a 200 that
  // activates a subscription from a client-claimed payload.
  expect([401, 404, 405]).toContain(res.status());
  expect(res.status()).not.toBe(200);
});

test('P0-SEC-2: a forged provider payload cannot activate a subscription', async ({ browser, request }) => {
  const email = accountEmail('forge');
  await signup(request, email);
  const ctx = await signIn(browser, email);

  // Fabricate exactly what the deleted route used to accept. Now authenticated,
  // so this must be a plain 404 — the handler itself is gone.
  const res = await ctx.request.post(`${APP_URL}/api/payments/verify`, {
    data: { provider: 'stripe', subscriptionId: 'sub_x', razorpayPaymentId: 'pay_x' },
  });
  expect([404, 405]).toContain(res.status());

  // And the surviving routes must refuse to activate anything unverified. With
  // no Razorpay credentials configured the route fails closed at 503 before it
  // ever looks at the payload; with credentials it would reject the bogus
  // signature. Either way it must not be 200.
  const confirm = await ctx.request.post(`${APP_URL}/api/payments/razorpay/confirm`, {
    data: {
      subscriptionId: 'sub_x',
      razorpay_order_id: 'order_x',
      razorpay_payment_id: 'pay_x',
      razorpay_signature: 'deadbeef',
    },
  });
  expect([404, 400, 503], `confirm returned ${confirm.status()}`).toContain(confirm.status());
  expect(confirm.status()).not.toBe(200);

  // Nothing was written for this account.
  const sub = await ctx.request.get(`${APP_URL}/api/subscription`);
  expect([200]).toContain(sub.status());
  expect(await sub.json()).toBeNull();
  await ctx.close();
});

test('P0-SEC-3: checkout requires authentication', async ({ request }) => {
  const res = await request.post(`${APP_URL}/api/payments/create`, {
    data: { plan: 'pro' },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.message).toBeTruthy();
  // No stack trace, no internal detail.
  expect(JSON.stringify(body)).not.toMatch(/at \w+ \(|node_modules|TypeError/);
});

test('P0-SEC-4: checkout rejects an unknown plan and an invalid provider', async ({ browser, request }) => {
  const email = accountEmail('validate');
  await signup(request, email);
  const ctx = await signIn(browser, email);

  const badPlan = await ctx.request.post(`${APP_URL}/api/payments/create`, {
    data: { plan: 'enterprise-plus' },
  });
  expect(badPlan.status()).toBe(400);

  const badProvider = await ctx.request.post(`${APP_URL}/api/payments/create`, {
    data: { plan: 'pro', provider: 'paypal' },
  });
  expect(badProvider.status()).toBe(400);

  await ctx.close();
});

test('P0-SEC-5: an unconfigured provider fails closed with an actionable message and no secret', async ({ browser, request }) => {
  const email = accountEmail('unconfigured');
  await signup(request, email);
  const ctx = await signIn(browser, email);

  for (const provider of ['stripe', 'razorpay'] as const) {
    const res = await ctx.request.post(`${APP_URL}/api/payments/create`, {
      data: { plan: 'pro', provider },
    });
    // 503 = not configured. This test is meaningful precisely because the
    // placeholder keys in .env.example must NOT produce a fake success.
    if (res.status() === 503) {
      const body = await res.json();
      expect(body.error).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
      expect(body.message).toMatch(/STRIPE|RAZORPAY/);
    } else {
      // If the operator has configured real test keys, the route must return a
      // real checkout handle — and never a secret.
      expect(res.status()).toBe(200);
      const body = await res.json();
      const serialised = JSON.stringify(body);
      expect(body.provider).toBe(provider);
      expect(serialised).not.toMatch(/sk_(live|test)_|whsec_|rzp_live|key_secret|secretKey/);
    }
  }
  await ctx.close();
});

test('P0-SEC-6: no payment response ever contains a provider secret', async ({ browser, request }) => {
  const email = accountEmail('nosecret');
  await signup(request, email);
  const ctx = await signIn(browser, email);

  for (const provider of ['stripe', 'razorpay'] as const) {
    const res = await ctx.request.post(`${APP_URL}/api/payments/create`, {
      data: { plan: 'basic', provider },
    });
    const text = await res.text();
    expect(text).not.toMatch(/sk_live_|sk_test_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/);
    expect(text).not.toMatch(/"secretKey"|"apiKey"|"client_secret"\s*:\s*"/);
  }
  await ctx.close();
});

test('P0-SEC-7: the webhook refuses an unsigned or badly signed request', async ({ request }) => {
  const none = await request.post(`${APP_URL}/api/payments/webhook`, {
    data: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', amount: 1 } } } },
  });
  expect(none.status()).toBe(400);

  const badSig = await request.post(`${APP_URL}/api/payments/webhook`, {
    headers: { 'x-razorpay-signature': 'deadbeef' },
    data: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', amount: 1 } } } },
  });
  // Either the signature is rejected (400) or the webhook secret is absent (503).
  // Both are refusals; a 200 here would mean a forged webhook was accepted.
  expect([400, 503]).toContain(badSig.status());

  const badStripe = await request.post(`${APP_URL}/api/payments/webhook`, {
    headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    data: '{"id":"evt_x","type":"checkout.session.completed"}',
  });
  expect([400, 503]).toContain(badStripe.status());
});

test('P0-SEC-8: a cross-user subscription id cannot be confirmed by another user', async ({ browser, request }) => {
  const emailA = accountEmail('owner');
  const emailB = accountEmail('attacker');
  await signup(request, emailA);
  await signup(request, emailB);
  const ctxA = await signIn(browser, emailA);
  const ctxB = await signIn(browser, emailB);

  // User B tries to confirm a subscription id that is not theirs.
  const res = await ctxB.request.post(`${APP_URL}/api/payments/razorpay/confirm`, {
    data: {
      subscriptionId: 'sub_someone_elses',
      razorpay_order_id: 'order_x',
      razorpay_payment_id: 'pay_x',
      razorpay_signature: 'a'.repeat(64),
    },
  });
  // 503 while Razorpay is unconfigured; 404 once it is configured, because the
  // pending intent is looked up scoped to the caller's own id. Never 200.
  expect([404, 400, 503], `cross-user confirm returned ${res.status()}`).toContain(
    res.status(),
  );
  expect(res.status()).not.toBe(200);

  // The decisive check: B still has no subscription, so nothing leaked through.
  const subB = await ctxB.request.get(`${APP_URL}/api/subscription`);
  expect(subB.status()).toBe(200);
  expect(await subB.json()).toBeNull();

  await ctxA.close();
  await ctxB.close();
});

test('P0-SEC-9: updating a payment method requires auth and refuses a foreign pm_ id', async ({ browser, request }) => {
  const anon = await request.put(`${APP_URL}/api/subscription/payment-method`, {
    data: { paymentMethodId: 'pm_forged' },
  });
  expect(anon.status()).toBe(401);

  const email = accountEmail('pm');
  await signup(request, email);
  const ctx = await signIn(browser, email);

  // No subscription on file for this account -> 404, never a 500 and never a
  // write. A forged `last4` must not be accepted either.
  const res = await ctx.request.put(`${APP_URL}/api/subscription/payment-method`, {
    data: { paymentMethodId: 'pm_1NotARealMethod', last4: '4242' },
  });
  expect([404, 400, 503]).toContain(res.status());
  const text = await res.text();
  expect(text).not.toMatch(/4242/);

  await ctx.close();
});

// ---------------------------------------------------------------------------
// 2. Content API: PUT/DELETE must work for the owner and fail for everyone else
// ---------------------------------------------------------------------------

test('P0-CONTENT-1: PUT and DELETE on content answer 401 when unauthenticated', async ({ request }) => {
  const fake = '00000000-0000-0000-0000-000000000000';
  const put = await request.put(`${APP_URL}/api/content/${fake}`, {
    data: { content_text: 'hijacked' },
  });
  expect(put.status()).toBe(401);

  const del = await request.delete(`${APP_URL}/api/content/${fake}`);
  expect(del.status()).toBe(401);
});

test('P0-CONTENT-2: PUT and DELETE answer 404 (not 500) for a missing row', async ({ browser, request }) => {
  const email = accountEmail('missing');
  await signup(request, email);
  const ctx = await signIn(browser, email);

  const missing = '00000000-0000-0000-0000-000000000000';
  const put = await ctx.request.put(`${APP_URL}/api/content/${missing}`, {
    data: { content_text: 'x' },
  });
  // The P0 bug made this 500 for EVERY id because the many-to-one join was
  // read as an array. A missing id must be a clean 404.
  expect(put.status(), `PUT returned ${put.status()} — the join bug may be back`).toBe(404);

  const del = await ctx.request.delete(`${APP_URL}/api/content/${missing}`);
  expect(del.status(), `DELETE returned ${del.status()} — the join bug may be back`).toBe(404);

  await ctx.close();
});

test('P0-CONTENT-3: a malformed id answers a client error, never a 500', async ({ browser, request }) => {
  const email = accountEmail('malformed');
  await signup(request, email);
  const ctx = await signIn(browser, email);

  for (const id of ['not-a-uuid', '../../etc/passwd', '%00']) {
    const res = await ctx.request.put(`${APP_URL}/api/content/${id}`, {
      data: { content_text: 'x' },
    });
    expect([400, 404]).toContain(res.status());
  }
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 3. Internal service key: placeholders fail closed
// ---------------------------------------------------------------------------

const PROTECTED_PATHS = [
  '/api/videos',
  '/api/content',
  '/api/subscription',
  '/api/analytics',
];

test('P0-KEY-1: x-service-key: changeme is rejected on every protected path', async ({ request }) => {
  for (const path of PROTECTED_PATHS) {
    const res = await request.get(`${APP_URL}${path}`, {
      headers: { 'x-service-key': PLACEHOLDER_KEY },
    });
    // 401 = refused. A 200 would mean the placeholder key authenticated.
    expect(res.status(), `${path} accepted the placeholder service key`).toBe(401);
  }
});

test('P0-KEY-2: a garbage service key is rejected on every protected path', async ({ request }) => {
  for (const path of PROTECTED_PATHS) {
    const res = await request.get(`${APP_URL}${path}`, {
      headers: { 'x-service-key': 'not-the-real-key' },
    });
    expect(res.status(), `${path} accepted a bogus service key`).toBe(401);
  }
});

test('P0-KEY-3: the service-key-protected routes require a session or a real key', async ({ request }) => {
  for (const path of PROTECTED_PATHS) {
    const res = await request.get(`${APP_URL}${path}`);
    expect(res.status(), `${path} was reachable with no credentials`).toBe(401);
  }
});

// ---------------------------------------------------------------------------
// 4. Auth rate limiting (P0-10)
// ---------------------------------------------------------------------------

test('P0-RATE-1: login is rate limited per email', async ({ request }) => {
  const email = accountEmail('ratelimit');
  await signup(request, email);

  const statuses: number[] = [];
  for (let i = 0; i < 16; i++) {
    const res = await request.post(`${APP_URL}/api/auth/login`, {
      data: { email, password: 'wrong-password-entirely' },
    });
    statuses.push(res.status());
  }
  expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
  expect(statuses, 'login was never rate limited').toContain(429);

  const last = await request.post(`${APP_URL}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  if (last.status() === 429) {
    const body = await last.json();
    expect(body.message).toMatch(/too many/i);
    expect(last.headers()['retry-after']).toBeTruthy();
  }
});

test('P0-RATE-2: signup is rate limited per email', async ({ request }) => {
  const email = accountEmail('signupburst');
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await request.post(`${APP_URL}/api/auth/signup`, {
      data: { email, password: PASSWORD, name: 'Burst' },
    });
    statuses.push(res.status());
  }
  expect(statuses.every((s) => [200, 400, 429].includes(s))).toBe(true);
  expect(statuses, 'signup was never rate limited').toContain(429);
});

// ---------------------------------------------------------------------------
// 5. Google OAuth callback
//
// The successful round-trip cannot be exercised here: the Supabase project has
// `external.google = false`, so there is no Google provider to complete a code
// exchange against, and no Google client id/secret exists in any env file. What
// CAN be proven without those credentials is the P0 fix itself: the callback
// used to slice the whole query string and hand `code=...&state=...` to
// exchangeCodeForSession, then navigate after a fixed 200 ms delay, so Google
// sign-in always failed and sometimes produced a signed-out dashboard.
//
// These three tests pin the behaviour that bug used to get wrong: a callback
// with no code, a callback with a code the server rejects, and the button that
// starts the flow. Each must reach an honest terminal state — a reported
// failure or a redirect — and none may leave a session or navigate into the app.
// ---------------------------------------------------------------------------

test('P0-OAUTH-1: a callback with no code reports the failure instead of hanging', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/auth/callback');
  await expect(page.getByText('Sign-in failed')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/missing its authorization code/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible();

  // The old code left the user on an endless spinner; and it must not have
  // navigated into the app.
  expect(page.url()).toContain('/auth/callback');
  expect(consoleErrors, 'the callback threw instead of handling the error').toEqual([]);
});

test('P0-OAUTH-2: a rejected code does not yield a session or a redirect to the app', async ({ page }) => {
  await page.goto('/auth/callback?code=not-a-real-authorization-code&state=x');
  await expect(page.getByText('Sign-in failed')).toBeVisible({ timeout: 60_000 });

  // No session may have been established by a bogus code.
  const url = page.url();
  expect(url).toContain('/auth/callback');
  expect(url).not.toContain('/dashboard');
  const hasSessionToken = await page.evaluate(() =>
    Boolean(localStorage.getItem('sb-local-auth-token') || sessionStorage.length > 0)
  );
  expect(hasSessionToken).toBe(false);
});

test('P0-OAUTH-3: the Google button either starts the flow or reports why it cannot', async ({ page }) => {
  // Google OAuth is disabled on this Supabase project, so a completed round-trip
  // is impossible here. What is testable, and what users actually feel, is that
  // pressing "Continue with Google" resolves into one of two honest outcomes:
  // the browser leaves for the provider, or an error is shown. An endless
  // "Redirecting to Google…" spinner — the pre-P0 behaviour — is a failure.
  await page.goto('/auth/login');

  const googleButton = page.getByRole('button', { name: /continue with google/i });
  await expect(googleButton).toBeVisible({ timeout: 30_000 });
  await googleButton.click();

  const outcome = await Promise.race([
    page
      .waitForURL((u) => !u.href.includes('/auth/login'), { timeout: 30_000 })
      .then(() => 'redirected' as const),
    page
      .getByText(/failed|error|not enabled|not been enabled|unsupported/i)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => 'reported' as const),
  ]).catch(() => 'hung' as const);

  // Which of the two paths was taken does not matter: Google being disabled is
  // an environment fact, not a code defect. What must never happen is silence.
  expect(outcome, 'the Google button spun forever with no error and no redirect').not.toBe(
    'hung'
  );

  // If it did redirect, the destination must be the provider, never our own app.
  if (outcome === 'redirected') {
    expect(page.url()).toMatch(/accounts\.google\.com|supabase\.co\/auth/);
  }
});
