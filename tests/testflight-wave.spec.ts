// TestFlight wave verification (tasks 1-4, Focus OS TestFlight project).
// Browser mode must be UNCHANGED; shell mode (window.__FOCUSOS_SHELL__) must
// skip the landing page and hide Google sign-in. privacy.html must serve.
// Run: npx playwright test tests/testflight-wave.spec.ts
// Default target is the config's own webServer (baseURL). WAVE_BASE_URL may
// point at a localhost server or the DEPLOYED Pages root only — NOT the
// preview channel: its 404 fallback bounces deep links back to the channel
// root by design, which fails these tests for an environment reason.
import { test, expect } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

test.describe('browser mode (unchanged)', () => {
  test('/ renders the landing page with a Privacy footer link', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.getByText('Your day, back in order.')).toBeVisible();
    const privacy = page.locator('footer a', { hasText: 'Privacy' });
    await expect(privacy).toBeVisible();
    expect(await privacy.getAttribute('href')).toContain('privacy.html');
  });

  test('top menu carries the iOS App TestFlight link', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const link = page.locator('header a', { hasText: 'iOS App' });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe('https://testflight.apple.com/join/7jkBSvhA');
  });

  test('/auth still offers Continue with Google', async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
  });
});

test.describe('shell mode', () => {
  test.beforeEach(async ({ page }) => {
    // Mirror the shell bootScript: documentStart flag, before any module code.
    await page.addInitScript(() => {
      (window as unknown as { __FOCUSOS_SHELL__?: boolean }).__FOCUSOS_SHELL__ = true;
      document.documentElement.classList.add('standalone', 'shell');
    });
  });

  test('/ redirects to /auth (landing never renders)', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForURL('**/auth');
    await expect(page.getByText('Focus OS Login')).toBeVisible();
    await expect(page.getByText('Your day, back in order.')).toHaveCount(0);
  });

  test('/auth hides Google, keeps email+password', async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await expect(page.getByText('Focus OS Login')).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sign Up' })).toBeVisible();
  });

  test('sign-in goes straight to /home, never bouncing through /', async ({ page }) => {
    // The Apple-review demo account (also in App Store Connect Test Information).
    const rootVisits: string[] = [];
    page.on('framenavigated', frame => {
      const path = new URL(frame.url()).pathname.replace(/\/$/, '');
      if (path === '' || path === '/focus-os') rootVisits.push(frame.url());
    });
    await page.goto(`${BASE}/auth`);
    const panel = page.getByRole('tabpanel');
    await panel.getByLabel(/email/i).fill('apple.review@focusos.tech');
    await panel.getByLabel(/password/i).first().fill('FocusOS-Review-2026');
    await panel.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/home', { timeout: 20000 });
    expect(rootVisits).toEqual([]);
  });
});

test('privacy.html serves as a real static page', async ({ page }) => {
  const response = await page.goto(`${BASE}/privacy.html`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText('Focus OS Privacy Policy')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What we never do' })).toBeVisible();
});
