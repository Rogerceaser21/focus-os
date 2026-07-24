import { test, expect, type Page } from '@playwright/test';

// Regression suite for FIX A of the "motion wave" (the visible "opens twice" +
// frame freeze on phones). Two root causes are guarded here:
//
//   1. useIsMobile (src/hooks/use-mobile.tsx) used to start at `undefined` and
//      return desktop for the first render, so on a phone the 280px DESKTOP
//      sidebar mounted over the app for one wave before the mobile drawer
//      swapped in. Now the hook resolves synchronously, so isMobile is correct
//      from the first render and the desktop sidebar never appears at a mobile
//      viewport.
//   2. The ?openSidebar handshake (Index.tsx) re-ran on every `projects` change
//      while the async URL strip was still in flight, re-raising the open
//      request. A useRef one-shot latch now fires it exactly once per arrival.
//
// The real /app route needs a live Supabase session, so these run against the
// dev-only harness at /dev/drawer-repro + /dev/drawer-away (src/pages/
// DrawerRepro.tsx), which now mirrors BOTH branches: the mobile drawer AND the
// !isMobile desktop sidebar that carries `aria-label="Close sidebar"`. The
// harness's isMobile comes from the same useIsMobile via SidebarProvider, so it
// reflects the hook fix. App.tsx gives the two routes distinct React keys, so a
// navigate-open remounts DrawerRepro fresh — reproducing the cold-mount race
// even across an SPA navigation.

const PANEL = '[data-testid="drawer-panel"]';
const CLOSE = 'button[aria-label="Close sidebar"]';
const OVERLAY = '.lg-side-overlay';
const TOGGLE = '[data-testid="repro-toggle"]';
const AWAY = '[data-testid="away-toggle"]';

// Same touch helpers as tests/drawer.spec.ts: tap real pointerType:"touch" so
// hit-testing (overlay pointer-events) decides who receives the tap.
async function tapToggle(page: Page): Promise<void> {
  const box = await page.locator(TOGGLE).boundingBox();
  if (!box) throw new Error('toggle button not found');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
async function tapOutside(page: Page): Promise<void> {
  await page.touchscreen.tap(360, 200);
}

// ---------------------------------------------------------------------------
// 3a. Desktop sidebar never renders at a mobile viewport.
//
// A MutationObserver injected via addInitScript (so it is live BEFORE the app's
// first render, catching even a one-frame mount) sets a sticky flag if the
// `aria-label="Close sidebar"` button ever appears. It inspects the mutation
// records' addedNodes directly (not querySelector at callback time) so a node
// added and removed within the same synchronous wave is still caught. Asserted
// across: cold mount of the repro route, a navigate-open, and open/close cycles.
// ---------------------------------------------------------------------------
test('desktop sidebar never renders at mobile viewport', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __desktopSeen: boolean };
    w.__desktopSeen = false;
    const SEL = 'button[aria-label="Close sidebar"]';
    const hit = (n: Node): boolean =>
      n instanceof Element && (n.matches?.(SEL) || !!n.querySelector?.(SEL));
    const check = () => {
      if (document.querySelector(SEL)) w.__desktopSeen = true;
    };
    const mo = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (hit(n)) w.__desktopSeen = true;
      check();
    });
    // Observe the document node itself so the observer is valid even before
    // documentElement exists at init-script time.
    mo.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
    check();
  });

  const seen = () => page.evaluate(() => (window as unknown as { __desktopSeen: boolean }).__desktopSeen);

  // Cold mount of the repro route (fresh document → init script re-armed).
  await page.goto('/dev/drawer-repro');
  await page.locator(PANEL).waitFor();
  expect(await seen(), 'no desktop sidebar during cold mount').toBe(false);
  await expect(page.locator(CLOSE)).toHaveCount(0);

  // Navigate-open: land on the away route, tap through to the repro route with
  // ?openSidebar=true. Distinct route keys remount DrawerRepro fresh, so the
  // pre-fix async hook would flash the desktop sidebar here; the persistent
  // observer (same document across the SPA nav) would catch it.
  await page.goto('/dev/drawer-away');
  await page.locator(AWAY).waitFor();
  await page.locator(AWAY).tap();
  await page.locator(PANEL).waitFor();
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(await seen(), 'no desktop sidebar during navigate-open').toBe(false);
  await expect(page.locator(CLOSE)).toHaveCount(0);

  // Open/close cycles must never surface the desktop sidebar either.
  for (let i = 0; i < 3; i++) {
    await tapOutside(page);
    await expect(page.locator(PANEL), `close ${i}`).toHaveAttribute('data-state', 'closed');
    await tapToggle(page);
    await expect(page.locator(PANEL), `open ${i}`).toHaveAttribute('data-state', 'open');
  }
  expect(await seen(), 'no desktop sidebar across open/close cycles').toBe(false);
  await expect(page.locator(CLOSE)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 3b. Drawer mounts exactly once per intent.
//
// Extends the existing pulse pattern: alongside the open-pulse log it counts how
// many times the drawer-panel NODE is added to the DOM. A navigate-open must
// produce exactly one panel mount and exactly one open pulse (no flicker from a
// re-raised openSidebar request).
// ---------------------------------------------------------------------------
test('drawer mounts exactly once per intent', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __mounts: number;
      __log: { t: number; state: string | null }[];
    };
    w.__mounts = 0;
    w.__log = [];
    const SEL = '[data-testid="drawer-panel"]';
    const isPanel = (n: Node): boolean =>
      n instanceof Element && (n.matches?.(SEL) || !!n.querySelector?.(SEL));
    const push = (s: string | null) => {
      const L = w.__log;
      if (!L.length || L[L.length - 1].state !== s) L.push({ t: performance.now(), state: s });
    };
    const scan = () => {
      const el = document.querySelector(SEL);
      push(el ? el.getAttribute('data-state') : null);
    };
    const mo = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (isPanel(n)) w.__mounts += 1;
      scan();
    });
    mo.observe(document, {
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

  await page.goto('/dev/drawer-away');
  await page.locator(AWAY).waitFor();

  await page.locator(AWAY).tap();
  await page.locator(PANEL).waitFor();
  await page.waitForTimeout(1800); // let the ~1.5s data-delay re-render settle

  const { mounts, log } = await page.evaluate(() => {
    const w = window as unknown as {
      __mounts: number;
      __log: { t: number; state: string | null }[];
    };
    return { mounts: w.__mounts, log: w.__log };
  });
  const openPulses = log.filter((e) => e.state === 'open').length;
  console.log('panel mounts:', mounts, 'open pulses:', openPulses, 'log:', JSON.stringify(log));

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(mounts, 'panel node added to the DOM exactly once').toBe(1);
  expect(openPulses, 'drawer opens exactly once per navigate-open').toBe(1);
});

