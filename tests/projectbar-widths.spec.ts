// Desktop project bar container-query tiers (U1) — end-to-end against the real
// demo account and the real Supabase backend (no mocking), same shape as
// tests/project-rollups.spec.ts for the REST cleanup half and
// tests/project-tree.spec.ts for the sign-in / create-project half.
//
// The bisect (foreman, Chromium, demo account, before this fix): the full
// 7-button right-hand action row is 808px and shrink-0, so below ~1400px
// windows it either overflows the bar (buttons clipped off the right edge) or
// crushes the project name to 0px, with Invite overlapping Move Tasks in both
// cases. The fix makes .lg-projbar an inline-size CSS container and swaps the
// full row for a single "More" dropdown once the BAR's own width drops to
// <= 1179px (src/index.css). This spec proves the swap actually happens, that
// nothing overlaps or clips at the tested widths, and that every action still
// works from both the full row and the More menu.
//
// Desktop only: overrides the repo's mobile-touch Playwright defaults.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/projectbar-widths.spec.ts
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// actionTimeout bounds every bare locator action (click/fill/textContent/etc) in
// THIS file only — config.ts leaves it unset (0 = unbounded), which let a
// zero-match locator hang for the full test timeout during development instead of
// failing fast. Scoped here, not in the shared playwright.config.ts.
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account the other project specs sign in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

const WIDTHS = [1024, 1100, 1180, 1280];

// ---- UI sign-in + project creation ---------------------------------------

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// The mobile drawer is a portal exposed as role="dialog" aria-label="Projects".
// On desktop (this spec's viewport) the sidebar renders inline instead — no
// such dialog exists — so this is a no-op there rather than a wait/timeout.
const drawer = (page: Page) => page.getByLabel('Projects');

const openDrawer = async (page: Page) => {
  const count = await drawer(page).count();
  if (count === 0) return; // desktop: sidebar is already inline, nothing to open
  const state = await drawer(page).getAttribute('data-state').catch(() => null);
  if (state === 'open') return;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer(page)).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

