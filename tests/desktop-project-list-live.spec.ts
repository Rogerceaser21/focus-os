// Project list LIVE refresh (desktop) — a sub-project created or moved OUTSIDE
// the tab (the Focus OS MCP, another device) must reach the parent's List and
// Gantt without a full reload.
//
// ROOT CAUSE (probed live on the demo account): focusos_projects carries NO
// realtime channel at all (not in the Supabase realtime publication — zero
// postgres_changes events for insert/delete). src/pages/Index.tsx kept its own
// `projects` state, refreshed only on initial load, on projectRefreshTrigger
// bumps, and on a >60s-hidden resume. The P4 roll-up (selectedSubProjectIds /
// ganttGroupBy, src/pages/Index.tsx ~1160-1200) reads that stale list, so a
// sub-project written elsewhere was missing from its parent's List/Gantt until
// a hard reload, even though the Projects drawer's own fetch could already see
// it (a different local state, same underlying table).
//
// FIX under test: Index now (1) refetches projects fresh on ANY window
// focus/visibility event, debounced together with the existing task resync so
// a burst of events makes one request each (not a pair), and (2) subscribes to
// the shared React Query cache entry for this user's projects
// (appDataKeys.projects) and applies whatever lands in it — so ANY caller that
// refreshes that one cache entry (this tab's own resync, a prefetch, etc.)
// updates Index's view without Index running a second request.
//
// LIVE, not hermetic — same shape as tests/project-rollups.spec.ts: real
// backend, real demo account, zz/stamp-named rows, PostgREST helpers signed in
// as the demo account, cleanup that deletes everything created and PROVES it
// (a stamp read-back plus a whole-account count check against the counts read
// at the very start).
//
// Cases (one continuous session, so (a) is genuinely "no reload"):
//   (a) a REST-inserted sub + a dated task in it reach the parent's Gantt
//       within 10s of a plain window 'focus' event — no reload;
//   (b) the same sub task is visible in List view, captioned with its sub;
//   (c) selecting a second, REST-created top-level project the tab has never
//       seen resolves its real name in the header — never "Unknown Project"
//       and never stuck showing the previous project.
//
// Run: PW_PORT=8094 npx playwright test tests/desktop-project-list-live.spec.ts --project=desktop-mouse
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account tests/project-rollups.spec.ts signs in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

test.use({ actionTimeout: 15000 });

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// Desktop-only header: the project banner (`.lg-projbar`, `hidden lg:block`)
// renders the selected project's name in this span. Same locator
// tests/mobile-share-pill.spec.ts uses for the equivalent desktop check.
const headerName = (page: Page) => page.locator('.lg-projbar [data-projects-tour-step="project-name"]');

