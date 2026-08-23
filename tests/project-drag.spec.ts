// Drag-and-drop PROJECT moves in the drawer (U2) — end-to-end against the real
// demo account and the real Supabase backend (no mocking), same shape as
// tests/projectbar-widths.spec.ts (desktop override + REST cleanup) and
// tests/project-tree.spec.ts (sign-in + create-through-the-dialog).
//
// Igor's ask: "I want to be able to move projects just like I can move the
// tasks... drag and drop. The way it's created now (Move to... sheet) is
// cumbersome". So the drawer's own project rows are draggable: drop a row on
// another project's block to nest it, drop it on the "My Projects" heading to
// bring it back to top level. The Move to... sheet stays untouched.
//
// What this proves, one sequential journey over three throwaway projects:
//   (1) drag A onto B  -> A renders as a sub inside B AND the row's
//       parent_project_id really is B (REST read-back, not just the DOM);
//   (5) drag A (a sub) back onto B, its CURRENT parent -> silent no-op, and no
//       PATCH to focusos_projects is issued at all;
//   (2) drag A onto the "My Projects" heading -> A is top level again, in the
//       DOM and in the database;
//   (3) with C nested under A, drag A onto B -> the one-level rule refuses with
//       the "Move its sub-projects first" toast and writes NOTHING;
//   (4) a plain click on a row still selects it, and a drag released outside
//       every drop target writes nothing.
//
// Desktop only: overrides the repo's mobile-touch Playwright defaults and drives
// the drags with page.mouse, because the pointer sensor deliberately ignores
// touch (a finger on a row must still scroll the drawer — the touch path is the
// TouchSensor's 250ms long-press, which the iOS sim driver exercises instead).
//
// Every row this spec creates carries a timestamp and is REST-deleted in a
// finally block with the delete ASSERTED, plus a project-count parity check, so
// the demo account ends exactly as it started.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/project-drag.spec.ts
import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';

// actionTimeout bounds every bare locator action in THIS file only — the shared
// playwright.config.ts leaves it unset (0 = unbounded), which lets a zero-match
// locator hang for the whole test timeout instead of failing fast.
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account the other project specs sign in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

// ---- UI sign-in + project creation ------------------------------------------

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// The mobile drawer is a permanently-mounted plain-div portal exposed as
// role="dialog" aria-label="Projects". At this viewport the sidebar is INLINE
// and that dialog does not exist at all, so the helper is a no-op — copied from
// tests/projectbar-widths.spec.ts, which runs at the same width.
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

// Create a top-level project through the sidebar's own dialog.
const createProject = async (page: Page, name: string): Promise<string> => {
  await openDrawer(page);
  await page.getByRole('button', { name: 'New Project' }).click();
  // Named, not a bare getByRole('dialog') — the drawer itself is also an ARIA dialog.
  const createDialog = page.getByRole('dialog', { name: 'Create New Project' });
  await createDialog.getByPlaceholder('e.g., Website Redesign').fill(name);
  await createDialog.getByRole('button', { name: 'Create Project' }).click();
  await expect(createDialog).toBeHidden({ timeout: 10000 });
  return projectIdByName(page, name);
};

// ---- The gesture -------------------------------------------------------------

/**
 * A real mouse drag: press on the source row, clear the sensor's 8px activation
 * distance, walk to the destination in visible increments (dnd-kit recomputes
 * collisions from pointermove, so a single jump can miss), then release.
 *
 * Both boxes are read AFTER all scrolling, never side by side with it: a
 * scrollIntoViewIfNeeded between the two reads would invalidate the first one.
 */
const dragRowTo = async (page: Page, source: Locator, target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const t = await target.boundingBox();
  const s = await source.boundingBox();
  expect(s, 'the dragged row must have a box').toBeTruthy();
  expect(t, 'the drop target must have a box').toBeTruthy();
  const sx = s!.x + s!.width / 2;
  const sy = s!.y + s!.height / 2;
  const tx = t!.x + t!.width / 2;
  const ty = t!.y + t!.height / 2;
  await dragFromTo(page, sx, sy, tx, ty);
};

/** Same gesture, but to bare coordinates (used for the drop-in-nowhere case). */
const dragFromTo = async (page: Page, sx: number, sy: number, tx: number, ty: number) => {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // > 8px in one move so the drag is definitely live before the walk starts.
  await page.mouse.move(sx + 14, sy);
  await page.waitForTimeout(60);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps);
    await page.waitForTimeout(40);
  }
  await page.mouse.move(tx, ty);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(150);
};

