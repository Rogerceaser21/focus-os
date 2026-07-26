import { test, expect, type Page } from '@playwright/test';

// Regression suite for the mobile Projects drawer (ProjectSidebar.tsx normal-
// mobile branch), exercised through the dev-only harness at /dev/drawer-repro
// and /dev/drawer-away (src/pages/DrawerRepro.tsx).
//
// The bug (device-diagnosed 2026-07-11): the drawer was a Radix Sheet with
// forceMount + modal={false}, driven by a PLAIN toggle button (not a
// SheetTrigger). On TOUCH ONLY, Radix DismissableLayer defers its outside-
// dismiss to a one-shot document click listener. React's root-delegated onClick
// (toggle -> open) runs first, then the document listener (onDismiss ->
// onOpenChange(false)) runs second, so every open/reopen tap is cancelled.
//
// These specs assert the CORRECT behaviour. On the pre-fix Sheet construct they
// FAIL (that failing run is the reproduction). On the plain-div-portal fix they
// PASS.

const PANEL = '[data-testid="drawer-panel"]';
const OVERLAY = '.lg-side-overlay';
const TOGGLE = '[data-testid="repro-toggle"]';
const AWAY = '[data-testid="away-toggle"]';

async function panelState(page: Page): Promise<string | null> {
  return page.getAttribute(PANEL, 'data-state');
}