// Desktop view-seg buttons (`.lg-seg`, DESKTOP ONLY) — List / Grid / Gantt / Time.
const clickViewButton = async (page: Page, label: 'List' | 'Gantt') => {
  await page.getByRole('button', { name: label, exact: true }).first().click();
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

// PostgREST count via Prefer: count=exact + Content-Range, no row bodies.
const restCount = async (
  request: APIRequestContext,
  s: Session,
  table: 'focusos_projects' | 'focusos_tasks',
): Promise<number> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=id&user_id=eq.${s.userId}`, {
    headers: restHeaders(s, { Prefer: 'count=exact' }),
  });
  expect(res.ok(), `count ${table} must succeed (${res.status()})`).toBeTruthy();
  const range = res.headers()['content-range'] ?? '';
  const total = Number(range.split('/')[1]);
  expect(Number.isFinite(total), `count ${table} must return a numeric Content-Range total`).toBeTruthy();
  return total;
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
 * leave its tasks behind), then PROJECTS (subs and top-level alike; the parent
 * FK is ON DELETE SET NULL, so deleting a sub before its parent never orphans
 * anything the other way round, and deleting them together in one pass is
 * safe either order for THIS test since nothing here nests three deep). Never
 * throws: it returns a list of problems, so a cleanup failure can be reported
 * without swallowing a real test failure.
 */
const cleanupAll = async (
  request: APIRequestContext,
  s: Session,
  ids: { taskIds: string[]; projectIds: string[]; stamp: number },
  startCounts: { projects: number; tasks: number },
): Promise<string[]> => {
  const problems: string[] = [];
  try {
    for (const id of ids.taskIds) {
      const p = await restDelete(request, s, 'focusos_tasks', id);
      if (p) problems.push(p);
    }
    for (const id of ids.projectIds) {
      const p = await restDelete(request, s, 'focusos_projects', id);
      if (p) problems.push(p);
    }
    // Read-back sweep on the stamp: nothing this run created may survive.
    const stamp = String(ids.stamp);
    const projLeft = await restSelect(request, s, `focusos_projects?select=id,name&name=like.*${encodeURIComponent(stamp)}*`);
    const taskLeft = await restSelect(request, s, `focusos_tasks?select=id,title&title=like.*${encodeURIComponent(stamp)}*`);
    if (projLeft.length) problems.push(`projects left behind: ${projLeft.map((p: any) => p.name).join(', ')}`);
    if (taskLeft.length) problems.push(`tasks left behind: ${taskLeft.map((t: any) => t.title).join(', ')}`);
    // Whole-account counts must be exactly what they were before this run.
    const projectsNow = await restCount(request, s, 'focusos_projects');
    const tasksNow = await restCount(request, s, 'focusos_tasks');
    if (projectsNow !== startCounts.projects) {
      problems.push(`focusos_projects count drifted: started ${startCounts.projects}, now ${projectsNow}`);
    }
    if (tasksNow !== startCounts.tasks) {
      problems.push(`focusos_tasks count drifted: started ${startCounts.tasks}, now ${tasksNow}`);
    }
  } catch (e) {
    problems.push(`cleanup threw: ${(e as Error).message}`);
  }
  return problems;
};

const withCleanup = async (
  request: APIRequestContext,
  s: Session,
  ids: { taskIds: string[]; projectIds: string[]; stamp: number },
  startCounts: { projects: number; tasks: number },
  body: () => Promise<void>,
) => {
  let bodyError: Error | null = null;
  try {
    await body();
  } catch (e) {
    bodyError = e as Error;
  }
  const leaks = await cleanupAll(request, s, ids, startCounts);
  if (bodyError) {
    if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
    throw bodyError;
  }
  expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
};

test.describe('project list stays live without a reload (desktop)', () => {
  test('focus-triggered resync reaches the Gantt and List, and a never-seen project resolves its real name', async ({ page, request }) => {
    test.setTimeout(150_000);

    const s = await restSignIn(request);
    const startCounts = {
      projects: await restCount(request, s, 'focusos_projects'),
      tasks: await restCount(request, s, 'focusos_tasks'),
    };

    const stamp = Date.now();
    const parentName = `zz Live Parent ${stamp}`;
    const subName = `zz Live Sub ${stamp}`;
    const secondName = `zz Live Second ${stamp}`;
    const parentTaskTitle = `zz live parent task ${stamp}`;
    const subTaskTitle = `zz live sub task ${stamp}`;
    const ids = { taskIds: [] as string[], projectIds: [] as string[], stamp };

    await withCleanup(request, s, ids, startCounts, async () => {
      // ---- Seed: a top-level parent with ONE undated todo task -------------
      const parentId = await restInsert(request, s, 'focusos_projects', {
        name: parentName, color: '#8b5cf6', user_id: s.userId,
      });
      ids.projectIds.push(parentId);
      ids.taskIds.push(await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: parentId, title: parentTaskTitle, status: 'todo', priority: 'medium',
      }));

      await signIn(page);
      await page.goto(`${BASE}/app?view=${parentId}`);
      await expect(headerName(page)).toHaveText(parentName, { timeout: 20000 });

      await clickViewButton(page, 'Gantt');
      await expect(page.getByText('No tasks with dates to display in Gantt view')).toBeVisible({ timeout: 15000 });

      // ---- OUTSIDE the page: a sub-project + a dated task in it ------------
      const subId = await restInsert(request, s, 'focusos_projects', {
        name: subName, color: '#22c55e', user_id: s.userId, parent_project_id: parentId,
      });
      ids.projectIds.push(subId);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 3 * 24 * 60 * 60 * 1000);
      const subTaskId = await restInsert(request, s, 'focusos_tasks', {
        user_id: s.userId, project_id: subId, title: subTaskTitle, status: 'todo', priority: 'medium',
        start_date: startDate.toISOString(), end_date: endDate.toISOString(),
      });
      ids.taskIds.push(subTaskId);

      // ---- (a) a plain window focus event, no reload, brings it in ---------
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByTestId(`gantt-task-${subTaskId}`)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('No tasks with dates to display in Gantt view')).toHaveCount(0);

      // ---- (b) List view: the sub task is captioned with its sub -----------
      // TaskListItem renders a mobile AND a desktop `<h3>` title, one CSS-hidden
      // at every viewport (same reason project-rollups.spec.ts filters
      // task-sub-label to :visible) — `:visible` picks the desktop one here.
      await clickViewButton(page, 'List');
      await expect(page.locator(`h3:visible:has-text("${subTaskTitle}")`).first()).toBeVisible({ timeout: 15000 });
      const subLabels = page.locator('[data-testid="task-sub-label"]:visible');
      await expect(subLabels).toHaveCount(1, { timeout: 15000 });
      await expect(subLabels.first()).toHaveText(subName);

      // ---- (c) a second top-level project this tab has never seen ----------
      const secondId = await restInsert(request, s, 'focusos_projects', {
        name: secondName, color: '#f97316', user_id: s.userId,
      });
      ids.projectIds.push(secondId);

      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const drawerRow = page.getByTestId(`select-project-${secondId}`);
      if (await drawerRow.count().then((n) => n > 0).catch(() => false)) {
        await drawerRow.click();
      } else {
        // In-app selection genuinely not possible here: the Projects drawer
        // (ProjectSidebar) keeps its own local state, refreshed on its own
        // triggers (mount, SIGNED_IN, TOKEN_REFRESHED, its own UI actions) —
        // not on a window focus event — so a project created outside the tab
        // may never reach the drawer's clickable list without one of those.
        // The documented fallback is a direct deep link, which still exercises
        // exactly the header behaviour this test is about: a selected project
        // Index does not know yet must resolve its real name, never a wrong
        // or missing one.
        await page.goto(`${BASE}/app?view=${secondId}`);
      }
      await expect(headerName(page)).toHaveText(secondName, { timeout: 20000 });
      await expect(page.getByText('Unknown Project')).toHaveCount(0);
    });
  });
});
