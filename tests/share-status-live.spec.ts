// SHARE STATUS LIVE-REFRESH (O2, 2026-08-23) — end-to-end against the real demo
// account and the real Supabase backend (no REST mocking except the two share
// paths below), same shape as tests/project-rollups.spec.ts and
// tests/projectbar-widths.spec.ts: DEMO_EMAIL/DEMO_PASSWORD + the /auth
// sign-in steps, BASE from WAVE_BASE_URL, timestamped names, try/finally
// cleanup with asserted deletes and a stamp-based leak sweep, plus a raw
// project/task count check before and after.
//
// What this proves: after Igor shares a task from the Edit Task sheet, or a
// project from the project bar, the purple "Shared with ..." pill appears on
// its own — no full-page reload needed. Before this fix, EditTaskDialog's
// `onShared` only ever called an unwired `onAssigned` prop, and the project
// ShareItemDialog had no `onShared` at all, so both pills stayed stale until
// the next reload.
//
// Only two network paths are faked, and ONLY on this test's own browser
// context: the focusos-share-item edge function (so no email ever sends and
// no real focusos_shared_items row is written) and the GET reads of
// focusos_shared_items (so the UI sees the fake share immediately instead of
// racing the real backend). Every other REST call — sign-in, task/project
// reads and writes, contacts — hits the real Supabase project untouched.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/share-status-live.spec.ts
import { test, expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account the other project specs sign in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

// ---- UI sign-in + project selection ---------------------------------------

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// The mobile drawer is a plain, permanently-mounted portal at document.body
// (never conditionally mounted — the white-flash law in
// src/components/ProjectSidebar.tsx — so open/close is CSS transform only,
// never display/visibility). It mounts a beat after navigation (behind the
// initial data load), and on "host" pages it also picks up aria-hidden while
// closed — so a getByLabel/getByRole probe taken immediately after goto() can
// see neither the dialog nor its aria-label yet, and getByLabel would in any
// case be excluded once aria-hidden lands. A plain CSS attribute locator
// side-steps both: it sees the node the instant it attaches, regardless of
// its accessible-name visibility. On desktop the sidebar renders inline
// instead and this node never appears at all.
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

// Select a project row so the bar renders (desktop) or the drawer closes into
// the project's task list (mobile). Idempotent. Copied from
// tests/projectbar-widths.spec.ts.
const selectProject = async (page: Page, id: string, name: string) => {
  await openDrawer(page);
  const nameSpan = page.locator('.lg-projbar [data-projects-tour-step="project-name"]');
  const alreadyThere = await nameSpan
    .first()
    .textContent({ timeout: 2000 })
    .then((t) => t === name)
    .catch(() => false);
  if (alreadyThere) return;

  const row = page.getByTestId(`select-project-${id}`);
  if ((await row.count()) > 0) {
    // The drawer's project list is its own nested scroll container — the
    // click action's built-in auto-scroll doesn't reliably reach a row deep
    // inside it (mobile), so scroll explicitly first.
    await row.scrollIntoViewIfNeeded();
    await row.click();
  } else {
    await page.goto(`${BASE}/app?view=${id}`);
  }
  await expect(nameSpan).toHaveText(name, { timeout: 15000 });
};

// ---- PostgREST helpers, signed in as the demo account ----------------------

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

const restSelect = async (request: APIRequestContext, s: Session, path: string): Promise<any[]> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(s) });
  expect(res.ok(), `select ${path} must succeed (${res.status()})`).toBeTruthy();
  return res.json();
};

// Delete one row and PROVE it went: return=representation echoes the deleted
// row, so an id that was already gone (or that RLS refused) is reported as a
// leak instead of passing silently.
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

// Total row count for this account via PostgREST's exact count (Content-Range
// header), independent of the leak sweep below — the task's own acceptance
// bar ("counts unchanged before/after").
const restCount = async (
  request: APIRequestContext,
  s: Session,
  table: 'focusos_projects' | 'focusos_tasks',
): Promise<number> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
    headers: restHeaders(s, { Prefer: 'count=exact' }),
  });
  expect(res.ok(), `count ${table} must succeed (${res.status()})`).toBeTruthy();
  const range = res.headers()['content-range'] || '';
  const total = Number(range.split('/')[1]);
  expect(Number.isFinite(total), `content-range must report a total for ${table} (got "${range}")`).toBe(true);
  return total;
};