// ---- PostgREST helpers, signed in as the demo account ------------------------

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

const restSelect = async (
  request: APIRequestContext,
  s: Session,
  path: string,
): Promise<any[]> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(s) });
  expect(res.ok(), `select ${path} must succeed (${res.status()})`).toBeTruthy();
  return res.json();
};

/** The one read this spec's verdicts hang on: what the DATABASE thinks a project's parent is. */
const parentOf = async (request: APIRequestContext, s: Session, id: string): Promise<string | null> => {
  const rows = await restSelect(request, s, `focusos_projects?id=eq.${id}&select=parent_project_id`);
  expect(rows.length, `project ${id} must still exist`).toBe(1);
  return (rows[0].parent_project_id ?? null) as string | null;
};

const projectCount = async (request: APIRequestContext, s: Session): Promise<number> => {
  const rows = await restSelect(request, s, 'focusos_projects?select=id');
  return rows.length;
};

// Delete one row and PROVE it went: `return=representation` echoes the deleted
// rows, so an id that was already gone (or that RLS refused) comes back empty
// and is reported as a leak instead of passing silently.
const restDelete = async (
  request: APIRequestContext,
  s: Session,
  id: string,
): Promise<string | null> => {
  const res = await request.delete(`${SUPABASE_URL}/rest/v1/focusos_projects?id=eq.${id}`, {
    headers: restHeaders(s, { Prefer: 'return=representation' }),
  });
  if (!res.ok()) return `focusos_projects ${id}: HTTP ${res.status()}`;
  const rows = await res.json();
  if (rows.length !== 1) return `focusos_projects ${id}: delete removed ${rows.length} rows`;
  return null;
};

/**
 * SUBS FIRST, then parents: the parent FK is ON DELETE SET NULL, so removing a
 * parent first would orphan its subs into top-level rows on the demo account.
 * Never throws — it returns a list of problems so a cleanup failure can be
 * reported without swallowing a real test failure.
 */
const cleanupAll = async (
  request: APIRequestContext,
  s: Session,
  ids: string[],
  stamp: number,
): Promise<string[]> => {
  const problems: string[] = [];
  try {
    for (const id of ids) {
      const p = await restDelete(request, s, id);
      if (p) problems.push(p);
    }
    const left = await restSelect(
      request,
      s,
      `focusos_projects?select=id,name&name=like.*${encodeURIComponent(String(stamp))}*`,
    );
    if (left.length) problems.push(`projects left behind: ${left.map((p: any) => p.name).join(', ')}`);
  } catch (e) {
    problems.push(`cleanup threw: ${(e as Error).message}`);
  }
  return problems;
};

