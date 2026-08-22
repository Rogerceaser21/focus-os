// Sub-project ROLL-UPS (P4) — end-to-end against the real demo account and the
// real Supabase backend (no mocking), same shape as tests/project-tree.spec.ts:
// DEMO_EMAIL/DEMO_PASSWORD + the /auth sign-in steps, BASE from WAVE_BASE_URL,
// timestamped names, and cleanup that DELETES everything the test created and
// ASSERTS the deletes landed, so a leak fails the run loudly.
//
// Covers the three things P4 promises:
//   1. a parent's project view carries its active subs' tasks, each labelled
//      with the sub it lives in, while a sub's own view is unchanged;
//   2. the time report counts a parent as itself + its subs, with the sub's own
//      subtotal nested inside the parent's group (and no top-level sub group);
//   3. the Gantt groups a sub's bars under a collapsible roll-up row whose
//      collapsed state survives a reload, and leaves a sub's own view flat.
//
// Rows the UI cannot create (timer totals, start/end dates without opening three
// date pickers) are written straight through the PostgREST API with the demo
// account's own session — the same rows the app would have written.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/project-rollups.spec.ts
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account tests/project-tree.spec.ts signs in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// The drawer is a permanently-mounted plain-div portal exposed as
// role="dialog" aria-label="Projects" with a data-state attribute — check the
// state before toggling, never blind-click it (see tests/project-archive.spec.ts).
const drawer = (page: Page) => page.getByLabel('Projects');

const openDrawer = async (page: Page) => {
  const state = await drawer(page).getAttribute('data-state').catch(() => null);
  if (state === 'open') return;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer(page)).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

// Switch the main view (List / Gantt / Time) through the mobile one-bar's
// context sheet — the viewport this suite runs at (390px) has no desktop seg.
const selectView = async (page: Page, view: 'list' | 'grid' | 'gantt' | 'time-tracking') => {
  await page.getByTestId('onebar-title').click();
  await expect(page.getByTestId('onebar-context-sheet')).toBeVisible({ timeout: 5000 });
  await page.getByTestId(`onebar-view-${view}`).click();
  await expect(page.getByTestId('onebar-context-sheet')).toHaveCount(0, { timeout: 5000 });
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

const restInsert = async (
  request: APIRequestContext,
  s: Session,
  table: 'focusos_projects' | 'focusos_tasks',
  row: Record<string, unknown>,
): Promise<string> => {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: restHeaders(s, { Prefer: 'return=representation' }),
    data: row,
  });
  expect(res.ok(), `insert into ${table} must succeed (${res.status()})`).toBeTruthy();
  const rows = await res.json();
  expect(rows.length, `insert into ${table} must return the new row`).toBe(1);
  return rows[0].id as string;
};

const restSelect = async (
  request: APIRequestContext,
  s: Session,
  path: string,
): Promise<any[]> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(s) });
  expect(res.ok(), `select ${path} must succeed (${res.status()})`).toBeTruthy();
  return res.json();
};

// Delete one row and PROVE it went: `return=representation` echoes the deleted
// rows, so an id that was already gone (or that RLS refused) comes back empty
// and is reported as a leak instead of passing silently.
const restDelete = async (
  request: APIRequestContext,
  s: Session,
  table: 'focusos_projects' | 'focusos_tasks',
  id: string,
): Promise<string | null> => {
  const res = await request.delete(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    headers: restHeaders(s, { Prefer: 'return=representation' }),
  });
  if (!res.ok()) return `${table} ${id}: HTTP ${res.status()}`;
  const rows = await res.json();
  if (rows.length !== 1) return `${table} ${id}: delete removed ${rows.length} rows`;
  return null;
};

/**
 * Delete everything the test created — TASKS first (a project delete would
 * leave its tasks behind), then SUBS, then PARENTS (the parent FK is ON DELETE
 * SET NULL, so a parent removed first would orphan its subs into top-level rows
 * on the demo account). Never throws: it returns a list of problems, so a
 * cleanup failure can be reported without swallowing a real test failure. The
 * final stamp sweep catches anything the id list did not know about.
 */