// ---- The two intercepted network paths --------------------------------------
//
// focusos-share-item (the edge function ShareItemDialog invokes): fulfilled
// with the same {success:true} shape the real function returns on its happy
// path (supabase/functions/focusos-share-item/index.ts line ~420) — handleSend
// only checks that `error` is falsy, so this is enough to mark the send a
// success without ever reaching Resend or writing a real row.
//
// focusos_shared_items GETs: every consumer in the app reads this table (the
// sender maps in Index.tsx, the received-items list in ProjectSidebar.tsx,
// ShareItemDialog's own contacts fetch) with different filters, but PostgREST
// filtering happens server-side — since this route never reaches the server,
// it always returns the SAME accumulated fake-row list regardless of query
// params. Each successful fake share appends one row (built from the edge
// function's own request body), so the "flag" is really an accumulator: empty
// before any share, growing by one row per share.
interface FakeSharedRow {
  id: string;
  item_id: string;
  item_type: string;
  recipient_email: string;
  recipient_user_id: null;
  recipient_task_id: null;
  status: string;
  sender_user_id: string;
  sender_email: null;
  created_at: string;
  sender_acknowledged: boolean;
  completion_acknowledged: boolean;
}

interface ShareIntercept {
  rows: FakeSharedRow[];
  /** Number of times the focusos_shared_items GET route has fired. */
  getHits: number;
}

const installShareIntercepts = async (
  context: BrowserContext,
  s: Session,
): Promise<ShareIntercept> => {
  const state: ShareIntercept = { rows: [], getHits: 0 };
  let fakeIdCounter = 0;

  await context.route('**/functions/v1/focusos-share-item', async (route) => {
    const body = route.request().postDataJSON() as
      | { itemType?: string; itemId?: string; recipientEmail?: string }
      | null;
    if (body && body.itemType && body.itemId && body.recipientEmail) {
      fakeIdCounter += 1;
      state.rows.push({
        id: `o2-fake-shared-row-${fakeIdCounter}`,
        item_id: body.itemId,
        item_type: body.itemType,
        recipient_email: body.recipientEmail,
        recipient_user_id: null,
        recipient_task_id: null,
        status: 'pending',
        sender_user_id: s.userId,
        sender_email: null,
        created_at: new Date().toISOString(),
        sender_acknowledged: false,
        completion_acknowledged: false,
      });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await context.route('**/rest/v1/focusos_shared_items*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    state.getHits += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.rows),
    });
  });

  return state;
};

// ---- Task-card + share-pill locators ----------------------------------------

// Both the desktop and mobile TaskListItem markup branches are always in the
// DOM at once (only one is CSS-visible per viewport, per tests/paneflow.spec.ts) —
// scope to :visible so a stale hidden branch never satisfies an assertion.
const taskCard = (page: Page, title: string) =>
  page.locator('[data-task-card]:visible').filter({ hasText: title });

// ShareStatusPopover always renders its status text in this exact leaf span
// (src/components/ShareStatusPopover.tsx: <span className="break-words">),
// so this one locator finds the pill wherever it lives — task row, project
// bar, drawer tree row, or the mobile Edit Task sheet header.
const sharedBadge = (page: Page, needle: string) =>
  page.locator('span.break-words:visible').filter({ hasText: needle });

// ---- Cleanup -----------------------------------------------------------------

interface Ids { projectId: string; taskId: string; stamp: number; }

