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

  test('iOS App button opens the TestFlight-first dialog with both links', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const button = page.locator('header button', { hasText: 'iOS App' });
    await expect(button).toBeVisible();
    await button.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Install Focus OS on your iPhone')).toBeVisible();
    // Step order is the point: TestFlight install first, join link second.
    const links = dialog.locator('a');
    await expect(links.nth(0)).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/testflight/id899247664',
    );
    await expect(links.nth(1)).toHaveAttribute(
      'href',
      'https://testflight.apple.com/join/7jkBSvhA',
    );
    // Both step icons must actually load inside the card.
    for (const img of await dialog.locator('img').all()) {
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    }
  });

  test('on an iPhone the Step 2 link deep-links straight into TestFlight', async ({ browser }) => {
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.locator('header button', { hasText: 'iOS App' }).click();
    const link = page.getByRole('dialog').locator('a').nth(1);
    await expect(link).toHaveAttribute('href', 'itms-beta://testflight.apple.com/join/7jkBSvhA');
    // Custom scheme must open in-place, not in a dead blank tab.
    await expect(link).not.toHaveAttribute('target', '_blank');
    await ctx.close();
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

  // Shell build 1 (no native OAuth bridge, still installed in the field):
  // only __FOCUSOS_SHELL__ is injected, so Google MUST stay hidden — in that
  // build the sign-in leg dies on Google's disallowed_useragent.
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

  // Shell build 2+: the bootScript adds the OAuth capability flag on top of
  // the shell flag, because that build carries the native
  // ASWebAuthenticationSession bridge.
  test.describe('with the native OAuth bridge', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { __FOCUSOS_SHELL_OAUTH__?: boolean }).__FOCUSOS_SHELL_OAUTH__ = true;
      });
    });

    test('/auth offers Continue with Google again', async ({ page }) => {
      await page.goto(`${BASE}/auth`);
      await expect(page.getByText('Focus OS Login')).toBeVisible();
      await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Sign In' })).toBeVisible();
    });

    test('the native callback installs the session and lands on /home', async ({ page }) => {
      // No Google in this test — the point is the plumbing. Mint a REAL token
      // pair with the Apple-review demo account, sign out locally, then feed
      // window.__FOCUSOS_OAUTH_CALLBACK__ the exact shape the shell delivers.
      // Implicit flow (supabase-js 2.110.0 default) => tokens in the fragment.
      await page.goto(`${BASE}/auth`);
      const panel = page.getByRole('tabpanel');
      await panel.getByLabel(/email/i).fill('apple.review@focusos.tech');
      await panel.getByLabel(/password/i).first().fill('FocusOS-Review-2026');
      await panel.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL('**/home', { timeout: 20000 });

      const readStoredSession = () => {
        const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
        if (!key) return null;
        const raw = localStorage.getItem(key) ?? '';
        const json = raw.startsWith('base64-') ? atob(raw.slice('base64-'.length)) : raw;
        try {
          const parsed = JSON.parse(json);
          return {
            access_token: parsed.access_token as string,
            refresh_token: parsed.refresh_token as string,
          };
        } catch {
          return null;
        }
      };

      const tokens = await page.evaluate(readStoredSession);
      expect(tokens?.access_token).toBeTruthy();
      expect(tokens?.refresh_token).toBeTruthy();

      // Local sign-out: drop the stored session without revoking the token
      // pair server-side (a real Google callback arrives at a signed-out app).
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${BASE}/auth`);
      await expect(page.getByText('Focus OS Login')).toBeVisible();
      expect(await page.evaluate(readStoredSession)).toBeNull();

      const called = await page.evaluate(({ access_token, refresh_token }) => {
        const cb = (window as unknown as {
          __FOCUSOS_OAUTH_CALLBACK__?: (url: string | null) => void;
        }).__FOCUSOS_OAUTH_CALLBACK__;
        if (typeof cb !== 'function') return 'handler-missing';
        cb(
          `focusos://auth-callback#access_token=${access_token}` +
            `&expires_in=3600&refresh_token=${refresh_token}&token_type=bearer`,
        );
        return 'called';
      }, tokens!);
      expect(called).toBe('called');

      await page.waitForURL('**/home', { timeout: 20000 });
      // Home bounces a signed-out visitor back to /auth, so staying here with
      // a stored session is the proof.
      await expect(page.getByText('Focus OS Login')).toHaveCount(0);
      expect(await page.evaluate(readStoredSession)).not.toBeNull();
    });
  });
});

test('privacy.html serves as a real static page', async ({ page }) => {
  const response = await page.goto(`${BASE}/privacy.html`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText('Focus OS Privacy Policy')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What we never do' })).toBeVisible();
});
