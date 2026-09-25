// Add Task must never lie about success. Reproduced with a probe: AddTaskDialog's
// handleSubmit called onAddTask(newTask) WITHOUT awaiting it, then immediately
// cleared the form, closed the dialog and toasted "Task created successfully" —
// so a failed insert (an expired session answering 401 / PGRST301 / a JWT-expired
// message) still looked like a success, and the typed task was gone for good.
//
// Fix: onAddTask now returns Promise<boolean>. AddTaskDialog awaits it and only
// clears/closes/toasts on true; on false it keeps the dialog open with every
// field intact and shows an inline error (data-testid="add-task-save-error").
// Index.tsx's handleAddTask calls ensureSession() before the insert and, on an
// auth-shaped error, refreshes the session and retries the insert exactly once.
//
// LIVE against the real demo account and the real Supabase backend, same shape
// as tests/project-rollups.spec.ts: REST sign-in, PostgREST helpers, zz-stamped
// rows, cleanup that deletes everything this run created and proves it.
//
// Cases:
//   (a) every insert answers 401 {message:"JWT expired", code:"PGRST301"} ->
//       dialog stays open, #title keeps the typed title, the inline error is
//       visible, no success toast ever appears, and no row lands.
//   (b) the FIRST insert answers 401 the same way, the retry goes through ->
//       dialog closes, exactly one success toast, exactly one row lands.
//   (c) no interception -> the ordinary path: dialog closes, success toast,
//       exactly one row.
//
// Run: cd /Users/igor/Developer/focus-os/.claude/worktrees/graph-a && PW_PORT=8094 npx playwright test tests/desktop-add-task-save.spec.ts --project=desktop-mouse
import { test, expect, type Page, type APIRequestContext, type Route } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account tests/project-rollups.spec.ts signs in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

test.use({ actionTimeout: 15000 });

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