const cleanup = async (request: APIRequestContext, s: Session, ids: Ids): Promise<string[]> => {
  const problems: string[] = [];
  try {
    const p1 = await restDelete(request, s, 'focusos_tasks', ids.taskId);
    if (p1) problems.push(p1);
    const p2 = await restDelete(request, s, 'focusos_projects', ids.projectId);
    if (p2) problems.push(p2);

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

// ---- Test A: desktop --------------------------------------------------------

test.describe('desktop: share pills refresh live, no reload', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

  test('sharing a task from the Edit Task pane, then a project from the bar, refreshes both pills without a full-page reload', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    const s = await restSignIn(request);
    const projCountBefore = await restCount(request, s, 'focusos_projects');
    const taskCountBefore = await restCount(request, s, 'focusos_tasks');

    const stamp = Date.now();
    const projectName = `O2 Share Test ${stamp}`;
    const taskTitle = `O2 Share Task ${stamp}`;
    const taskFakeEmail = `o2-fake-task-${stamp}@example.invalid`;
    const projectFakeEmail = `o2-fake-project-${stamp}@example.invalid`;

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, status: 'todo', priority: 'medium',
    });
    const ids: Ids = { projectId, taskId, stamp };

    let bodyError: Error | null = null;
    try {
      const share = await installShareIntercepts(context, s);

      await signIn(page);
      await page.goto(`${BASE}/app`);
      await selectProject(page, projectId, projectName);

      // ---- (a) Share the task from the Edit Task pane's share icon ----------
      const card = taskCard(page, taskTitle);
      await card.hover();
      await card.locator('[title="Edit task"]:visible').first().click();

      const pane = page.locator('[data-side-panel]');
      await expect(pane).toBeVisible({ timeout: 10000 });
      await pane.getByRole('button', { name: 'Share' }).click();

      const taskShareDialog = page.getByRole('dialog', { name: 'Share Task' });
      await expect(taskShareDialog).toBeVisible({ timeout: 5000 });
      const hitsBeforeTaskShare = share.getHits;
      await taskShareDialog.getByLabel('Add Recipients').fill(taskFakeEmail);
      await taskShareDialog.getByLabel('Add Recipients').press('Enter');
      await taskShareDialog.getByRole('button', { name: /Share with/ }).click();
      await expect(taskShareDialog).toBeHidden({ timeout: 5000 });

      // Live, no reload: the row's own pill appears and the GET re-fired.
      await expect(sharedBadge(page, taskFakeEmail)).toBeVisible({ timeout: 5000 });
      expect(share.getHits, 'the focusos_shared_items GET must have re-fired after the task share').toBeGreaterThan(hitsBeforeTaskShare);

      // Close the docked pane before touching the project bar.
      await page.locator('[data-side-panel] > div:first-child > button').click();
      await expect(pane).toBeHidden({ timeout: 5000 });

      // ---- (b) Share the project from the bar (compact tier at 1280) --------
      await page.getByTestId('desktop-more').click();
      const hitsBeforeProjectShare = share.getHits;
      await page.getByTestId('desktop-more-share').click();

      const projectShareDialog = page.getByRole('dialog', { name: 'Share Project' });
      await expect(projectShareDialog).toBeVisible({ timeout: 5000 });
      await projectShareDialog.getByLabel('Add Recipients').fill(projectFakeEmail);
      await projectShareDialog.getByLabel('Add Recipients').press('Enter');
      await projectShareDialog.getByRole('button', { name: /Share with/ }).click();
      await expect(projectShareDialog).toBeHidden({ timeout: 5000 });

      // Live, no reload: the bar's own pill AND the drawer/sidebar tree row's
      // pill both appear (two renders of the same senderProjectSharedMap entry).
      await expect(page.locator('.lg-projbar').locator('span.break-words:visible').filter({ hasText: projectFakeEmail })).toBeVisible({ timeout: 5000 });
      await expect(sharedBadge(page, projectFakeEmail)).toHaveCount(2, { timeout: 5000 });
      expect(share.getHits, 'the focusos_shared_items GET must have re-fired after the project share').toBeGreaterThan(hitsBeforeProjectShare);
    } catch (e) {
      bodyError = e as Error;
    }

    const leaks = await cleanup(request, s, ids);
    const projCountAfter = await restCount(request, s, 'focusos_projects');
    const taskCountAfter = await restCount(request, s, 'focusos_tasks');

    if (bodyError) {
      if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
      throw bodyError;
    }
    expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
    expect(projCountAfter, 'project count must match the pre-test count').toBe(projCountBefore);
    expect(taskCountAfter, 'task count must match the pre-test count').toBe(taskCountBefore);
  });
});

// ---- Test B: mobile ----------------------------------------------------------