test.describe('projects: drag and drop moves in the drawer', () => {
  test('drag to nest, drag to top level, the one-level refusal, and the writes that must NOT happen', async ({ page, request }) => {
    test.setTimeout(240_000);

    const s = await restSignIn(request);
    const stamp = Date.now();
    const nameA = `Drag A ${stamp}`;
    const nameB = `Drag B ${stamp}`;
    const nameC = `Drag C ${stamp}`;
    // Ids live OUT here so the finally-style cleanup below can see them even if
    // the journey throws half way through.
    let aId = '';
    let bId = '';
    let cId = '';
    const countBefore = await projectCount(request, s);

    // Every PATCH the app fires at focusos_projects, so a "nothing was written"
    // claim is proven by the absence of the request, not by a stale read.
    const projectPatches: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes('/rest/v1/focusos_projects')) {
        projectPatches.push(req.url());
      }
    });

    let bodyError: Error | null = null;
    try {
      await signIn(page);
      await page.goto(`${BASE}/app`);
      await openDrawer(page);

      aId = await createProject(page, nameA);
      bId = await createProject(page, nameB);
      cId = await createProject(page, nameC);

      const rowA = page.getByTestId(`select-project-${aId}`);
      const rowB = page.getByTestId(`select-project-${bId}`);
      const rowC = page.getByTestId(`select-project-${cId}`);
      const header = page.getByTestId('projects-drop-top');

      await expect(header).toBeVisible({ timeout: 20000 });
      expect(await parentOf(request, s, aId), 'A starts top level').toBeNull();

      // ---- (1) drag A onto B: A becomes a sub of B ---------------------------
      await test.step('(1) dropping A on B nests A under B', async () => {
        await dragRowTo(page, rowA, rowB);
        await expect(
          page.locator(`[data-testid="tree-subs-${bId}"] [data-testid="tree-sub-${aId}"]`),
          'A must render as a sub inside B',
        ).toBeVisible({ timeout: 20000 });
        expect(await parentOf(request, s, aId), 'the database must agree A now sits under B').toBe(bId);
      });

      // ---- (5) drop A back on its CURRENT parent: silent, no write -----------
      await test.step('(5) dropping a sub on its own current parent writes nothing', async () => {
        projectPatches.length = 0;
        await dragRowTo(page, rowA, rowB);
        await page.waitForTimeout(1000);
        expect(projectPatches, 'a no-op drop must not PATCH focusos_projects').toEqual([]);
        expect(await parentOf(request, s, aId), 'A must still sit under B').toBe(bId);
      });

      // ---- (2) drag A onto the "My Projects" heading: back to top level ------
      await test.step('(2) dropping A on the My Projects heading returns it to top level', async () => {
        await dragRowTo(page, rowA, header);
        await expect(page.getByTestId(`tree-sub-${aId}`), 'A must no longer be a sub row').toHaveCount(0, {
          timeout: 20000,
        });
        await expect(rowA, 'A must still be in the list').toBeVisible();
        await expect(
          page.locator(`[data-testid^="tree-subs-"] [data-testid="select-project-${aId}"]`),
          'A must not sit inside any parent sub-list',
        ).toHaveCount(0);
        expect(await parentOf(request, s, aId), 'the database must agree A is top level again').toBeNull();
      });

      // ---- (3) one-level rule: a project with subs cannot become a sub -------
      await test.step('(3) a project that has sub-projects refuses to be nested, and writes nothing', async () => {
        await dragRowTo(page, rowC, rowA);
        await expect(
          page.locator(`[data-testid="tree-subs-${aId}"] [data-testid="tree-sub-${cId}"]`),
          'C must render as a sub inside A',
        ).toBeVisible({ timeout: 20000 });
        expect(await parentOf(request, s, cId), 'C now sits under A').toBe(aId);

        projectPatches.length = 0;
        await dragRowTo(page, rowA, rowB);
        await expect(page.getByText('Move its sub-projects first')).toBeVisible({ timeout: 8000 });
        expect(projectPatches, 'a refused move must not PATCH focusos_projects').toEqual([]);
        await expect(page.getByTestId(`tree-sub-${aId}`), 'A must not have been nested').toHaveCount(0);
        expect(await parentOf(request, s, aId), 'A must still be top level').toBeNull();
        expect(await parentOf(request, s, cId), 'C must still sit under A').toBe(aId);
      });

      // ---- (4) a plain click still selects; a drop in nowhere writes nothing --
      await test.step('(4) a plain click still selects the project', async () => {
        await rowB.click();
        await expect(
          page.locator('.lg-projbar [data-projects-tour-step="project-name"]'),
          'clicking a row must still open that project',
        ).toHaveText(nameB, { timeout: 20000 });
      });

      await test.step('(4) a drag released outside every drop target writes nothing', async () => {
        projectPatches.length = 0;
        await rowB.scrollIntoViewIfNeeded();
        const box = await rowB.boundingBox();
        expect(box, 'B must have a box').toBeTruthy();
        // x 900 is the task pane, far outside the 280px sidebar: no droppable there.
        await dragFromTo(page, box!.x + box!.width / 2, box!.y + box!.height / 2, 900, 420);
        await page.waitForTimeout(1000);
        expect(projectPatches, 'a drop in empty space must not PATCH focusos_projects').toEqual([]);
        expect(await parentOf(request, s, bId), 'B must still be top level').toBeNull();
        expect(await parentOf(request, s, aId), 'A must still be top level').toBeNull();
        expect(await parentOf(request, s, cId), 'C must still sit under A').toBe(aId);
      });
    } catch (e) {
      bodyError = e as Error;
    }

    // C is the only row that can still be a sub, so C -> A -> B is already
    // subs-before-parents (the parent FK is ON DELETE SET NULL: a parent removed
    // first would orphan its sub into a top-level row on the demo account).
    const leaks = await cleanupAll(request, s, [cId, aId, bId].filter(Boolean), stamp);
    const countAfter = await projectCount(request, s);
    if (bodyError) {
      if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
      throw bodyError;
    }
    expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
    expect(countAfter, 'the demo account must end with the project count it started with').toBe(countBefore);
  });
});
