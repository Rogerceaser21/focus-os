// One auth card behind both entrances (2026-08-20): the landing dialog and
// /auth render the SAME AuthCard component, and /auth carries a way back to
// the landing page (hidden in the shell, where "/" just bounces back).
// Run: npx playwright test tests/auth-card.spec.ts
import { test, expect } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';
const BACK_LABEL = 'Back to the Focus OS home page';

test.describe('browser mode', () => {
  test('/auth shows the shared card with a way back to the landing', async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await expect(page.getByTestId('auth-card')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sign In' })).toBeVisible();
    await page.getByRole('button', { name: BACK_LABEL }).click();
    await expect(page.getByText('Your day, back in order.')).toBeVisible();
    await expect(page.getByTestId('auth-card')).toHaveCount(0);
  });

  test('landing Start Here opens the same card; X returns to the landing', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: 'Start Here' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('auth-card')).toBeVisible();
    // opened in signup mode from the CTA
    await expect(dialog.getByRole('button', { name: 'Start Free Today' })).toBeVisible();
    // full signin parity on the landing card too: Forgot Password + Admin Reset
    await dialog.getByRole('tab', { name: 'Sign In' }).click();
    await expect(dialog.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(dialog.getByText('Forgot Password?')).toBeVisible();
    await expect(dialog.getByText('Admin Reset')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('auth-card')).toHaveCount(0);
    await expect(page.getByText('Your day, back in order.')).toBeVisible();
  });
});

test.describe('shell mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __FOCUSOS_SHELL__?: boolean }).__FOCUSOS_SHELL__ = true;
      document.documentElement.classList.add('standalone', 'shell');
    });
  });

  test('/auth hides the back-to-landing control', async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await expect(page.getByTestId('auth-card')).toBeVisible();
    await expect(page.getByRole('button', { name: BACK_LABEL })).toHaveCount(0);
  });
});