test.describe('mobile: share pill refreshes live, no reload', () => {
  // actionTimeout bounds every bare locator action in THIS file only (config.ts
  // leaves it unset = unbounded) — a zero-match or blocked locator fails fast
  // with a diagnosable message instead of hanging for the full test timeout
  // (see tests/projectbar-widths.spec.ts for the same reasoning).
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('sharing a task from the Edit Task sheet refreshes its pill without a full-page reload', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    const s = await restSignIn(request);
    const projCountBefore = await restCount(request, s, 'focusos_projects');
    const taskCountBefore = await restCount(request, s, 'focusos_tasks');

    const stamp = Date.now();
    const projectName = `O2 Share Test ${stamp}`;
    const taskTitle = `O2 Share Task ${stamp}`;
    const taskFakeEmail = `o2-fake-task-${stamp}@example.invalid`;

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, status: 'todo', priority: 'medium',
    });
    const ids: Ids = { projectId, taskId, stamp };

    let bodyError: Error | null = null;
    const liveInSheet = true; // asserted above: the chip must land with the sheet still open
    try {
      const share = await installShareIntercepts(context, s);

      await signIn(page);
      await page.goto(`${BASE}/app`);
      await selectProject(page, projectId, projectName);

      const openSheet = async () => {
        const card = taskCard(page, taskTitle);
        // The project's task list re-fetches after selection lands (a beat
        // after the drawer/bar shows the new name) — wait for the card itself
        // before tapping into it, rather than letting tap()'s own actionability
        // retry race a transient "No tasks here yet" empty state.
        await expect(card).toBeVisible({ timeout: 15000 });
        // TaskListItem has three card views (src/components/TaskListItem.tsx),
        // set by the account's own default_task_card_view_mobile preference —
        // this is the real demo account, so it is whatever Igor last left it
        // as, not something this spec controls. The card's OWN onClick
        // (onTaskClick) only toggles inline expansion in every view — it never
        // opens the sheet. The one control that does, in every view, is the
        // task's own title (a <span> in 'minimal', an <h3> in 'compact'/
        // 'full'): its handler is openTitleEditor, which on mobile short-
        // circuits straight to `onEditTask?.(task)` before touching any
        // expand/edit-inline state. Match on the title text itself so this
        // works regardless of which tag the active view renders it as.
        await card.getByText(taskTitle, { exact: true }).first().tap();
        await expect(page.locator('.lg-editsheet')).toBeVisible({ timeout: 10000 });
      };
      await openSheet();

      const sheet = page.locator('.lg-editsheet');
      await sheet.getByRole('button', { name: 'Share' }).click();

      const taskShareDialog = page.getByRole('dialog', { name: 'Share Task' });
      await expect(taskShareDialog).toBeVisible({ timeout: 5000 });
      const hitsBeforeShare = share.getHits;
      await taskShareDialog.getByLabel('Add Recipients').fill(taskFakeEmail);
      await taskShareDialog.getByLabel('Add Recipients').press('Enter');
      await taskShareDialog.getByRole('button', { name: /Share with/ }).click();
      await expect(taskShareDialog).toBeHidden({ timeout: 5000 });

      expect(share.getHits, 'the focusos_shared_items GET must have re-fired after the share').toBeGreaterThan(hitsBeforeShare);

      // The sheet's own chip must appear LIVE, with the sheet still open: Index
      // passes the live sender map as `sharedRecipients` (the `editingTask`
      // snapshot itself is never swapped, so unsaved edits survive the
      // refetch). No close/reopen, no reload.
      const chipInSheet = sharedBadge(page, taskFakeEmail);
      await expect(sheet, 'the sheet must still be open when the chip lands').toBeVisible();
      await expect(chipInSheet, 'the sheet header chip must appear without closing the sheet').toBeVisible({ timeout: 5000 });
      test.info().annotations.push({ type: 'chip-appeared-live-without-reopen', description: String(liveInSheet) });
    } catch (e) {
      bodyError = e as Error;
    }

    const leaks = await cleanup(request, s, ids);
    const projCountAfter = await restCount(request, s, 'focusos_projects');
    const taskCountAfter = await restCount(request, s, 'focusos_tasks');

    if (bodyError) {
      if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
      throw bodyError;
    }
    expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
    expect(projCountAfter, 'project count must match the pre-test count').toBe(projCountBefore);
    expect(taskCountAfter, 'task count must match the pre-test count').toBe(taskCountBefore);
  });
});
