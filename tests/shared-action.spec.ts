// /respond (SharedAction): the link functions answer an invalid link with HTTP 403
// and a JSON body { error, title, message }; the page must show that title and
// message, not the generic "Something went wrong". Network interception only.
// Run: PW_PORT=8093 npx playwright test tests/shared-action.spec.ts
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

const BASE = process.env.WAVE_BASE_URL ?? '';
const cors = { 'access-control-allow-origin': '*' };

const answer = (status: number, body: unknown, contentType = 'application/json') => ({
  status,
  contentType,
  headers: cors,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('an invalid link (403 with title + message) shows that title and message', async ({ page }) => {
  await page.route('**/functions/v1/focusos-shared-item-action*', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } })
      : route.fulfill(answer(403, { error: 'invalid_link', title: 'This link is no longer valid', message: 'Ask the sender to share it again.' })),
  );
  await page.goto(`${BASE}/respond?token=x&action=accept`);
  await expect(page.getByRole('heading', { name: 'This link is no longer valid' })).toBeVisible();
  await expect(page.getByText('Ask the sender to share it again.')).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('a failure with no usable body still shows the generic message', async ({ page }) => {
  await page.route('**/functions/v1/focusos-shared-item-action*', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } })
      : route.fulfill(answer(500, 'boom', 'text/plain')),
  );
  await page.goto(`${BASE}/respond?token=x&action=accept`);
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
});

test('a valid link still shows the function\'s own result', async ({ page }) => {
  await page.route('**/functions/v1/focusos-shared-item-action*', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } })
      : route.fulfill(answer(200, { ok: true, title: 'Accepted', message: 'Thanks, that is done.' })),
  );
  await page.goto(`${BASE}/respond?token=x&action=accept`);
  await expect(page.getByRole('heading', { name: 'Accepted' })).toBeVisible();
  await expect(page.getByText('Thanks, that is done.')).toBeVisible();
});
