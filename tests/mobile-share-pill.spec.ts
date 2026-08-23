// MOBILE SHARE-STATUS PILL (O3, 2026-08-23) — end-to-end against the real demo
// account and the real Supabase backend, same shape as
// tests/share-status-live.spec.ts: DEMO_EMAIL/DEMO_PASSWORD + the /auth
// sign-in steps, BASE from WAVE_BASE_URL, timestamped names, try/finally
// cleanup with asserted deletes and a raw project/task count check before and
// after.
//
// What this proves: the purple "Shared with ..." pill (ShareStatusPopover) —
// previously desktop-only in the task row/card (`!isMobile` gates on
// src/components/TaskListItem.tsx and src/components/TaskCard.tsx) and never
// wired into Home's Edit Task sheet at all — now shows on phones: on the
// collapsed row in both COMPACT and MINIMAL density, on the GRID card, in the
// Edit Task sheet opened from /app, and in the Edit Task sheet opened from a
// Today's Focus row on /home. Desktop is asserted unchanged.
//
// Only one network path is faked, and ONLY on this test's own browser
// context: the GET reads of focusos_shared_items (so the UI sees one fake
// accepted recipient for our throwaway task without a real share ever being
// sent — no email, no real focusos_shared_items row). Every other REST call —
// sign-in, project/task reads and writes — hits the real Supabase project
// untouched. No Share button is ever pressed.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/mobile-share-pill.spec.ts
import { test, expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account the other project specs sign in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

// ---- UI sign-in + project selection (copied from tests/share-status-live.spec.ts) ----

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

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

// ---- The one intercepted network path ---------------------------------------
//
// focusos_shared_items GETs: every consumer in the app reads this table (the
// sender maps in Index.tsx/Home.tsx, the received-items list in
// ProjectSidebar.tsx, ShareItemDialog's own contacts fetch) with different
// filters, but PostgREST filtering happens server-side — since this route
// never reaches the server, it always returns the SAME one fake row
// regardless of query params (the same blanket-return approach
// tests/share-status-live.spec.ts uses). No POST route needs faking: this
// spec never presses a Share button, so no edge function ever fires.
const installSharedItemsIntercept = async (
  context: BrowserContext,
  s: Session,
  taskId: string,
  recipientEmail: string,
): Promise<void> => {
  const fakeRow = {
    id: `o3-fake-shared-row-${Date.now()}`,
    item_id: taskId,
    item_type: 'task',
    recipient_email: recipientEmail,
    recipient_user_id: null,
    recipient_task_id: null,
    status: 'accepted',
    sender_user_id: s.userId,
    sender_email: null,
    created_at: new Date().toISOString(),
    // sender_acknowledged: true — this same blanket-return row is also read by
    // ProjectSidebar's own focusos_shared_items query (src/components/
    // ProjectSidebar.tsx ~495-515), which pops an infinite-duration "accepted"
    // toast over the whole page for any UNacknowledged accepted row. That toast
    // covered the one-bar title and blocked every click in the first run of
    // this spec — acknowledged:true keeps this row invisible to that effect
    // while every chip-rendering consumer (buildSenderSharedMaps) ignores the
    // field entirely.
    sender_acknowledged: true,
    completion_acknowledged: false,
  };

  await context.route('**/rest/v1/focusos_shared_items*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([fakeRow]),
    });
  });
};

// ---- Locators ----------------------------------------------------------------

// TaskListItem rows (compact/minimal density). Both the desktop and mobile
// markup branches can be in the DOM at once for the same row (see
// tests/share-status-live.spec.ts) — :visible keeps this to the branch the
// current viewport actually renders.
const taskRow = (page: Page, title: string) =>
  page.locator('[data-task-card]:visible').filter({ hasText: title });

// TaskCard grid cards never carry [data-task-card] — src/components/TaskCard.tsx
// puts the shadcn Card straight down with its own lg-grid-card class.
const gridCard = (page: Page, title: string) =>
  page.locator('.lg-grid-card:visible').filter({ hasText: title });