// ---------------------------------------------------------------------------
// 3c. Frame-gap sampler.
//
// A requestAnimationFrame gap recorder injected via addInitScript. After an
// open/close cycle, assert no inter-frame gap exceeded 250ms. Threshold note:
// 250ms is a deliberately generous CI margin (~15 dropped frames at 60fps) — it
// is NOT the design target but a floor that a real freeze (the ~1124ms device
// stutter from the desktop→mobile sidebar swap) would blow through, while normal
// jitter and headless scheduling noise stay well under it. The harness is
// lightweight, so this is a sanity guard on the cycle, not a reproduction of the
// device-scale freeze.
// ---------------------------------------------------------------------------
test('open/close cycle has no long frame gap', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __gaps: number[]; __last: number; __resetGaps: () => void };
    w.__gaps = [];
    w.__last = performance.now();
    w.__resetGaps = () => {
      w.__gaps = [];
      w.__last = performance.now();
    };
    const rec = () => {
      const now = performance.now();
      w.__gaps.push(now - w.__last);
      w.__last = now;
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  });

  await page.goto('/dev/drawer-repro?openSidebar=true');
  await page.locator(PANEL).waitFor();
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  // Only measure the cycle itself, not the initial load.
  await page.evaluate(() => (window as unknown as { __resetGaps: () => void }).__resetGaps());

  for (let i = 0; i < 3; i++) {
    await tapOutside(page);
    await expect(page.locator(PANEL), `close ${i}`).toHaveAttribute('data-state', 'closed');
    await tapToggle(page);
    await expect(page.locator(PANEL), `open ${i}`).toHaveAttribute('data-state', 'open');
  }

  const gaps = await page.evaluate(() => (window as unknown as { __gaps: number[] }).__gaps);
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  console.log('frames sampled:', gaps.length, 'max gap ms:', maxGap.toFixed(1));

  expect(gaps.length, 'rAF actually sampled frames during the cycle').toBeGreaterThan(0);
  expect(maxGap, 'no inter-frame gap over 250ms during the open/close cycle').toBeLessThan(250);
});