// Every project row (top level or sub) carries data-testid="select-project-<id>".
const projectIdByName = async (page: Page, name: string): Promise<string> => {
  const row = page.locator('[data-testid^="select-project-"]').filter({ hasText: name }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  const testId = await row.getAttribute('data-testid');
  const id = (testId ?? '').replace('select-project-', '');
  expect(id, `could not resolve a project id for "${name}"`).not.toBe('');
  return id;
};

// Create a top-level project through the sidebar's own dialog. Returns the new
// project's id.
const createProject = async (page: Page, name: string): Promise<string> => {
  await openDrawer(page);
  await page.getByRole('button', { name: 'New Project' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create New Project' });
  await createDialog.getByPlaceholder('e.g., Website Redesign').fill(name);
  await createDialog.getByRole('button', { name: 'Create Project' }).click();
  await expect(createDialog).toBeHidden({ timeout: 10000 });
  return projectIdByName(page, name);
};

// Select a project row so the bar renders, or re-select it after a navigation
// unmounted Index (e.g. the Meetings item). Idempotent: a no-op if THIS
// project's bar is already showing. Checked by NAME, not by generic
// `.lg-projbar` visibility — that class is shared with the Today / Past Due /
// Unassigned special-list banner (src/pages/Index.tsx), which is what is
// showing by default before any project is ever selected, so a bare
// visibility check bails out immediately without ever clicking the row.
const selectProject = async (page: Page, id: string, name: string) => {
  const nameSpan = page.locator('.lg-projbar [data-projects-tour-step="project-name"]');
  // Short explicit timeout: this locator legitimately matches ZERO elements
  // whenever a special list (Today/Past Due/Unassigned) is showing instead of
  // a project, which is the normal starting state — fail fast into the click
  // path below rather than waiting on an element that may never appear.
  const alreadyThere = await nameSpan
    .first()
    .textContent({ timeout: 2000 })
    .then((t) => t === name)
    .catch(() => false);
  if (alreadyThere) return;

  const row = page.getByTestId(`select-project-${id}`);
  if ((await row.count()) > 0) {
    await row.click();
  } else {
    await page.goto(`${BASE}/app?view=${id}`);
  }
  await expect(nameSpan).toHaveText(name, { timeout: 15000 });
};

// ---- PostgREST helpers, signed in as the demo account --------------------

interface Session { token: string; userId: string; }

const restSignIn = async (request: APIRequestContext): Promise<Session> => {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  expect(res.ok(), 'REST sign-in as the demo account must succeed').toBeTruthy();
  const body = await res.json();
  expect(body.access_token, 'REST sign-in must return an access token').toBeTruthy();
  return { token: body.access_token, userId: body.user.id };
};

const restHeaders = (s: Session, extra: Record<string, string> = {}) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${s.token}`,
  'Content-Type': 'application/json',
  ...extra,
});

const restSelect = async (request: APIRequestContext, s: Session, path: string): Promise<any[]> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(s) });
  expect(res.ok(), `select ${path} must succeed (${res.status()})`).toBeTruthy();
  return res.json();
};

// Delete one row and PROVE it went: return=representation echoes the deleted
// row, so an id that was already gone (or that RLS refused) is reported as a
// leak instead of passing silently.
const restDelete = async (request: APIRequestContext, s: Session, id: string): Promise<string | null> => {
  const res = await request.delete(`${SUPABASE_URL}/rest/v1/focusos_projects?id=eq.${id}`, {
    headers: restHeaders(s, { Prefer: 'return=representation' }),
  });
  if (!res.ok()) return `focusos_projects ${id}: HTTP ${res.status()}`;
  const rows = await res.json();
  if (rows.length !== 1) return `focusos_projects ${id}: delete removed ${rows.length} rows`;
  return null;
};

// ---- Bounding-box geometry -------------------------------------------------

interface Box { x: number; y: number; width: number; height: number; }

// Overlap on BOTH axes beyond the 0.5px tolerance counts as a real collision;
// touching or 1px-rounding-adjacent edges do not.
const boxesOverlap = (a: Box, b: Box, tol = 0.5): boolean => {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlapX > tol && overlapY > tol;
};

// (a) Every VISIBLE control inside .lg-projbar (every button plus the project
// name span): no two bounding boxes collide, and nothing sticks out past the
// bar's own right edge (the main column is overflow-x-hidden, so a clipped
// control is invisible to the user, not just untidy).
const assertNoOverlapNoClip = async (page: Page) => {
  const bar = page.locator('.lg-projbar');
  const barBox = await bar.boundingBox();
  expect(barBox, 'the project bar must have a bounding box').not.toBeNull();
  if (!barBox) return;

  const controls = await page
    .locator('.lg-projbar button, .lg-projbar [data-projects-tour-step="project-name"]')
    .all();

  const visible: { label: string; box: Box }[] = [];
  for (const el of controls) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (!box) continue;
    const label =
      (await el.getAttribute('data-testid')) ||
      (await el.getAttribute('aria-label')) ||
      ((await el.textContent()) ?? '').trim() ||
      'control';
    visible.push({ label, box });
    expect(
      box.x + box.width,
      `${label} must not be clipped past the bar's right edge`,
    ).toBeLessThanOrEqual(barBox.x + barBox.width + 0.5);
  }

  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const collide = boxesOverlap(visible[i].box, visible[j].box);
      expect(collide, `${visible[i].label} must not overlap ${visible[j].label}`).toBe(false);
    }
  }
};

