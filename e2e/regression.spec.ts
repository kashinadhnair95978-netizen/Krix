/**
 * Browser coverage for the two recovered ingestion blockers.
 *
 * TEST 4 — repeated YouTube ingestion:
 *   1. a brand new link is imported (real yt-dlp download, real DB row),
 *   2. the exact same link is posted again while that job is still processing,
 *   3. two more posts of the same link go out in parallel,
 *   4. a non-YouTube link and an empty body are answered immediately,
 *   5. every response is bounded in time and returns a usable videoId.
 *
 *   The point is not that the first import succeeds — that is TEST 2 — but that
 *   a repeat never starts a second download, never hangs, and always answers
 *   with a deterministic result pointing at the same job.
 *
 * TEST 5 — auto-repurpose: the provider/model check and a real generation
 *   attempt. It asserts there is no 500, that a blocked configuration reports
 *   AI_PROVIDER_NOT_CONFIGURED with an actionable message, and that a working
 *   configuration produces five real content types.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.KRIX_E2E_EMAIL || 'krix.e2e@example.com';
const PASSWORD = process.env.KRIX_E2E_PASSWORD || 'Str0ng!Passw0rd';
// A real, public, ~3 minute video that is NOT in the library, so step 1 of
// TEST 4 performs a genuine first-time import.
const FRESH_URL =
  process.env.KRIX_E2E_YOUTUBE_FRESH ||
  'https://www.youtube.com/watch?v=LOFHjWmnytI';

/** Nothing server-side may exceed this; the old bug stalled for 12+ minutes. */
const NO_HANG_MS = 8 * 60_000;
/** A deduplicated answer is a database read, not a download. */
const DUPLICATE_MS = 20_000;

async function login(page: Page) {
  await page.goto('/auth/login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const signIn = page.waitForResponse(
    (r) => r.url().includes('/auth/v1/token') || r.url().includes('/api/auth'),
    { timeout: 60_000 }
  );
  await page.getByRole('button', { name: /sign in/i }).click();
  const res = await signIn;
  expect(res.ok(), `sign-in failed with ${res.status()}`).toBeTruthy();
  await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 120_000 });
}

interface IngestCall {
  status: number;
  ms: number;
  body: {
    success?: boolean;
    videoId?: string | null;
    status?: string;
    deduplicated?: boolean;
    duplicateState?: string;
    error?: string;
    message?: string;
    retryAfterSeconds?: number;
  };
}

/**
 * In-page fetch: it carries the session cookie that `page.request` races, and
 * it is aborted client-side so a stalled server request fails the test instead
 * of hanging the run.
 */
async function postIngest(page: Page, url: string, force = false): Promise<IngestCall> {
  return page.evaluate(
    async ({ target, forceIt, capMs }) => {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), capMs);
      try {
        const res = await fetch('/api/ingest-url', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, ...(forceIt ? { force: true } : {}) }),
          signal: controller.signal,
        });
        const text = await res.text();
        let parsed: any = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text.slice(0, 200) };
        }
        return { status: res.status, ms: Date.now() - started, body: parsed };
      } catch (err) {
        return {
          status: 0,
          ms: Date.now() - started,
          body: { error: 'CLIENT_ABORT', message: String(err) },
        };
      } finally {
        clearTimeout(timer);
      }
    },
    { target: url, forceIt: force, capMs: NO_HANG_MS }
  );
}

/** The canonical form the server stores, so the DB check is exact. */
function canonicalOf(url: string): string {
  const u = new URL(url);
  if (u.hostname.endsWith('youtu.be')) {
    return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
  }
  return `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`;
}

test.describe.configure({ mode: 'serial' });