/** Exact row count for focusos_tasks (Content-Range, no payload). */
const restTaskCount = async (request: APIRequestContext, s: Session): Promise<number> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/focusos_tasks?select=id`, {
    headers: restHeaders(s, { Prefer: 'count=exact' }),
  });
  expect(res.ok(), `counting focusos_tasks must succeed (${res.status()})`).toBeTruthy();
  const range = res.headers()['content-range'] ?? '';
  const total = Number(range.split('/')[1]);
  expect(Number.isFinite(total), `focusos_tasks count must parse from ${range}`).toBeTruthy();
  return total;
};

/**
 * Delete every zz-addtask row this run could have created (by title, exact
 * match against the stamped titles this suite uses) and PROVE none survive.
 * Never throws: returns a list of problems so a cleanup failure is reported
 * rather than swallowing a real test failure.
 */
const cleanupTitle = async (
  request: APIRequestContext,
  s: Session,
  title: string,
): Promise<string[]> => {
  const problems: string[] = [];
  try {
    const encoded = encodeURIComponent(title);
    const del = await request.delete(
      `${SUPABASE_URL}/rest/v1/focusos_tasks?user_id=eq.${s.userId}&title=eq.${encoded}`,
      { headers: restHeaders(s, { Prefer: 'return=minimal' }) },
    );
    if (!del.ok()) problems.push(`delete for "${title}": HTTP ${del.status()}`);
    const left = await restSelect(request, s, `focusos_tasks?select=id,title&title=eq.${encoded}`);
    if (left.length) problems.push(`row still present after cleanup: "${title}" (${left.length})`);
  } catch (e) {
    problems.push(`cleanup threw: ${(e as Error).message}`);
  }
  return problems;
};

// ---- the app -------------------------------------------------------------------

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

const openTodayWithAddTask = async (page: Page) => {
  await page.goto(`${BASE}/app?view=today`);
  const addBtn = page.getByRole('button', { name: 'Add task' }).first();
  await expect(addBtn).toBeVisible({ timeout: 20000 });
  await addBtn.click();
  const titleInput = page.locator('#title');
  await expect(titleInput).toBeVisible({ timeout: 10000 });
  return titleInput;
};

const createTaskButton = (page: Page) => page.getByRole('button', { name: 'Create Task' });

/**
 * Fulfil a JWT-expired 401 for every focusos_tasks INSERT the page issues, in the
 * exact shape a live PostgREST would answer with. GET/PATCH/DELETE requests (list
 * loads, other saves) pass straight through untouched.
 */
const routeInsert401Always = async (page: Page) => {
  await page.route('**/rest/v1/focusos_tasks*', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'JWT expired', code: 'PGRST301' }),
    });
  });
};

/** Same 401, but only on the FIRST insert attempt; every later insert goes live. */
const routeInsert401Once = async (page: Page) => {
  let seen = 0;
  await page.route('**/rest/v1/focusos_tasks*', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    seen += 1;
    if (seen === 1) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'JWT expired', code: 'PGRST301' }),
      });
      return;
    }
    await route.continue();
  });
};

/**
 * Poll for a "Task created successfully" sonner toast across a window, so a
 * regression that fires the toast a beat AFTER the assertion point is still
 * caught (asserting once, immediately, is not enough — see the render-phase
 * laws on late/deferred UI in src/pages/Index.tsx).
 */
const successToastAppeared = async (page: Page, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const count = await page.locator('[data-sonner-toast]', { hasText: 'Task created successfully' }).count();
    if (count > 0) return true;
    await page.waitForTimeout(150);
  }
  return false;
};

test.describe('Add Task never reports success on a failed save', () => {
  test('(a) every insert fails auth -> dialog stays open, title intact, inline error shown, no row lands', async ({ page, request }) => {
    test.setTimeout(120_000);
    const s = await restSignIn(request);
    const title = `zz addtask ${Date.now()}`;
    const startCount = await restTaskCount(request, s);

    let bodyError: Error | null = null;
    try {
      await routeInsert401Always(page);
      await signIn(page);
      const titleInput = await openTodayWithAddTask(page);
      await titleInput.fill(title);
      await createTaskButton(page).click();

      // The dialog must never close, the title must never be cleared, and the
      // inline error must appear.
      await expect(page.getByTestId('add-task-save-error'), 'the inline save error must appear').toBeVisible({ timeout: 15000 });
      await expect(titleInput, 'the typed title must survive a failed save').toHaveValue(title);
      await expect(createTaskButton(page), 'the Create Task button must be visible again (dialog still open)').toBeVisible();

      expect(await successToastAppeared(page, 3000), 'no success toast may ever appear on a failed save').toBe(false);

      const rows = await restSelect(request, s, `focusos_tasks?select=id,title&title=eq.${encodeURIComponent(title)}`);
      expect(rows.length, 'a task that never saved must not exist in the database').toBe(0);

      const endCount = await restTaskCount(request, s);
      expect(endCount, 'the account row count must be unchanged').toBe(startCount);
    } catch (e) {
      bodyError = e as Error;
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      const leaks = await cleanupTitle(request, s, title);
      if (bodyError) {
        if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
        throw bodyError;
      }
      expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
    }
  });

  test('(b) the first insert fails, the retry succeeds -> dialog closes, one toast, one row', async ({ page, request }) => {
    test.setTimeout(120_000);
    const s = await restSignIn(request);
    const title = `zz addtask ${Date.now()}`;

    let bodyError: Error | null = null;
    try {
      await routeInsert401Once(page);
      await signIn(page);
      const titleInput = await openTodayWithAddTask(page);
      await titleInput.fill(title);
      await createTaskButton(page).click();

      // Dialog closes: the title field (and the Create Task button with it) leaves
      // the DOM once AddTaskDialog reports success and SidePanel/TouchDialog unmounts.
      await expect(page.locator('#title')).toHaveCount(0, { timeout: 20000 });
      await expect(page.locator('[data-sonner-toast]', { hasText: 'Task created successfully' })).toBeVisible({ timeout: 10000 });

      const rows = await restSelect(request, s, `focusos_tasks?select=id,title&title=eq.${encodeURIComponent(title)}`);
      expect(rows.length, 'exactly one row must have been created after the retry').toBe(1);
    } catch (e) {
      bodyError = e as Error;
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      const leaks = await cleanupTitle(request, s, title);
      if (bodyError) {
        if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
        throw bodyError;
      }
      expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
    }
  });

  test('(c) no interception -> the ordinary save path still works', async ({ page, request }) => {
    test.setTimeout(120_000);
    const s = await restSignIn(request);
    const title = `zz addtask ${Date.now()}`;

    let bodyError: Error | null = null;
    try {
      await signIn(page);
      const titleInput = await openTodayWithAddTask(page);
      await titleInput.fill(title);
      await createTaskButton(page).click();

      await expect(page.locator('#title')).toHaveCount(0, { timeout: 20000 });
      await expect(page.locator('[data-sonner-toast]', { hasText: 'Task created successfully' })).toBeVisible({ timeout: 10000 });

      const rows = await restSelect(request, s, `focusos_tasks?select=id,title&title=eq.${encodeURIComponent(title)}`);
      expect(rows.length, 'exactly one row must have been created').toBe(1);
    } catch (e) {
      bodyError = e as Error;
    } finally {
      const leaks = await cleanupTitle(request, s, title);
      if (bodyError) {
        if (leaks.length) bodyError.message = `${bodyError.message}\n[cleanup leaks] ${leaks.join('; ')}`;
        throw bodyError;
      }
      expect(leaks, 'cleanup must leave the demo account exactly as it was').toEqual([]);
    }
  });
});