const cleanupAll = async (
  request: APIRequestContext,
  s: Session,
  ids: { taskIds: string[]; subIds: string[]; parentIds: string[]; stamp: number },
): Promise<string[]> => {
  const problems: string[] = [];
  try {
    for (const id of ids.taskIds) {
      const p = await restDelete(request, s, 'focusos_tasks', id);
      if (p) problems.push(p);
    }
    for (const id of [...ids.subIds, ...ids.parentIds]) {
      const p = await restDelete(request, s, 'focusos_projects', id);
      if (p) problems.push(p);
    }
    // Read-back sweep on the stamp: nothing this run created may survive.
    const stamp = String(ids.stamp);
    const projLeft = await restSelect(request, s, `focusos_projects?select=id,name&name=like.*${encodeURIComponent(stamp)}*`);
    const taskLeft = await restSelect(request, s, `focusos_tasks?select=id,title&title=like.*${encodeURIComponent(stamp)}*`);
    if (projLeft.length) problems.push(`projects left behind: ${projLeft.map((p: any) => p.name).join(', ')}`);
    if (taskLeft.length) problems.push(`tasks left behind: ${taskLeft.map((t: any) => t.title).join(', ')}`);
  } catch (e) {
    problems.push(`cleanup threw: ${(e as Error).message}`);
  }
  return problems;
};

// Run the body, then always clean up. A body failure wins the report (with any
// leak appended to it); a clean body with a dirty account still fails.
const withCleanup = async (
  request: APIRequestContext,
  s: Session,
  ids: { taskIds: string[]; subIds: string[]; parentIds: string[]; stamp: number },
  body: () => Promise<void>,
) => {
  let bodyError: Error | null = null;
  try {
    await body();
  } catch (e) {
    bodyError = e as Error;
  }
  const leaks = await cleanupAll(request, s, ids);
  if (bodyError) {
    if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
    throw bodyError;
  }
  expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
};

