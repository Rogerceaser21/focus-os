// THROWAWAY smoke spec for the desktop-mouse Playwright project added in
// playwright.config.ts (2026-09-02 regression wave). Proves the project split
// actually works: a spec matching desktop-*.spec.ts gets a real mouse profile
// (hasTouch:false, isMobile:false, 1512x982) even though the shared `use`
// block still sets touch/mobile true for everything else. Kept after the
// wave lands — this becomes the rig's own guard against the project config
// regressing.
//
// Signs in as the real Apple-review demo account and opens a project view the
// same way tests/share-status-live.spec.ts does (its `signIn` UI flow +
// DEMO_EMAIL/DEMO_PASSWORD + selecting a row out of the drawer/sidebar).
// tests/project-order.spec.ts's restSignIn/seedSession/openApp trio is a
// fully HERMETIC rig (synthetic probe user, in-memory project table, every
// PostgREST call intercepted) — not useful here, since this spec needs to
// read the REAL demo account's REAL project bar for lane-A evidence
// (whether the desktop pin/more action renders under a genuine mouse
// profile), not a synthetic seeded one.
//
// Run: npx playwright test --project desktop-mouse tests/desktop-smoke.spec.ts
import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

test('desktop-mouse project: real mouse profile + desktop project bar renders', async ({ page }) => {
  await page.goto('/auth');
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });

  // Confirm the project's touch/viewport config actually took effect before
  // trusting anything else this test observes.
  const maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(maxTouchPoints, 'desktop-mouse must report a real mouse (no touch points)').toBe(0);
  expect(innerWidth, 'desktop-mouse must use the 1512-wide viewport').toBe(1512);

  await page.goto('/app');
  await page.locator('[data-testid="my-projects-list"]').waitFor({ state: 'attached', timeout: 20000 });

  // Select the first project row so selectedProjectId is set and the desktop
  // project bar (which only renders its pin/more actions once a project is
  // selected) mounts.
  const firstRow = page.locator('[data-testid^="select-project-"]').first();
  await firstRow.waitFor({ state: 'attached', timeout: 20000 });
  const projectName = (await firstRow.textContent())?.trim() ?? '(unknown)';
  await firstRow.click();
  await expect(page.locator('.lg-projbar')).toBeVisible({ timeout: 15000 });

  console.log(`desktop-smoke: opened project "${projectName}"`);

  const pinVisible = await page.locator('[data-testid="desktop-pin"]').isVisible().catch(() => false);
  const moreVisible = await page.locator('[data-testid="desktop-more"]').isVisible().catch(() => false);
  console.log(`desktop-smoke: desktop-pin visible=${pinVisible}, desktop-more visible=${moreVisible}`);

  expect(pinVisible || moreVisible, 'expected desktop-pin or desktop-more on the desktop project bar').toBeTruthy();
});