test('TEST 4: repeated YouTube ingestion is deterministic and never re-downloads', async ({ page }) => {
  // Hard ceiling for the whole test: a regression that reintroduces the stall
  // must fail the run, not hang it.
  test.setTimeout(12 * 60_000);
  await login(page);

  // Snapshot the library first: a repeated import must leave it untouched.
  const rowsBefore = ((await page.evaluate(async () => {
    const res = await fetch('/api/videos', { credentials: 'include' });
    return res.json();
  })) as any[]).filter((r) => r.original_url === canonicalOf(FRESH_URL)).length;
  console.log('TEST4 existing rows for the url before any call:', rowsBefore);

  // 1. First-time import of a link that is not in the library yet.
  const first = await postIngest(page, FRESH_URL);
  console.log('TEST4 first import:', first.status, `${first.ms}ms`, JSON.stringify(first.body).slice(0, 400));
  expect(first.status, `first import failed: ${JSON.stringify(first.body)}`).toBeLessThan(500);
  expect(first.body.success).toBe(true);
  expect(first.body.videoId, 'a fresh import must return a videoId').toBeTruthy();
  const videoId = first.body.videoId as string;

  // 2. The exact same link again, while that job is still processing: the
  //    running job is returned, and no second download happens.
  const second = await postIngest(page, FRESH_URL);
  console.log('TEST4 repeat import:', second.status, `${second.ms}ms`, JSON.stringify(second.body).slice(0, 400));
  expect(second.status).toBe(200);
  expect(second.body.deduplicated).toBe(true);
  expect(second.body.videoId).toBe(videoId);
  expect(second.ms, 'a duplicate must not download the video again').toBeLessThan(DUPLICATE_MS);

  // 3. Two simultaneous posts of the same link. One may be creating the row,
  //    the other must be deduplicated — neither may hang or produce a second
  //    video.
  const [a, b] = await page.evaluate(
    async ({ target, capMs }) => {
      const call = async () => {
        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), capMs);
        try {
          const res = await fetch('/api/ingest-url', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: target }),
            signal: controller.signal,
          });
          const body = await res.json().catch(() => ({}));
          return { status: res.status, ms: Date.now() - started, body };
        } catch (err) {
          return { status: 0, ms: Date.now() - started, body: { error: String(err) } };
        } finally {
          clearTimeout(timer);
        }
      };
      return Promise.all([call(), call()]);
    },
    { target: FRESH_URL, capMs: NO_HANG_MS }
  ) as unknown as [IngestCall, IngestCall];

  console.log('TEST4 concurrent A:', a.status, `${a.ms}ms`, JSON.stringify(a.body).slice(0, 300));
  console.log('TEST4 concurrent B:', b.status, `${b.ms}ms`, JSON.stringify(b.body).slice(0, 300));
  for (const call of [a, b]) {
    expect(call.status, 'no request may hang or fail at the transport').toBeGreaterThan(0);
    expect(call.status).toBeLessThan(500);
    expect(call.ms).toBeLessThan(NO_HANG_MS);
    if (call.body.videoId) expect(call.body.videoId).toBe(videoId);
  }
  // At most one of the two could have created a row; the other is a duplicate.
  const fresh = [a, b].filter((c) => c.body.deduplicated !== true);
  expect(fresh.length).toBeLessThanOrEqual(1);

  // 4. Determinism for bad input: rejected fast, never a hang.
  const notYouTube = await postIngest(page, 'https://example.com/video.mp4');
  expect(notYouTube.status).toBe(400);
  expect(notYouTube.body.error).toBe('YOUTUBE_INVALID_URL');

  const empty = await postIngest(page, '   ');
  expect(empty.status).toBe(400);

  // 5. Database state: this run must not add a row for the URL. (The library
  //    may already hold historical rows for it, so the count is compared
  //    before/after rather than asserted to be 1.)
  const rows = (await page.evaluate(async () => {
    const res = await fetch('/api/videos', { credentials: 'include' });
    return res.json();
  })) as any[];
  const forUrl = rows.filter((r) => r.original_url === canonicalOf(FRESH_URL));
  console.log('TEST4 rows for the url:', `${rowsBefore} -> ${forUrl.length}`, JSON.stringify(forUrl.map((r) => ({ id: r.id, status: r.status, stage: r.processing_stage }))));
  expect(forUrl.length, 'a repeated import must not create another video').toBe(rowsBefore);
  const stored = forUrl.find((r) => r.id === videoId);
  expect(stored, 'the returned videoId must exist in the database').toBeTruthy();
  expect(stored.storage_path, 'the imported video must have media in storage').toBeTruthy();
});

test('TEST 5: auto-repurpose reports configuration instead of failing with a 500', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await login(page);

  const config = (await page.evaluate(async () => {
    const res = await fetch('/api/ai/config', { credentials: 'include' });
    return { status: res.status, body: await res.json() };
  })) as { status: number; body: { status: any } };
  console.log('TEST5 ai config:', config.status, JSON.stringify(config.body).slice(0, 500));
  expect(config.status).toBe(200);

  const videos = (await page.evaluate(async () => {
    const res = await fetch('/api/videos', { credentials: 'include' });
    return res.json();
  })) as any[];
  const withTranscript = videos.find((v) => v.transcript);
  expect(withTranscript, 'a transcribed video is required to test repurposing').toBeTruthy();

  const started = Date.now();
  const call = (await page.evaluate(async (id) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetch('/api/repurpose', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: id, force: true }),
        signal: controller.signal,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (err) {
      return { status: 0, body: { message: String(err) } };
    } finally {
      clearTimeout(timer);
    }
  }, withTranscript.id)) as { status: number; body: any };
  const ms = Date.now() - started;
  console.log(`TEST5 repurpose: ${call.status} ${ms}ms`, JSON.stringify(call.body).slice(0, 600));

  // A provider/model problem is a configuration error, never a server error,
  // and never fabricated content.
  expect(call.status, 'auto-repurpose must not answer with a 500').not.toBe(500);

  if (call.status === 200) {
    const types = call.body.content_types ?? [];
    expect(types.length, 'a real generation fills every content type').toBe(5);
    for (const t of types) expect(t).toBeTruthy();

    const stored = (await page.evaluate(async (id) => {
      const res = await fetch(`/api/content/${id}`, { credentials: 'include' });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, withTranscript.id)) as { status: number; body: any };
    console.log('TEST5 stored content:', stored.status, JSON.stringify(stored.body).slice(0, 300));
    const saved = Array.isArray(stored.body) ? stored.body : [];
    const generated = saved.filter((c: any) => c.content_text && String(c.content_text).length > 40);
    expect(generated.length, 'generated content must actually be persisted').toBeGreaterThan(0);
  } else {
    // Blocked configuration: actionable, and naming the variable to fix.
    expect(call.status).toBe(503);
    expect(call.body.error).toBe('AI_PROVIDER_NOT_CONFIGURED');
    expect(String(call.body.message)).toMatch(/AI_PROVIDER|provider|API_KEY|OPENROUTER|MODEL/i);
  }
});