// ShareStatusPopover always renders its status text in this exact leaf span
// (src/components/ShareStatusPopover.tsx: <span className="break-words">).
// Scoped to a container so a background card's own chip (still in the DOM,
// merely covered, once a modal opens over it) never satisfies a sheet-scoped
// assertion.
const chipIn = (container: ReturnType<Page['locator']>, needle: string) =>
  container.locator('span.break-words:visible').filter({ hasText: needle });

// Rect intersection in CSS pixels — used to prove the chip never overlaps the
// title (Igor's ask: never shrink or hide the title to make room for it).
type Box = { x: number; y: number; width: number; height: number };
const boxesIntersect = (a: Box, b: Box): boolean =>
  !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

// A single check that catches BOTH failure shapes: single-line `truncate`
// titles (minimal density, grid card) clip by width, multi-line `line-clamp-2`
// titles (compact density) clip by height. +1 tolerates sub-pixel rounding.
const isClipped = async (locator: ReturnType<Page['locator']>): Promise<boolean> =>
  locator.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);

const assertTitleClearOfChip = async (
  container: ReturnType<Page['locator']>,
  title: string,
  fakeEmail: string,
) => {
  const chip = chipIn(container, fakeEmail);
  await expect(chip, 'the share chip must be visible').toBeVisible({ timeout: 5000 });
  const titleEl = container.getByText(title, { exact: true }).first();
  const chipBox = await chip.first().boundingBox();
  const titleBox = await titleEl.boundingBox();
  expect(chipBox, 'chip bounding box must be measurable').toBeTruthy();
  expect(titleBox, 'title bounding box must be measurable').toBeTruthy();
  expect(boxesIntersect(titleBox as Box, chipBox as Box), 'the chip must not overlap the title').toBe(false);
  expect(await isClipped(titleEl), 'the title must not be clipped to make room for the chip').toBe(false);
};

// ---- One-bar view/density controls (src/pages/Index.tsx ~2790-2852) ---------

const ONEBAR_VIEWS = ['list', 'grid', 'gantt', 'time-tracking'] as const;
const ONEBAR_DENSITIES = ['full', 'compact', 'minimal'] as const;

