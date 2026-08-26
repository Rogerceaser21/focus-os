// Desktop project bar: PROGRESSIVE overflow fold (O9, 2026-08-26).
//
// U1 (40e103e, 2026-08-23) folded the whole 7-button action row into a
// "More" menu at ONE hard container-width breakpoint (1179px). Igor's
// verdict: at full width the bar shows Invite / Move Tasks / Meetings /
// Share / New sub-project / Move to... / Archive / Delete, and one small
// shrink made every secondary action vanish into the menu at once. He wanted
// each action to stay visible until it genuinely no longer fits, then move
// into the menu, one at a time, least-used first.
//
// O9 replaces the fixed breakpoint with src/hooks/useProjectBarFold.ts: a
// ResizeObserver-driven, MEASURED fold (not a guessed CSS breakpoint — the
// row's real required width depends on the project name's length, member
// count, and archived/sub-project state, none of which a single hand-picked
// number can track). Fold order — least-used first, Invite never folds
// (lives in the name group, not the action cluster):
//   Delete, Archive, Move to..., New sub-project, Share, Meetings, Move Tasks
//
// This spec proves the fold is genuinely tight — no action folds before it
// has to, none clips after it should have folded — by re-deriving the
// expected fold count from RAW measured pixels (the same inputs the hook
// itself reads: the hidden measurer's per-action widths, the name group's
// fixed non-name width, the row's own available width) via an INDEPENDENT
// copy of the hook's greedy-fit formula, then checking the live DOM matches
// that oracle at every width in the ladder. This catches an app regression
// (e.g. an accidental extra margin, an off-by-one fold) even though the
// formula is shared, because the oracle's inputs are read fresh from the
// page each time, not asserted from memory.
//
// READ-ONLY against the demo account (shared with a sibling agent's own
// concurrent run): creates and deletes nothing, never asserts global
// project/task counts, never presses Share/Invite/Assign/Send. It signs in
// and selects the account's own pre-existing "Science Fair" project — a
// stable, top-level, non-archived, unshared seed project confirmed via a
// read-only REST select before this spec was written (not a zz-o8-* or other
// throwaway a sibling agent might delete). The one interactive step is
// opening/closing the "More" menu itself (not a forbidden button) to read
// its contents for check (c).
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/projectbar-widths.spec.ts
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account the other project specs sign in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// A stable, pre-existing seed project in the demo account: top-level,
// non-archived, not shared (verified read-only via REST before writing this
// spec) — so ALL SEVEN fold candidates exist and the "New sub-project" /
// "Move to..." items are never conditionally absent.
const PROJECT_NAME = 'Science Fair';

// Mirrors src/pages/Index.tsx's renderProjectBar `barItems`/`BAR_FOLD_ORDER`.
// DISPLAY order is left-to-right in the bar / top-to-bottom in the menu.
// FOLD order is least-used-first — the order useProjectBarFold folds items
// into the menu as the container narrows.
const DISPLAY_ORDER = ['moveTasks', 'meetings', 'share', 'newSub', 'moveTo', 'archive', 'delete'];
const FOLD_ORDER = ['delete', 'archive', 'moveTo', 'newSub', 'share', 'meetings', 'moveTasks'];

const MORE_TESTID: Record<string, string> = {
  moveTasks: 'desktop-more-move-tasks',
  meetings: 'desktop-more-meetings',
  share: 'desktop-more-share',
  newSub: 'desktop-more-new-sub',
  moveTo: 'desktop-more-move',
  archive: 'desktop-more-archive',
  delete: 'desktop-more-delete',
};

// ---- UI sign-in + project selection (same shape as the other project specs) ----

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// The mobile drawer is a portal exposed as role="dialog" aria-label="Projects".
// On desktop the sidebar renders inline instead — no such dialog exists — so
// this is a no-op there rather than a wait/timeout.
const drawer = (page: Page) => page.locator('div[role="dialog"][aria-label="Projects"]');