test.describe('sub-projects: parent roll-ups in the list, the time report and the Gantt', () => {
  test('parent view aggregates its subs (labelled per sub), a sub view does not, and new tasks still land in the selected project', async ({ page, request }) => {
    test.setTimeout(150_000);

    const s = await restSignIn(request);
    const stamp = Date.now();
    const parentName = `Rollup Parent ${stamp}`;
    const subName = `Rollup Sub ${stamp}`;
    const parentTaskTitle = `Rollup own task ${stamp}`;
    const subTaskTitle = `Rollup sub task ${stamp}`;
    const uiTaskTitle = `Rollup ui task ${stamp}`;
    const ids = { taskIds: [] as string[], subIds: [] as string[], parentIds: [] as string[], stamp };

    await withCleanup(request, s, ids, async () => {
      const parentId = await restInsert(request, s, 'focusos_projects', { name: parentName, color: '#8b5cf6', user_id: s.userId });
      ids.parentIds.push(parentId);
      const subId = await restInsert(request, s, 'focusos_projects', { name: subName, color: '#22c55e', user_id: s.userId, parent_project_id: parentId });
      ids.subIds.push(subId);

      ids.taskIds.push(await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: parentId, title: parentTaskTitle, status: 'todo', priority: 'medium',
      }));
      ids.taskIds.push(await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: subId, title: subTaskTitle, status: 'todo', priority: 'medium',
      }));

      await signIn(page);

      // ---- The PARENT's view carries both tasks ------------------------------
      await page.goto(`${BASE}/app?view=${parentId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(parentName, { timeout: 20000 });
      await expect(page.locator('#root').getByText(parentTaskTitle).first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root').getByText(subTaskTitle).first()).toBeVisible({ timeout: 15000 });

      // ...and ONLY the sub's task is captioned with the sub it lives in. The
      // pair (one labelled, one not) is what makes this non-vacuous: a component
      // that labelled everything, or nothing, fails here.
      // `:visible` because TaskListItem ships a mobile AND a desktop layout, one
      // of which is CSS-hidden at every viewport.
      const subLabels = page.locator('[data-testid="task-sub-label"]:visible');
      await expect(subLabels).toHaveCount(1, { timeout: 15000 });
      await expect(subLabels.first()).toHaveText(subName);

      // ---- The SUB's own view is unchanged: its task, no caption -------------
      await page.goto(`${BASE}/app?view=${subId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(subName, { timeout: 20000 });
      await expect(page.locator('#root').getByText(subTaskTitle).first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root').getByText(parentTaskTitle)).toHaveCount(0);
      await expect(page.getByTestId('task-sub-label')).toHaveCount(0);

      // ---- Creating a task in the PARENT's view still creates it in the PARENT
      // (the roll-up widens what is SHOWN, never where new work is filed).
      await page.goto(`${BASE}/app?view=${parentId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(parentName, { timeout: 20000 });
      await page.getByTestId('onebar-add').click();
      const addDialog = page.getByRole('dialog', { name: 'Create New Task' });
      await addDialog.locator('#title').fill(uiTaskTitle);
      await addDialog.getByRole('button', { name: 'Create Task' }).click();
      await expect(addDialog).toHaveCount(0);
      await expect(page.locator('#root').getByText(uiTaskTitle).first()).toBeVisible({ timeout: 15000 });

      const created = await restSelect(request, s, `focusos_tasks?select=id,project_id&title=eq.${encodeURIComponent(uiTaskTitle)}`);
      expect(created.length, 'the UI-created task must exist in the database').toBe(1);
      ids.taskIds.push(created[0].id);
      expect(created[0].project_id, 'a task added from the parent view belongs to the PARENT').toBe(parentId);
    });
  });

  test('time report: a parent totals itself plus its subs, with the sub nested as a subgroup and never a top-level group', async ({ page, request }) => {
    test.setTimeout(150_000);

    const s = await restSignIn(request);
    const stamp = Date.now();
    const parentName = `Rollup Parent ${stamp}`;
    const subName = `Rollup Sub ${stamp}`;
    const ids = { taskIds: [] as string[], subIds: [] as string[], parentIds: [] as string[], stamp };
    const dueToday = new Date().toISOString();

    await withCleanup(request, s, ids, async () => {
      const parentId = await restInsert(request, s, 'focusos_projects', { name: parentName, color: '#8b5cf6', user_id: s.userId });
      ids.parentIds.push(parentId);
      const subId = await restInsert(request, s, 'focusos_projects', { name: subName, color: '#22c55e', user_id: s.userId, parent_project_id: parentId });
      ids.subIds.push(subId);

      // 120s on the parent's own task + 60s on the sub's task = 3m 0s rolled up.
      // Both due TODAY so the same pair is visible on the Today list further down.
      ids.taskIds.push(await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: parentId, title: `Rollup own task ${stamp}`,
        status: 'todo', priority: 'medium', timer_total_seconds: 120, due_date: dueToday,
      }));
      ids.taskIds.push(await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: subId, title: `Rollup sub task ${stamp}`,
        status: 'todo', priority: 'medium', timer_total_seconds: 60, due_date: dueToday,
      }));

      await signIn(page);

      // ---- In the PARENT's own view ------------------------------------------
      await page.goto(`${BASE}/app?view=${parentId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(parentName, { timeout: 20000 });
      await selectView(page, 'time-tracking');

      await expect(page.getByTestId('time-tracking-chart')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`time-group-total-${parentId}`)).toHaveText('3m 0s', { timeout: 15000 });
      await expect(page.getByTestId(`time-subgroup-${subId}`)).toBeVisible();
      await expect(page.getByTestId(`time-subgroup-total-${subId}`)).toHaveText('1m 0s');
      // The sub is INSIDE the parent's group, never a group of its own.
      await expect(page.getByTestId(`time-group-total-${subId}`)).toHaveCount(0);

      // ---- And on a list that is not project-scoped at all (Today) ------------
      // Same roll-up, proving it lives in the chart's own grouping rather than in
      // the project filter: the sub's minute still lands under the parent.
      await openDrawer(page);
      await drawer(page).getByRole('button', { name: 'Today', exact: true }).click();
      await expect(page.getByTestId('onebar-title')).toContainText('Today', { timeout: 15000 });
      await expect(page.getByTestId('time-tracking-chart')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`time-group-total-${parentId}`)).toHaveText('3m 0s', { timeout: 15000 });
      await expect(page.getByTestId(`time-subgroup-total-${subId}`)).toHaveText('1m 0s');
      await expect(page.getByTestId(`time-group-total-${subId}`)).toHaveCount(0);
    });
  });

  test('gantt: a sub gets a collapsible group with a roll-up bar, the collapse survives a reload, and a sub view stays flat', async ({ page, request }) => {
    test.setTimeout(180_000);

    const s = await restSignIn(request);
    const stamp = Date.now();
    const parentName = `Rollup Parent ${stamp}`;
    const subName = `Rollup Sub ${stamp}`;
    const ids = { taskIds: [] as string[], subIds: [] as string[], parentIds: [] as string[], stamp };
    // Start = End = today, which is what makes a task a real Gantt BAR
    // (GanttChart only bars tasks that carry both dates).
    const todayIso = new Date().toISOString();

    await withCleanup(request, s, ids, async () => {
      const parentId = await restInsert(request, s, 'focusos_projects', { name: parentName, color: '#8b5cf6', user_id: s.userId });
      ids.parentIds.push(parentId);
      const subId = await restInsert(request, s, 'focusos_projects', { name: subName, color: '#22c55e', user_id: s.userId, parent_project_id: parentId });
      ids.subIds.push(subId);

      const ownTaskId = await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: parentId, title: `Rollup own task ${stamp}`,
        status: 'todo', priority: 'medium', start_date: todayIso, end_date: todayIso,
      });
      ids.taskIds.push(ownTaskId);
      const subTaskId = await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: subId, title: `Rollup sub task ${stamp}`,
        status: 'todo', priority: 'medium', start_date: todayIso, end_date: todayIso,
      });
      ids.taskIds.push(subTaskId);

      await signIn(page);

      await page.goto(`${BASE}/app?view=${parentId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(parentName, { timeout: 20000 });
      await selectView(page, 'gantt');

      // ---- The parent's own bar is ungrouped; the sub's bars are grouped ------
      await expect(page.getByTestId(`gantt-task-${ownTaskId}`)).toBeVisible({ timeout: 15000 });
      const groupHeaders = page.locator('[data-testid^="gantt-group-"]');
      await expect(groupHeaders).toHaveCount(1);
      await expect(page.getByTestId(`gantt-group-${subId}`)).toBeVisible();
      await expect(page.getByTestId(`gantt-rollup-${subId}`)).toBeVisible();
      await expect(page.getByTestId(`gantt-task-${subTaskId}`)).toBeVisible();

      const toggle = page.getByTestId(`gantt-toggle-${subId}`);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');

      // ---- Collapse: the sub's task rows go, the roll-up bar stays ------------
      await toggle.click();
      await expect(page.getByTestId(`gantt-task-${subTaskId}`)).toHaveCount(0, { timeout: 5000 });
      await expect(page.getByTestId(`gantt-rollup-${subId}`)).toBeVisible();
      await expect(page.getByTestId(`gantt-task-${ownTaskId}`)).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // ---- ...and it survives a reload (persisted, read during render) --------
      await page.reload();
      await expect(page.getByTestId('onebar-title')).toContainText(parentName, { timeout: 20000 });
      await selectView(page, 'gantt');
      await expect(page.getByTestId(`gantt-rollup-${subId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`gantt-toggle-${subId}`)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId(`gantt-task-${subTaskId}`)).toHaveCount(0);

      // ---- Expanding brings the rows back ------------------------------------
      await page.getByTestId(`gantt-toggle-${subId}`).click();
      await expect(page.getByTestId(`gantt-task-${subTaskId}`)).toBeVisible({ timeout: 5000 });

      // ---- The SUB's own Gantt is flat: no group rows at all ------------------
      await page.goto(`${BASE}/app?view=${subId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(subName, { timeout: 20000 });
      await selectView(page, 'gantt');
      await expect(page.getByTestId(`gantt-task-${subTaskId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid^="gantt-group-"]')).toHaveCount(0);
      await expect(page.getByTestId(`gantt-task-${ownTaskId}`)).toHaveCount(0);
    });
  });
});