const openContextSheet = async (page: Page) => {
  await page.locator('[data-testid="onebar-title"]').click();
  const sheet = page.locator('[data-testid="onebar-context-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 5000 });
  return sheet;
};

const readCurrentView = async (page: Page): Promise<(typeof ONEBAR_VIEWS)[number]> => {
  for (const v of ONEBAR_VIEWS) {
    // Checked row renders Icon + Check (2 svg); every other row renders only
    // its own Icon (1 svg) — see the onebar-view-* JSX.
    if ((await page.locator(`[data-testid="onebar-view-${v}"] svg`).count()) === 2) return v;
  }
  return 'list';
};

const readCurrentDensity = async (page: Page): Promise<(typeof ONEBAR_DENSITIES)[number] | null> => {
  if ((await page.locator('[data-testid="onebar-density-section"]').count()) === 0) return null;
  for (const d of ONEBAR_DENSITIES) {
    // Density rows carry no leading icon, so the checked row is the only one
    // with an svg at all (the Check).
    if ((await page.locator(`[data-testid="onebar-density-${d}"] svg`).count()) === 1) return d;
  }
  return null;
};

const switchView = async (page: Page, view: (typeof ONEBAR_VIEWS)[number]) => {
  const sheet = await openContextSheet(page);
  await page.locator(`[data-testid="onebar-view-${view}"]`).click();
  await expect(sheet).toHaveCount(0);
};

const switchDensity = async (page: Page, density: (typeof ONEBAR_DENSITIES)[number]) => {
  const sheet = await openContextSheet(page);
  await page.locator(`[data-testid="onebar-density-${density}"]`).click();
  await expect(sheet).toHaveCount(0);
};

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

// ---- Test A: mobile -----------------------------------------------------------

test.describe('mobile: share-status pill is visible on phones', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('the pill shows on compact and minimal rows, the grid card, and the Edit Task sheet from /app and /home', async ({ page, request, context }) => {
    test.setTimeout(150_000);

    const s = await restSignIn(request);
    const projCountBefore = await restCount(request, s, 'focusos_projects');
    const taskCountBefore = await restCount(request, s, 'focusos_tasks');

    const stamp = Date.now();
    const projectName = `O3 Pill Test ${stamp}`;
    // Short on purpose: TaskCard's header row (src/components/TaskCard.tsx
    // ~226-266) splits its width between the title and the priority + status
    // badges, so at 393px a long title already truncates there with NO share
    // chip in play at all (the chip lives in the footer, well clear of the
    // header) — a longer stamped title would fail the clip check for a reason
    // that has nothing to do with this fix.
    const taskTitle = `O3 ${stamp}`;
    const fakeEmail = `o3-fake-${stamp}@example.invalid`;

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    // due_date = today so the task lands in Home's Today's Focus (rankTodaysFocus
    // tier 0 needs due_date within -7..0 days of today — src/pages/Home.tsx ~76-98).
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, status: 'todo', priority: 'medium',
      due_date: new Date().toISOString(),
    });
    const ids: Ids = { projectId, taskId, stamp };

    let bodyError: Error | null = null;
    let originalView: (typeof ONEBAR_VIEWS)[number] = 'list';
    let originalDensity: (typeof ONEBAR_DENSITIES)[number] | null = null;
    let restoredPrefs = false;

    try {
      await installSharedItemsIntercept(context, s, taskId, fakeEmail);

      await signIn(page);
      await page.goto(`${BASE}/app`);
      await selectProject(page, projectId, projectName);

      // Read the account's current view/density before touching anything, so
      // they can be put back exactly (session-only React state — setGlobalCardView/
      // setViewMode never call updatePreferences, so nothing is actually
      // persisted server-side, but the live page should still look untouched
      // when this test is done with it).
      await openContextSheet(page);
      originalView = await readCurrentView(page);
      originalDensity = await readCurrentDensity(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="onebar-context-sheet"]')).toHaveCount(0);

      if (originalView !== 'list') {
        await switchView(page, 'list');
      }

      // ---- (a) Compact density: collapsed row, chip on its own line --------
      await switchDensity(page, 'compact');
      const compactRow = taskRow(page, taskTitle);
      await expect(compactRow).toBeVisible({ timeout: 15000 });
      await assertTitleClearOfChip(compactRow, taskTitle, fakeEmail);

      // ---- (b) Minimal density: single-line row, chip drops to its own line
      //          below (src/components/TaskListItem.tsx ~585-599) ------------
      await switchDensity(page, 'minimal');
      const minimalRow = taskRow(page, taskTitle);
      await expect(minimalRow).toBeVisible({ timeout: 15000 });
      await assertTitleClearOfChip(minimalRow, taskTitle, fakeEmail);

      // ---- (c) Grid view: card footer chip (src/components/TaskCard.tsx ~448) --
      await switchView(page, 'grid');
      const card = gridCard(page, taskTitle);
      await expect(card).toBeVisible({ timeout: 15000 });
      await assertTitleClearOfChip(card, taskTitle, fakeEmail);

      // ---- (d) Edit Task sheet opened from /app (tap the grid card's title) ----
      await card.getByText(taskTitle, { exact: true }).first().click();
      const appSheet = page.locator('.lg-editsheet');
      await expect(appSheet).toBeVisible({ timeout: 10000 });
      await expect(chipIn(appSheet, fakeEmail), 'the sheet header chip must be visible when opened from /app').toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(appSheet).toBeHidden({ timeout: 5000 });

      // ---- Restore view/density before leaving /app -------------------------
      await switchView(page, originalView);
      if (originalView === 'list' && originalDensity) {
        await switchDensity(page, originalDensity);
      }
      restoredPrefs = true;

      // ---- (e) Edit Task sheet opened from /home's Today's Focus row --------
      // This is the actual O3 fix: Home never loaded the sender's shared_items
      // rows and never passed sharedRecipients to EditTaskDialog, so this sheet
      // had no chip to show even though the task really had a recipient.
      await page.goto(`${BASE}/home`);
      const homeRow = page.locator('.lg-utap').filter({ hasText: taskTitle });
      await expect(homeRow).toBeVisible({ timeout: 20000 });
      await homeRow.scrollIntoViewIfNeeded();
      await homeRow.click();
      const homeSheet = page.locator('.lg-editsheet');
      await expect(homeSheet).toBeVisible({ timeout: 10000 });
      await expect(chipIn(homeSheet, fakeEmail), 'the sheet header chip must be visible when opened from /home').toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(homeSheet).toBeHidden({ timeout: 5000 });
    } catch (e) {
      bodyError = e as Error;
    }

    // Best-effort restore even on failure, so a broken assertion never leaves
    // the live demo account's page mid-density-swap for the next run.
    if (!restoredPrefs) {
      try {
        await page.goto(`${BASE}/app`).catch(() => {});
        await selectProject(page, projectId, projectName).catch(() => {});
        await switchView(page, originalView).catch(() => {});
        if (originalView === 'list' && originalDensity) {
          await switchDensity(page, originalDensity).catch(() => {});
        }
      } catch { /* best-effort only — the count/leak checks below are the real proof */ }
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

// ---- Test B: desktop (unchanged behaviour) -------------------------------------

test.describe('desktop: share-status pill still shows on the row (unchanged)', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

  test('the row chip is visible exactly as before', async ({ page, request, context }) => {
    test.setTimeout(90_000);

    const s = await restSignIn(request);
    const projCountBefore = await restCount(request, s, 'focusos_projects');
    const taskCountBefore = await restCount(request, s, 'focusos_tasks');

    const stamp = Date.now();
    const projectName = `O3 Pill Desktop Test ${stamp}`;
    const taskTitle = `O3 Pill Desktop Task ${stamp}`;
    const fakeEmail = `o3-fake-desktop-${stamp}@example.invalid`;

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, status: 'todo', priority: 'medium',
    });
    const ids: Ids = { projectId, taskId, stamp };

    let bodyError: Error | null = null;
    try {
      await installSharedItemsIntercept(context, s, taskId, fakeEmail);

      await signIn(page);
      await page.goto(`${BASE}/app`);
      await selectProject(page, projectId, projectName);

      const row = taskRow(page, taskTitle);
      await expect(row).toBeVisible({ timeout: 15000 });
      // Desktop's own layout (src/components/TaskListItem.tsx ~981 "hidden
      // lg:flex" block) was never gated by isMobile — this proves O3 left it
      // exactly as it was.
      await expect(chipIn(row, fakeEmail)).toBeVisible({ timeout: 5000 });
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

// ---- Test C: refutation B fix-round (2026-08-23) --------------------------
//
// TaskCard's footer (src/components/TaskCard.tsx ~365) had no flex-wrap, so a
// long recipient email pushed the chip past the card's own right edge at
// narrow widths instead of wrapping. Proven at both 393 and 375 wide, with an
// email longer than the 31-char one from Igor's screenshot
// (boyd.telford@theteachersouq.com), so the fix is checked against a second,
// wider length bucket too.

test.describe('mobile: the share chip wraps inside the grid card, never overflows it', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('the chip right edge never exceeds the card right edge, at 393 and at 375', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    const s = await restSignIn(request);
    const projCountBefore = await restCount(request, s, 'focusos_projects');
    const taskCountBefore = await restCount(request, s, 'focusos_tasks');

    const stamp = Date.now();
    const projectName = `O3 Wrap Test ${stamp}`;
    // Bare stamp, no prefix: TaskCard's header row splits width between the
    // title and the priority/status badges (same as Test A above), so at 375
    // wide there is LESS room than at 393 wide, and even a two-letter prefix
    // ("O3W ") pushed this title's own truncate right up against its
    // available width, clipping for a reason that has nothing to do with the
    // chip wrap this test proves. A bare stamp leaves headroom at both widths.
    const taskTitle = `${stamp}`;
    const fakeEmail = `o3-wide-recipient-${stamp}@example-long-domain.io`;

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, status: 'todo', priority: 'medium',
    });
    const ids: Ids = { projectId, taskId, stamp };

    let bodyError: Error | null = null;
    try {
      await installSharedItemsIntercept(context, s, taskId, fakeEmail);

      await signIn(page);
      await page.goto(`${BASE}/app`);
      await selectProject(page, projectId, projectName);
      await switchView(page, 'grid');

      for (const width of [393, 375] as const) {
        await page.setViewportSize({ width, height: 852 });
        const card = gridCard(page, taskTitle);
        await expect(card, `grid card must be visible at ${width}px`).toBeVisible({ timeout: 15000 });
        await assertTitleClearOfChip(card, taskTitle, fakeEmail);

        const chip = chipIn(card, fakeEmail);
        const cardBox = await card.boundingBox();
        const chipBox = await chip.first().boundingBox();
        expect(cardBox, `card bounding box must be measurable at ${width}px`).toBeTruthy();
        expect(chipBox, `chip bounding box must be measurable at ${width}px`).toBeTruthy();
        const cardRight = (cardBox as Box).x + (cardBox as Box).width;
        const chipRight = (chipBox as Box).x + (chipBox as Box).width;
        expect(
          chipRight,
          `chip right edge (${chipRight.toFixed(1)}) must not exceed the card right edge (${cardRight.toFixed(1)}) at ${width}px`,
        ).toBeLessThanOrEqual(cardRight + 1);
      }
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

// ---- Test D: refutation A fix-round (2026-08-23) ---------------------------
//
// Before this fix-round, Home held its OWN copy of the sender-shared query
// under its OWN key (`['focusos-sender-shared', userId]`), separate from the
// key usePrefetchAppData and Index share (`appDataKeys.senderSharedItems`).
// A share on one surface never invalidated the other surface's cache, so its
// chip stayed stale until a full reload. Now both surfaces read and write the
// SAME cache entry, so a share on either surface must show its chip on the
// OTHER surface without a reload. Proven bidirectionally, and only via
// CLIENT-SIDE navigation (the FAB's double-tap-to-home, the dock's Today
// button) since a page.goto would throw away the QueryClient instance the fix
// depends on and pass the test for the wrong reason.
//
// Only two network paths are faked, on this test's own browser context only
// (same shape as tests/share-status-live.spec.ts's installShareIntercepts):
// the focusos-share-item edge function (no email ever sends, no real
// focusos_shared_items row is written) and the GET reads of
// focusos_shared_items (serves the accumulated fake rows straight back). The
// Share button is pressed for real, twice, so the app's real code path runs
// end to end (realtime handler on /app, invalidateQueries on /home).

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
  getHits: number;
}

const installLiveShareIntercept = async (
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
        id: `o3-cache-fake-shared-row-${fakeIdCounter}`,
        item_id: body.itemId,
        item_type: body.itemType,
        recipient_email: body.recipientEmail,
        recipient_user_id: null,
        recipient_task_id: null,
        status: 'accepted',
        sender_user_id: s.userId,
        sender_email: null,
        created_at: new Date().toISOString(),
        // acknowledged: true, same ProjectSidebar-toast trap noted on
        // installSharedItemsIntercept above.
        sender_acknowledged: true,
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

test.describe('mobile: a share on one surface shows its chip on the other, no reload', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('share from /app crosses to /home, share from /home crosses back to /app', async ({ page, request, context }) => {
    test.setTimeout(150_000);

    const s = await restSignIn(request);
    const projCountBefore = await restCount(request, s, 'focusos_projects');
    const taskCountBefore = await restCount(request, s, 'focusos_tasks');

    const stamp = Date.now();
    const projectName = `O3 Cache Test ${stamp}`;
    // Two separate tasks, one per direction. ShareStatusPopover's own badge
    // (src/components/ShareStatusPopover.tsx buildStatusSummary) only prints
    // the recipient's email when a task has EXACTLY one recipient; a second
    // recipient on the SAME task collapses the badge to a status count
    // ("2 Accepted") with no email text at all, which broke chipIn's
    // email-substring match on the first version of this test. Two tasks
    // keep every chip at exactly one recipient, matching Test A/B's own
    // pattern.
    const taskTitleA = `${stamp}A`;
    const taskTitleB = `${stamp}B`;
    const fakeEmailFromApp = `o3-fromapp-${stamp}@example.invalid`;
    const fakeEmailFromHome = `o3-fromhome-${stamp}@example.invalid`;

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    // due_date = today so both tasks land in Home's Today's Focus (rankTodaysFocus
    // tier 0 needs due_date within -7..0 days of today, same reasoning as Test A).
    const taskAId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitleA, status: 'todo', priority: 'medium',
      due_date: new Date().toISOString(),
    });
    const taskBId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitleB, status: 'todo', priority: 'medium',
      due_date: new Date().toISOString(),
    });
    const ids: Ids = { projectId, taskId: taskAId, stamp };

    let bodyError: Error | null = null;
    let originalView: (typeof ONEBAR_VIEWS)[number] = 'list';
    try {
      await installLiveShareIntercept(context, s);

      await signIn(page);
      await page.goto(`${BASE}/app`);
      await selectProject(page, projectId, projectName);

      const ensureListView = async () => {
        await openContextSheet(page);
        const current = await readCurrentView(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-testid="onebar-context-sheet"]')).toHaveCount(0);
        if (current !== 'list') await switchView(page, 'list');
        return current;
      };

      const shareFrom = async (sheet: ReturnType<Page['locator']>, email: string) => {
        await sheet.getByRole('button', { name: 'Share', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Share Task' });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await dialog.getByLabel('Add Recipients').fill(email);
        await dialog.getByLabel('Add Recipients').press('Enter');
        await dialog.getByRole('button', { name: /Share with/ }).click();
        await expect(dialog).toBeHidden({ timeout: 5000 });
      };

      originalView = await ensureListView();

      // ---- Direction 1: share task A from /app's Edit Task sheet ------------
      const row = taskRow(page, taskTitleA);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByText(taskTitleA, { exact: true }).first().tap();
      const appSheet = page.locator('.lg-editsheet');
      await expect(appSheet).toBeVisible({ timeout: 10000 });
      await shareFrom(appSheet, fakeEmailFromApp);
      await expect(chipIn(appSheet, fakeEmailFromApp), 'the app sheet chip must land live').toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(appSheet).toBeHidden({ timeout: 5000 });

      // ---- Cross to /home via the FAB's double-tap (client-side nav: the
      //      whole point is that the SAME QueryClient instance carries the
      //      share across, which page.goto would defeat) ----------------------
      await expect(page.locator('.lg-fab-main'), 'the record FAB must be visible once the sheet is closed').toBeVisible({ timeout: 5000 });
      await page.locator('.lg-fab-main').dblclick();
      await page.waitForURL('**/home', { timeout: 10000 });

      const homeRowA = page.locator('.lg-utap').filter({ hasText: taskTitleA });
      await expect(homeRowA).toBeVisible({ timeout: 20000 });
      await homeRowA.scrollIntoViewIfNeeded();
      await homeRowA.click();
      const homeSheetA = page.locator('.lg-editsheet');
      await expect(homeSheetA).toBeVisible({ timeout: 10000 });
      await expect(
        chipIn(homeSheetA, fakeEmailFromApp),
        'a share made on /app must show its chip on /home without a reload (refutation A)',
      ).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(homeSheetA).toBeHidden({ timeout: 5000 });

      // ---- Direction 2: share task B from the /home sheet --------------------
      const homeRowB = page.locator('.lg-utap').filter({ hasText: taskTitleB });
      await expect(homeRowB).toBeVisible({ timeout: 15000 });
      await homeRowB.scrollIntoViewIfNeeded();
      await homeRowB.click();
      const homeSheetB = page.locator('.lg-editsheet');
      await expect(homeSheetB).toBeVisible({ timeout: 10000 });
      await shareFrom(homeSheetB, fakeEmailFromHome);
      await expect(chipIn(homeSheetB, fakeEmailFromHome), 'the home sheet chip must land live').toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(homeSheetB).toBeHidden({ timeout: 5000 });

      // ---- Cross back to /app via the dock's Today button (client-side nav) --
      await page.locator('[data-home-tour-step="today"]').click();
      await page.waitForURL('**/app**', { timeout: 10000 });
      await selectProject(page, projectId, projectName);
      await ensureListView();

      const rowBAfter = taskRow(page, taskTitleB);
      await expect(rowBAfter, 'task B row visible after crossing back to /app').toBeVisible({ timeout: 15000 });
      await expect(
        chipIn(rowBAfter, fakeEmailFromHome),
        'a share made on /home must show its chip on the /app row without a reload (refutation A)',
      ).toBeVisible({ timeout: 5000 });

      await rowBAfter.getByText(taskTitleB, { exact: true }).first().tap();
      const appSheetBAfter = page.locator('.lg-editsheet');
      await expect(appSheetBAfter).toBeVisible({ timeout: 10000 });
      await expect(
        chipIn(appSheetBAfter, fakeEmailFromHome),
        'a share made on /home must show its chip in the /app sheet without a reload (refutation A)',
      ).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(appSheetBAfter).toBeHidden({ timeout: 5000 });

      if (originalView !== 'list') await switchView(page, originalView);
    } catch (e) {
      bodyError = e as Error;
    }

    // Task B is not covered by the shared `cleanup` helper (it only deletes
    // ids.taskId, task A), so delete it explicitly first — by the time
    // cleanup's own stamp-based leak sweep runs below, task B is already gone.
    const taskBDeleteProblem = await restDelete(request, s, 'focusos_tasks', taskBId);
    const leaks = await cleanup(request, s, ids);
    if (taskBDeleteProblem) leaks.push(taskBDeleteProblem);
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

// ---- Test E: refutation A fix-round (2026-08-23) ---------------------------
//
// Before this fix-round, usePrefetchAppData's own inline prefetchQuery (under
// 'focusos-sender-shared-items') and Home's own useQuery (under
// 'focusos-sender-shared') were two DIFFERENT keys reading the same table, so
// a fresh /home mount fired two byte-identical focusos_shared_items selects.
// Now both read appDataKeys.senderSharedItems, so they dedupe to one request.
// This test reads the real backend (no mock) and only COUNTS GET hits to the
// table; it writes nothing, so there is no project/task cleanup needed.

test.describe('mobile: exactly one focusos_shared_items GET fires on a fresh /home load', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('usePrefetchAppData\'s prefetch and Home\'s own useQuery dedupe to one request', async ({ page, context }) => {
    test.setTimeout(60_000);

    let getHits = 0;
    await context.route('**/rest/v1/focusos_shared_items*', async (route) => {
      if (route.request().method() === 'GET') getHits += 1;
      await route.continue();
    });

    // signIn() itself lands on /home (waitForURL '**/home') right after
    // sign-in: that IS the fresh Home mount under test, no extra goto needed.
    await signIn(page);
    await page.waitForTimeout(3000);

    expect(
      getHits,
      'exactly one focusos_shared_items GET must fire within 3s of a fresh /home load (appDataKeys.senderSharedItems is now one shared cache entry, not two)',
    ).toBe(1);
  });
});