const openDrawer = async (page: Page) => {
  const appeared = await drawer(page)
    .first()
    .waitFor({ state: 'attached', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return; // desktop: sidebar is already inline, nothing to open
  const state = await drawer(page).getAttribute('data-state').catch(() => null);
  if (state === 'open') return;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer(page)).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

// "Science Fair"'s id, resolved once via a read-only REST select before
// writing this spec (see the file header) — using the testid directly avoids
// any text-matching ambiguity and matches the pattern other mobile specs in
// this repo use (tests/mobile-share-pill.spec.ts's `selectProject`).
const SCIENCE_FAIR_ID = 'a64a37df-ad42-432c-9e91-6a030cb1afd3';

const selectProjectByName = async (page: Page, name: string) => {
  await openDrawer(page);
  const nameSpan = page.locator('.lg-projbar [data-projects-tour-step="project-name"]');
  const alreadyThere = await nameSpan
    .first()
    .textContent({ timeout: 2000 })
    .then((t) => t === name)
    .catch(() => false);
  if (alreadyThere) return;

  const row = page.getByTestId(`select-project-${SCIENCE_FAIR_ID}`);
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(nameSpan).toHaveText(name, { timeout: 15000 });
};

// ---- Geometry oracle ---------------------------------------------------------
//
// Reads the exact same raw inputs src/hooks/useProjectBarFold.ts measures
// (the hidden `[data-fold-key]` measurer, the name group's fixed non-name
// width, the row's own padded width) straight off the live page, plus which
// of the seven action keys are CURRENTLY rendered as real, visible buttons.
// The hidden measurer and the name group are ALWAYS in the DOM regardless of
// fold state, so these inputs are valid whether or not the app has already
// converged to the right answer at read time.

interface BarGeometry {
  barBox: { x: number; right: number; width: number; height: number };
  rowClientWidth: number;
  rowPad: number;
  reservedName: number;
  keyWidths: Record<string, number>;
  moreWidth: number;
  visible: Array<{ key: string; x: number; right: number }>;
  moreVisible: boolean;
  moreBox: { x: number; right: number } | null;
}

const readBarGeometry = async (page: Page): Promise<BarGeometry> =>
  page.evaluate(() => {
    const KEY_LABEL: Record<string, RegExp> = {
      moveTasks: /^(Move Tasks|Done Moving)$/,
      meetings: /^Meetings$/,
      share: /^Share$/,
      newSub: /^New sub-project$/,
      moveTo: /^Move to\.\.\.$/,
      archive: /^(Archive|Restore)$/,
      delete: /^Delete$/,
    };

    const bar = document.querySelector('.lg-projbar') as HTMLElement;
    const barRect = bar.getBoundingClientRect();
    const row = bar.querySelector(':scope > div') as HTMLElement;
    const rowStyle = getComputedStyle(row);
    const rowPad = parseFloat(rowStyle.paddingLeft || '0') + parseFloat(rowStyle.paddingRight || '0');

    const nameGroup = bar.querySelector('.flex-1.min-w-0') as HTMLElement;
    const nameEl = bar.querySelector('[data-projects-tour-step="project-name"]') as HTMLElement;
    // O9 skeptic fix (2026-08-26): the original `nameGroup.scrollWidth -
    // nameEl.scrollWidth` was self-referential — the group is flex-1, so when
    // it is not overflowing, scrollWidth reports its INFLATED box (>= its
    // clientWidth), which tracks the viewport, not the content. That made the
    // oracle's reservedName echo whatever the DOM already showed, so the
    // fold-count assertion could not catch a premature fold at any width
    // (skeptic check 4: divergence from the true fixed cost up to 334px).
    // Derive it the way the hook itself does: sum the shrink-0 non-name
    // siblings' own rendered widths plus the group's column gaps.
    const nameGroupChildren = Array.from(nameGroup.children);
    const nameGroupGap = parseFloat(getComputedStyle(nameGroup).columnGap || '0') || 0;
    const fixedChildrenWidth = nameGroupChildren
      .filter((child) => child !== nameEl)
      .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
    const nameGroupFixed = fixedChildrenWidth + Math.max(0, nameGroupChildren.length - 1) * nameGroupGap;

    const measure = bar.querySelector('[aria-hidden="true"]') as HTMLElement;
    const keyWidths: Record<string, number> = {};
    measure.querySelectorAll('[data-fold-key]').forEach((el) => {
      const k = el.getAttribute('data-fold-key');
      if (k) keyWidths[k] = (el as HTMLElement).getBoundingClientRect().width;
    });
    const moreWidthEl = measure.querySelector('[data-fold-more]') as HTMLElement | null;
    const moreWidth = moreWidthEl ? moreWidthEl.getBoundingClientRect().width : 0;

    const visible: Array<{ key: string; x: number; right: number }> = [];
    Array.from(bar.querySelectorAll('button')).forEach((b) => {
      if (getComputedStyle(b).visibility === 'hidden') return; // hidden measurer clones
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (b.getAttribute('data-testid') === 'desktop-more') return; // handled separately
      const text = (b.textContent || '').trim();
      for (const [key, pattern] of Object.entries(KEY_LABEL)) {
        if (pattern.test(text)) { visible.push({ key, x: r.x, right: r.right }); break; }
      }
    });

    const moreTrigger = bar.querySelector('[data-testid="desktop-more"]') as HTMLElement | null;
    const moreVisibleRect = moreTrigger ? moreTrigger.getBoundingClientRect() : null;
    const moreVisible = !!moreVisibleRect && moreVisibleRect.width > 0;

    return {
      barBox: { x: barRect.x, right: barRect.right, width: barRect.width, height: barRect.height },
      rowClientWidth: row.clientWidth,
      rowPad,
      reservedName: nameGroupFixed + 64,
      keyWidths,
      moreWidth,
      visible,
      moreVisible,
      moreBox: moreVisible ? { x: moreVisibleRect!.x, right: moreVisibleRect!.right } : null,
    };
  });

// Independent copy of useProjectBarFold's greedy-fit loop (documented there),
// evaluated against freshly-read pixels — not a hardcoded threshold.
const computeExpectedFoldCount = (geo: BarGeometry, gap = 8): number => {
  const available = geo.rowClientWidth - geo.rowPad;
  const keys = FOLD_ORDER.filter((k) => geo.keyWidths[k] !== undefined);
  let count = 0;
  for (; count <= keys.length; count++) {
    const vis = keys.slice(count);
    const visibleWidth = vis.reduce((sum, k) => sum + geo.keyWidths[k], 0);
    const innerGaps = Math.max(0, vis.length - 1) * gap;
    const rowGapToName = vis.length > 0 || count > 0 ? gap : 0;
    const moreExtra = count > 0 ? geo.moreWidth + gap : 0;
    const total = geo.reservedName + rowGapToName + visibleWidth + innerGaps + moreExtra;
    if (total <= available) break;
  }
  return count;
};

// The projects tour's "Delete Project" step anchors on the first VISIBLE
// `[data-projects-tour-step="delete-button"]` match (useTourSpotlight
// findVisible). Whichever tier is showing, exactly one match must have a
// real rect: the bar's own Delete button when unfolded, the More trigger
// when folded (Delete folds first, so the two are always mutually visible).
const assertTourDeleteAnchorVisible = async (page: Page) => {
  const rect = await page.evaluate(() => {
    const matches = document.querySelectorAll('[data-projects-tour-step="delete-button"]');
    let el: Element | null = null;
    for (const m of matches) {
      if (m.getClientRects().length > 0) { el = m; break; }
    }
    el = el ?? matches[0] ?? null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  expect(rect, 'the tour delete anchor must exist').not.toBeNull();
  expect(rect!.width, 'the tour delete anchor must have width').toBeGreaterThan(0);
  expect(rect!.height, 'the tour delete anchor must have height').toBeGreaterThan(0);
};

// ---- Test: desktop width ladder ---------------------------------------------

test.describe('project bar: progressive overflow fold (O9)', () => {
  test.use({ viewport: { width: 1024, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

  test('folds one action at a time as the container narrows, matches the More menu, keeps the tour anchor resolvable, and never clips', async ({ page }) => {
    test.setTimeout(180_000);

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await selectProjectByName(page, PROJECT_NAME);

    // Viewport widths; the sidebar's own fixed width is NEVER assumed here —
    // every assertion below reads the bar's real measured width off the DOM.
    // The ladder spans from comfortably full-width down to 1024, the `lg:`
    // breakpoint floor below which the desktop bar itself (`hidden lg:block`)
    // stops existing — the container's own achievable range in this build is
    // roughly 700-1400px, matching the task's suggested ladder.
    const LADDER = [1722, 1600, 1500, 1400, 1300, 1200, 1100, 1024];

    const heights: number[] = [];
    let lastFoldCount = -1;

    for (const vw of LADDER) {
      await page.setViewportSize({ width: vw, height: 900 });
      await expect(page.locator('.lg-projbar [data-projects-tour-step="project-name"]')).toHaveText(PROJECT_NAME, { timeout: 10000 });

      // Wait for the fold state to converge to what the raw geometry
      // justifies (the hook's ResizeObserver settles within a frame or two;
      // this polls rather than sleeping a fixed guess).
      await expect
        .poll(
          async () => {
            const geo = await readBarGeometry(page);
            const expected = computeExpectedFoldCount(geo);
            return FOLD_ORDER.length - geo.visible.length === expected;
          },
          { timeout: 8000, message: `fold state should converge to the geometry-justified count at ${vw}px` },
        )
        .toBe(true);

      const geo = await readBarGeometry(page);
      const expectedFoldCount = computeExpectedFoldCount(geo);
      const expectedFoldedKeys = new Set(FOLD_ORDER.slice(0, expectedFoldCount));
      const expectedVisibleKeys = DISPLAY_ORDER.filter((k) => !expectedFoldedKeys.has(k));

      // (a) the visible action SET matches the defined fold order: exactly
      // the DISPLAY-order keys NOT in the geometry-justified folded prefix.
      const actualVisibleKeys = DISPLAY_ORDER.filter((k) => geo.visible.some((v) => v.key === k));
      expect(actualVisibleKeys, `visible set at ${vw}px`).toEqual(expectedVisibleKeys);
      // Folding is monotonic as the container narrows — no action reappears
      // after folding, and nothing folds "out of turn" ahead of an
      // earlier-priority item (a non-prefix folded set would fail the line
      // above already; this also asserts the ladder-wide trend).
      expect(expectedFoldCount, `fold count must never shrink as the container narrows (was ${lastFoldCount} at a wider step)`).toBeGreaterThanOrEqual(lastFoldCount);
      lastFoldCount = expectedFoldCount;

      // (b) nothing clips past the bar's right edge — this is also why (a)'s
      // oracle is meaningful: it's the TIGHTEST count that still fits, so a
      // pass here proves no action folded before it had to.
      for (const v of geo.visible) {
        expect(v.right, `${v.key} must stay inside the bar at ${vw}px`).toBeLessThanOrEqual(geo.barBox.right + 0.5);
      }
      if (geo.moreBox) {
        expect(geo.moreBox.right, `More trigger must stay inside the bar at ${vw}px`).toBeLessThanOrEqual(geo.barBox.right + 0.5);
      }
      expect(geo.moreVisible, `More trigger visibility must match "something is folded" at ${vw}px`).toBe(expectedFoldCount > 0);

      // (c) the More menu contains EXACTLY the folded actions, in the same
      // display order the bar itself uses.
      if (expectedFoldCount > 0) {
        await page.getByTestId('desktop-more').click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const items = menu.getByRole('menuitem');
        const testids = await items.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
        const expectedTestids = DISPLAY_ORDER.filter((k) => expectedFoldedKeys.has(k)).map((k) => MORE_TESTID[k]);
        expect(testids, `More menu contents at ${vw}px`).toEqual(expectedTestids);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden({ timeout: 5000 });
      }

      heights.push(geo.barBox.height);
    }

    // (e) no layout jump: the bar's own height never changes across the
    // whole ladder, folded or not.
    expect(new Set(heights).size, `bar height must stay constant across the ladder (saw: ${heights.join(', ')})`).toBe(1);

    // (d) the tour Delete anchor resolves at a folded AND an unfolded width.
    // Widest step of the ladder = unfolded; re-check it's still unfolded,
    // then the narrowest = folded, before reading the anchor at each.
    await page.setViewportSize({ width: LADDER[0], height: 900 });
    await expect.poll(async () => (await readBarGeometry(page)).moreVisible, { timeout: 8000 }).toBe(false);
    await assertTourDeleteAnchorVisible(page);

    await page.setViewportSize({ width: LADDER[LADDER.length - 1], height: 900 });
    await expect.poll(async () => (await readBarGeometry(page)).moreVisible, { timeout: 8000 }).toBe(true);
    await assertTourDeleteAnchorVisible(page);
  });

  // O9 skeptic regression (2026-08-26): with the fold hook's name ref only on
  // the display span, entering inline rename unmounted the observed node, the
  // layout effect bailed and the ResizeObserver stayed disconnected — the
  // fold froze for the whole edit, and a resize mid-rename clipped the action
  // cluster ~137px past the bar edge (skeptic repro: rename at 1500, resize
  // to 1024). The ref now rides the rename input too, so the fold keeps
  // recomputing during the edit. READ-ONLY on the account: the rename is
  // exited with Escape, which discards without saving.
  test('keeps folding while the project name is being renamed', async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await selectProjectByName(page, PROJECT_NAME);

    await page.setViewportSize({ width: 1500, height: 900 });
    const nameSpan = page.locator('.lg-projbar [data-projects-tour-step="project-name"]');
    await expect(nameSpan).toHaveText(PROJECT_NAME, { timeout: 10000 });

    // Enter inline rename (the span becomes an Input; do NOT type — Escape
    // later discards).
    await nameSpan.click();
    const renameInput = page.locator('.lg-projbar input');
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await expect(renameInput).toHaveValue(PROJECT_NAME);

    // Shrink while the rename input is open: the fold must keep tracking.
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect
      .poll(async () => (await readBarGeometry(page)).moreVisible, { timeout: 8000 })
      .toBe(true);
    const geo = await readBarGeometry(page);
    for (const v of geo.visible) {
      expect(
        v.right,
        `"${v.key}" must not clip past the bar edge while renaming`,
      ).toBeLessThanOrEqual(geo.barBox.right + 0.5);
    }
    if (geo.moreBox) {
      expect(geo.moreBox.right, 'the More trigger must not clip while renaming').toBeLessThanOrEqual(geo.barBox.right + 0.5);
    }
    // The rename input must remain usable, not crushed to a sliver.
    const inputWidth = await renameInput.evaluate((el) => el.getBoundingClientRect().width);
    expect(inputWidth, 'the rename input must keep a usable width').toBeGreaterThanOrEqual(60);

    // Discard the rename; the bar must settle back to the same fold state a
    // fresh load at this width produces.
    await renameInput.press('Escape');
    await expect(nameSpan).toHaveText(PROJECT_NAME, { timeout: 5000 });
    await expect
      .poll(async () => {
        const g = await readBarGeometry(page);
        const expected = computeExpectedFoldCount(g);
        const domFolded = FOLD_ORDER.filter((k) => g.keyWidths[k] !== undefined).length - g.visible.length;
        return domFolded === expected;
      }, { timeout: 8000 })
      .toBe(true);
  });
});

// ---- Test: mobile unaffected -------------------------------------------------

test.describe('project bar: mobile unaffected (O9)', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('393x852: the desktop bar stays CSS-hidden and the mobile one-bar is unaffected', async ({ page }) => {
    test.setTimeout(60_000);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await selectProjectByName(page, PROJECT_NAME);

    // The desktop row (O9's fold hook lives on it) is `hidden lg:block` —
    // still in the DOM at this viewport, but CSS display:none — never a real
    // box, never interactable.
    const desktopRowBox = await page.locator('.lg-projbar').boundingBox();
    expect(desktopRowBox, 'the desktop project bar must have no box on a phone viewport').toBeNull();

    // The mobile one-bar (the OTHER context header, unrelated to O9) renders
    // normally with the same project name.
    const onebar = page.getByTestId('onebar');
    await expect(onebar).toBeVisible({ timeout: 10000 });
    await expect(onebar).toContainText(PROJECT_NAME);

    const foldErrors = consoleErrors.filter((e) => /useProjectBarFold|ResizeObserver|Cannot read propert/i.test(e));
    expect(foldErrors, `no O9-related console errors on mobile: ${foldErrors.join(' | ')}`).toEqual([]);
  });
});