// Tap the geometric centre of the bottom toggle button via the touchscreen so
// hit-testing decides who receives it: when the drawer is closed the overlay is
// pointer-events:none and the button gets the tap; when open the overlay covers
// it. pointerType is "touch", which is what triggers the Radix deferral.
async function tapToggle(page: Page): Promise<void> {
  const box = await page.locator(TOGGLE).boundingBox();
  if (!box) throw new Error('toggle button not found');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

// A point in the top-right that is always outside the 280px-wide left panel, so
// it lands on the overlay while the drawer is open (tap-outside-to-close).
async function tapOutside(page: Page): Promise<void> {
  await page.touchscreen.tap(360, 200);
}

test('touch: reopen after outside-close works, ten times', async ({ page }) => {
  await page.goto('/dev/drawer-repro?openSidebar=true');
  await page.locator(PANEL).waitFor();
  // Opened by the ?openSidebar effect (mirrors Index navigation open).
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  for (let i = 0; i < 10; i++) {
    await tapOutside(page);
    await expect(page.locator(PANEL), `close on iteration ${i}`).toHaveAttribute('data-state', 'closed');
    await tapToggle(page);
    await expect(page.locator(PANEL), `reopen on iteration ${i}`).toHaveAttribute('data-state', 'open');
  }
});

test('touch: navigate-open gives exactly one open pulse and stays open', async ({ page }) => {
  await page.goto('/dev/drawer-away');
  await page.locator(AWAY).waitFor();

  // Record every data-state change of the panel across the SPA navigation.
  await page.evaluate(() => {
    (window as unknown as { __log: { t: number; state: string | null }[] }).__log = [];
    const w = window as unknown as { __log: { t: number; state: string | null }[] };
    const push = (s: string | null) => {
      const L = w.__log;
      if (!L.length || L[L.length - 1].state !== s) L.push({ t: performance.now(), state: s });
    };
    const scan = () => {
      const el = document.querySelector('[data-testid="drawer-panel"]');
      push(el ? el.getAttribute('data-state') : null);
    };
    const mo = new MutationObserver(scan);
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    const raf = () => {
      scan();
      requestAnimationFrame(raf);
    };
    raf();
    scan();
  });

  await page.locator(AWAY).tap();
  await page.locator(PANEL).waitFor();
  await page.waitForTimeout(1200); // let any flicker settle

  const log = await page.evaluate(
    () => (window as unknown as { __log: { t: number; state: string | null }[] }).__log,
  );
  const openPulses = log.filter((e) => e.state === 'open').length;
  // Surfaced in the reporter so the pre-fix pulse train is visible verbatim.
  console.log('state log:', JSON.stringify(log));
  console.log('open pulses:', openPulses);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(openPulses, 'should open exactly once, no flicker').toBe(1);
});

test('touch: navigate-open with slow data — no twitch', async ({ page }) => {
  await page.goto('/dev/drawer-away');
  await page.locator(AWAY).waitFor();

  // Arm a MutationObserver on the panel's data-state BEFORE tapping, watching
  // the whole document subtree so it catches the panel from the moment it
  // mounts on the repro route. Also raf-scan as a backstop.
  await page.evaluate(() => {
    const w = window as unknown as { __log: { t: number; state: string | null }[] };
    w.__log = [];
    const push = (s: string | null) => {
      const L = w.__log;
      if (!L.length || L[L.length - 1].state !== s) L.push({ t: performance.now(), state: s });
    };
    const scan = () => {
      const el = document.querySelector('[data-testid="drawer-panel"]');
      push(el ? el.getAttribute('data-state') : null);
    };
    const mo = new MutationObserver(scan);
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    const raf = () => {
      scan();
      requestAnimationFrame(raf);
    };
    raf();
    scan();
  });

  // Tap the away button with a real touch — navigates to
  // /dev/drawer-repro?openSidebar=true and opens the drawer (empty; data lands
  // ~1.5s later via the harness data-delay).
  await page.locator(AWAY).tap();
  await page.locator(PANEL).waitFor();
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  // Model the device GHOST CLICK: the trailing synthesized click of the SAME
  // tap that navigated here. On iOS it fires shortly after touchend, by which
  // time the drawer has opened, so it lands on the now-full-screen overlay —
  // NOT on the away button that received the pointerdown (that element is gone).
  // Playwright/CDP touch injection does not emit this delayed compat click (the
  // 'exactly one open pulse' spec above proves a native tap yields only
  // null->open, never a self-close), so we dispatch it explicitly: a lone click
  // on the overlay with NO matching pointerdown. Pre-fix this self-closes the
  // just-opened drawer; fix A ignores it. (Igor video 2026-07-18.)
  await page.locator(OVERLAY).dispatchEvent('click');

  // Let the ghost click, the ~1.5s data-delay flip, and any re-render settle.
  await page.waitForTimeout(4000);

  const log = await page.evaluate(
    () => (window as unknown as { __log: { t: number; state: string | null }[] }).__log,
  );
  const openPulses = log.filter((e) => e.state === 'open').length;
  const closedPulses = log.filter((e) => e.state === 'closed').length;
  // Index of the first open, so we can prove nothing closes AFTER it.
  const firstOpenIdx = log.findIndex((e) => e.state === 'open');
  const closedAfterOpen = log
    .slice(firstOpenIdx + 1)
    .filter((e) => e.state === 'closed').length;
  // Surfaced in the reporter so the pre-fix pulse train is visible verbatim.
  console.log('state log:', JSON.stringify(log));
  console.log('open pulses:', openPulses, 'closed pulses:', closedPulses, 'closed-after-open:', closedAfterOpen);

  // Fixed behaviour: opens exactly once, never self-closes, ends open.
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(openPulses, 'should open exactly once, no self-reopen').toBe(1);
  // At most the single honest mount-closed state before the first open. Since
  // useIsMobile resolves synchronously (motion-wave fix A), the persistent
  // drawer layer now mounts in its true closed state and then transitions open
  // — one clean open animation, not a self-close. The real twitch guard is
  // closedAfterOpen below (no close AFTER the open). The pre-fix async hook made
  // the panel mount already-open, so this was 0; <=1 covers both.
  expect(closedPulses, 'at most the initial mount-closed, never more').toBeLessThanOrEqual(1);
  expect(closedAfterOpen, 'no close after the first open (the twitch)').toBe(0);
});

test('overlay pointer-events track state; body stays interactive', async ({ page }) => {
  await page.goto('/dev/drawer-repro');
  await page.locator(PANEL).waitFor();

  // Closed at load.
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  expect(await page.locator(OVERLAY).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe('auto');

  // Open via the toggle.
  await tapToggle(page);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(await page.locator(OVERLAY).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe('auto');
});

test('touch: tapping the covered toggle while open closes the drawer', async ({ page }) => {
  await page.goto('/dev/drawer-repro?openSidebar=true');
  await page.locator(PANEL).waitFor();
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  // Tap the toggle's location on the right edge, where the open overlay (z-50)
  // sits above the button (z-20): the overlay receives it and closes. Accepted
  // behaviour (overlay covers BottomNav while the drawer is open).
  const box = await page.locator(TOGGLE).boundingBox();
  if (!box) throw new Error('toggle not found');
  await page.touchscreen.tap(box.x + box.width - 20, box.y + box.height / 2);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
});