// The projects tour's "Delete Project" step anchors on the first VISIBLE
// `[data-projects-tour-step="delete-button"]` match (useTourSpotlight
// findVisible: first element with client rects, else matches[0]). In the
// compact tier the full-row Delete button is display:none, so the More trigger
// must carry the anchor, or the tour spotlights a 0x0 rect on the hidden
// mobile one-bar wrapper (skeptic finding, 2026-08-23). Reproduces findVisible
// verbatim and demands a real rectangle.
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

// ---- Interaction checks (b) ------------------------------------------------

const testInviteButton = async (page: Page) => {
  const inviteButton = page.locator('.lg-projbar').getByRole('button', { name: 'Invite' });
  await inviteButton.click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Invite to' });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5000 });
};

const testMoveTasksToggle = async (page: Page) => {
  const moveTasksButton = page.locator('.lg-projbar').getByRole('button', { name: /^(Move Tasks|Done Moving)$/ });
  await expect(moveTasksButton).toHaveText('Move Tasks');
  await moveTasksButton.click();
  await expect(moveTasksButton).toHaveText('Done Moving');
  await moveTasksButton.click();
  await expect(moveTasksButton).toHaveText('Move Tasks');
};

const openMoreMenu = async (page: Page) => {
  await page.getByTestId('desktop-more').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  return menu;
};

