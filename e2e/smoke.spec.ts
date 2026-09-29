import { test, expect } from '@playwright/test';

const EMAIL = process.env.KRIX_E2E_EMAIL || 'krix.e2e@example.com';
const PASSWORD = process.env.KRIX_E2E_PASSWORD || 'Str0ng!Passw0rd';

test('login smoke', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/auth/login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 60_000 });
  console.log('after login URL:', page.url());
  console.log('pageerrors:', JSON.stringify(errors));

  await page.goto('/dashboard/upload');
  console.log('upload page title visible:', await page.getByText('Upload a video').isVisible());
  console.log('file input count:', await page.locator('#file-input').count());
  console.log('submit buttons:', await page.getByRole('button').allInnerTexts());

  await page.goto('/');
  const link = page.getByPlaceholder('Drop a video link');
  console.log('landing link input count:', await link.count());
  console.log('landing buttons:', await page.getByRole('button').allInnerTexts());
  expect(errors).toEqual([]);
});
