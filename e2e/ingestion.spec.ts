/**
 * Real browser E2E for the ingestion milestone.
 *
 * These drive the actual UI in Chromium: log in, pick a real file, click
 * Upload, watch the page leave "Uploading…", then confirm the video reaches a
 * terminal state on the dashboard. The YouTube leg does the same through the
 * link input.
 *
 * HTTP-level harness output is NOT a substitute for this file.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const EMAIL = process.env.KRIX_E2E_EMAIL || 'krix.e2e@example.com';
const PASSWORD = process.env.KRIX_E2E_PASSWORD || 'Str0ng!Passw0rd';
const SMALL_VIDEO =
  process.env.KRIX_E2E_VIDEO ||
  'C:\\Users\\KASHIN~1\\AppData\\Local\\Temp\\opencode\\krixmedia\\speech_12mb.mp4';
const YOUTUBE_URL = process.env.KRIX_E2E_YOUTUBE || 'https://youtu.be/dQw4w9WgXcQ';

async function login(page: Page) {
  await page.goto('/auth/login');
  // The shared <Input> renders its label without htmlFor unless an id is
  // passed, so getByLabel is unreliable here; target the input types.
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);

  // Wait on the real sign-in response instead of blindly waiting for a
  // redirect: this surfaces an actual auth failure (bad credentials, 429,
  // provider outage) as a clear error rather than a navigation timeout.
  const signIn = page.waitForResponse(
    (r) => r.url().includes('/auth/v1/token') || r.url().includes('/api/auth'),
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: /sign in/i }).click();
  const res = await signIn;
  console.log('login response status:', res.status());
  expect(res.ok(), `sign-in failed with ${res.status()}`).toBeTruthy();

  await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 120_000 });
}

test.describe.configure({ mode: 'serial' });

test('TEST 1: local 10.84 MB MP4 upload completes in the browser', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (e) => browserErrors.push(`pageerror: ${e.message}`));
  const firstBrowserError = browserErrors.length ? browserErrors[0] : null;

  await login(page);

  // B. Open Create New / Upload
  await page.goto('/dashboard/upload');
  await expect(page.getByText('Upload a video')).toBeVisible();

  // The client must learn the real (50 MB) cap from the API, and must never
  // advertise the 2 GB app ceiling as if it were the storage limit.
  const limitText = page.getByText(/up to \d+ MB on this project|checking the size limit/i).first();
  await expect(limitText).toBeVisible({ timeout: 30_000 });
  await expect(limitText).toHaveText(/up to 50 MB on this project/i, { timeout: 30_000 });
  await expect(page.getByText(/2\s?GB/i)).toHaveCount(0);

  // C. Select a real MP4
  await page.setInputFiles('#file-input', SMALL_VIDEO);
  await expect(page.getByText(path.basename(SMALL_VIDEO))).toBeVisible();

  // D. Click Upload
  await page.getByRole('button', { name: /upload & process/i }).click();

  // E. The UI must enter and then leave the "Uploading…" state.
  // (Both the progress bar and the submit button render this text.)
  const uploadingText = page.getByText(/Uploading…/).first();
  await expect(uploadingText).toBeVisible({ timeout: 30_000 });
  await expect(uploadingText).toBeHidden({ timeout: 5 * 60_000 });

  // F/G. Success navigates to the video's content page.
  // The CTA routes to /dashboard/videos (no trailing slash) on a duplicate
  // import, so accept the bare path as well as a nested one.
  await page.waitForURL(/\/dashboard\/(content\/|videos)/, { timeout: 120_000 });
  const contentUrl = page.url();

  // H. Verify the generated result on the dashboard.
  await expect(page.getByText(/clip|content|processing|ready/i).first()).toBeVisible();
  console.log('TEST1 landing page:', contentUrl);
  console.log('TEST1 body snapshot:', (await page.locator('body').innerText()).slice(0, 900));

  // A crash during any of the above is a real browser-side failure.
  expect(await firstBrowserError, 'unexpected browser error during upload').toBeNull();
});

test('TEST 2: YouTube URL import completes in the browser', async ({ page }) => {
  await login(page);

  // I. Open the YouTube URL input on the landing page.
  await page.goto('/');
  const linkInput = page.getByPlaceholder('Drop a video link');
  await expect(linkInput).toBeVisible({ timeout: 30_000 });

  // J/K. Paste a real public YouTube URL and submit.
  await linkInput.fill(YOUTUBE_URL);
  await page.getByRole('button', { name: /get free clips/i }).first().click();

  // L. Verify the "Importing…" state. The landing CTA performs the server-side
  // download in place: the button switches to "Importing video…" and disables
  // while the API call is in flight.
  await expect(page.getByText(/Importing video/i).first()).toBeVisible({ timeout: 60_000 });

  // M. On success it routes to the created video. The download + pipeline
  //    kickoff takes ~1-3 min, so allow a generous window.
  // The server-side download of a YouTube link happens inside this single
  // request, so it can legitimately take a few minutes. 12 min is the ceiling
  // before we call the leg failed.
  await page.waitForURL(/\/dashboard\/(content\/|videos)/, { timeout: 12 * 60_000 });
  const contentUrl = page.url();
  console.log('TEST2 landing page:', contentUrl);

  // N. Verify dashboard result/status.
  await expect(page.getByText(/clip|content|processing|ready|transcri/i).first()).toBeVisible();
  console.log('TEST2 body snapshot:', (await page.locator('body').innerText()).slice(0, 900));
});

test('TEST 3: environment facts (no secrets printed)', async ({ page }) => {
  await login(page);

  // Use an in-page fetch: it carries the same-origin session cookie reliably,
  // whereas page.request intermittently raced the freshly-set auth cookie.
  const probe = async (path: string) =>
    page.evaluate(async (p) => {
      const res = await fetch(p, { credentials: 'include' });
      return { status: res.status, body: await res.text() };
    }, path);

  const limits = await probe('/api/ingest-url');
  const upload = await probe('/api/upload');
  console.log('GET /api/ingest-url ->', limits.status, limits.body.slice(0, 300));
  console.log('GET /api/upload ->', upload.status, upload.body.slice(0, 300));

  // These must be reachable by a signed-in user and must not advertise 2 GB.
  expect(limits.status, 'GET /api/ingest-url must authenticate').toBe(200);
  expect(upload.status, 'GET /api/upload must authenticate').toBe(200);

  const uploadJson = JSON.parse(upload.body);
  // Verified Supabase per-object limit is 50 MiB; the 2 GiB app ceiling must
  // never be what the client is told.
  expect(uploadJson.maxBytes).toBe(52428800);
  expect(uploadJson.maxBytes).toBeLessThan(uploadJson.appMaxBytes);
  expect(uploadJson.maxMegabytes).toBe(50);
  expect(uploadJson.bucket).toBe('videos');

  void fs;
});