// Runs every item in the "More" menu, in the same order the menu lists them,
// asserting each one's effect and then closing it WITHOUT confirming anything
// destructive (Archive/Delete get Cancel, everything else gets Escape).
// Meetings runs last because it navigates away and needs the project reselected.
const testMoreMenuItems = async (page: Page, projectId: string, projectName: string) => {
  const menu = await openMoreMenu(page);
  const names = await menu.getByRole('menuitem').allInnerTexts();
  expect(names).toEqual(['Meetings', 'Share', 'New sub-project', 'Move to...', 'Archive', 'Delete']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden({ timeout: 5000 });

  // Share
  await openMoreMenu(page);
  await page.getByTestId('desktop-more-share').click();
  const shareDialog = page.getByRole('dialog', { name: 'Share Project' });
  await expect(shareDialog).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(shareDialog).toBeHidden({ timeout: 5000 });

  // New sub-project
  await openMoreMenu(page);
  await page.getByTestId('desktop-more-new-sub').click();
  const createDialog = page.getByRole('dialog', { name: 'Create New Project' });
  await expect(createDialog).toBeVisible({ timeout: 5000 });
  await expect(createDialog.getByTestId('create-project-parent')).toContainText(projectName);
  await page.keyboard.press('Escape');
  await expect(createDialog).toBeHidden({ timeout: 5000 });

  // Move to...
  await openMoreMenu(page);
  await page.getByTestId('desktop-more-move').click();
  const moveSheet = page.getByTestId('onebar-move-sheet');
  await expect(moveSheet).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(moveSheet).toBeHidden({ timeout: 5000 });

  // Archive (Cancel, never confirm)
  await openMoreMenu(page);
  await page.getByTestId('desktop-more-archive').click();
  const archiveAlert = page.getByRole('alertdialog');
  await expect(archiveAlert).toBeVisible({ timeout: 5000 });
  await expect(archiveAlert).toContainText('Archive Project?');
  await archiveAlert.getByRole('button', { name: 'Cancel' }).click();
  await expect(archiveAlert).toBeHidden({ timeout: 5000 });

  // Delete (Cancel, never confirm)
  await openMoreMenu(page);
  await page.getByTestId('desktop-more-delete').click();
  const deleteAlert = page.getByRole('alertdialog');
  await expect(deleteAlert).toBeVisible({ timeout: 5000 });
  await expect(deleteAlert).toContainText('Delete Project?');
  await deleteAlert.getByRole('button', { name: 'Cancel' }).click();
  await expect(deleteAlert).toBeHidden({ timeout: 5000 });

  // Meetings (last: navigates away, then comes back)
  await openMoreMenu(page);
  await page.getByTestId('desktop-more-meetings').click();
  await page.waitForURL(new RegExp(`/meetings\\?project=${projectId}`), { timeout: 10000 });
  await page.goBack();
  await selectProject(page, projectId, projectName);
};

// ---- Test -------------------------------------------------------------------

test.describe('project bar: container-query action tiers (U1)', () => {
  test('the bar swaps to a More menu below a 1180px container width, with no overlap or clipping, and every action still works', async ({ page, request }) => {
    // Generous: 4 widths, each running the full Invite / Move Tasks / six-item
    // More-menu cycle (Meetings included, which navigates away and back) against
    // a real browser and the real Supabase backend. A 30s per-test default ran out
    // during the final cleanup delete on the previous run.
    test.setTimeout(300_000);

    const s = await restSignIn(request);
    const before = await restSelect(request, s, 'focusos_projects?select=id');
    const beforeCount = before.length;

    const stamp = Date.now();
    const projectName = `U1 Bar Test ${stamp}`;
    let projectId = '';
    let bodyError: Error | null = null;

    try {
      await signIn(page);
      await page.goto(`${BASE}/app`);
      projectId = await createProject(page, projectName);
      await selectProject(page, projectId, projectName);

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });

        // Settle signal: at all four of these widths the bar's own inline
        // size is well under the 1179px container threshold, so the More
        // trigger is the compact tier's marker that layout has settled.
        await expect(page.getByTestId('desktop-more')).toBeVisible({ timeout: 10000 });

        // The tier really switched: the full-row-only buttons are hidden.
        await expect(page.getByTestId('desktop-new-sub')).toBeHidden();
        await expect(page.getByTestId('desktop-archive')).toBeHidden();

        // (a) no overlap, nothing clipped past the bar's edge
        await assertNoOverlapNoClip(page);

        // The projects tour can still find Delete in this tier.
        await assertTourDeleteAnchorVisible(page);

        // (c) the name has real width, never a 0px collapse
        const nameBox = await page
          .locator('.lg-projbar [data-projects-tour-step="project-name"]')
          .boundingBox();
        expect(nameBox?.width ?? 0).toBeGreaterThan(0);

        // Screenshot with no menu open, right after the (a) assertion.
        await page.locator('.lg-projbar').screenshot({ path: `test-results/u1-projectbar-${width}.png` });

        // (b) every control is clickable and its handler fires
        await testInviteButton(page);
        await testMoveTasksToggle(page);
        await testMoreMenuItems(page, projectId, projectName);
      }

      // Protects the full tier: at a comfortably wide window the bar's own
      // container is > 1179px, so the full row must be back and the More
      // trigger gone, still with no overlap or clipping.
      await page.setViewportSize({ width: 1600, height: 900 });
      await expect(page.getByTestId('desktop-archive')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('desktop-more')).toBeHidden();
      await expect(page.getByTestId('desktop-new-sub')).toBeVisible();
      await expect(page.locator('.lg-projbar').getByRole('button', { name: 'Delete' })).toBeVisible();
      await assertNoOverlapNoClip(page);
      await assertTourDeleteAnchorVisible(page);
    } catch (e) {
      bodyError = e as Error;
    }

    // Cleanup: delete the throwaway project (asserted) and confirm the demo
    // account's project count is exactly what it was before this test ran.
    const cleanupProblems: string[] = [];
    if (projectId) {
      const problem = await restDelete(request, s, projectId);
      if (problem) cleanupProblems.push(problem);
    }
    const after = await restSelect(request, s, 'focusos_projects?select=id');
    if (after.length !== beforeCount) {
      cleanupProblems.push(`project count changed: before ${beforeCount}, after ${after.length}`);
    }

    if (bodyError) {
      if (cleanupProblems.length) bodyError.message = `${bodyError.message}\n[cleanup problems] ${cleanupProblems.join('; ')}`;
      throw bodyError;
    }
    expect(cleanupProblems, 'cleanup must leave the demo account exactly as it was').toEqual([]);
  });
});
