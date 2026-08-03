/**
 * DOCKED PANE GEOMETRY suite (.lg-pane-open, 2026-08-03).
 *
 * On desktop /app the Create/Edit Task pane is not a modal: Index.tsx renders
 * EditTaskDialog / AddTaskDialog with `desktopDocked`, which renders SidePanel,
 * and the liquid-glass rule `.liquid-glass [data-side-panel]` lifts that panel
 * to `position: fixed` (top/right/bottom 14px, width 380px, z-index 45). Fixed
 * means it takes no space in the flex row, so it floated OVER the task list and
 * hid the right edge of every card.
 *
 * The fix keeps the floating pane byte-identical and instead has the /app
 * content column (.lg-maincol — the one container every view mode renders
 * inside) reserve the pane's width while a docked pane is open. These tests are
 * therefore pure GEOMETRY: the pane's box and the visible task-list container's
 * box must never intersect, and the column must return to its old width on
 * close.
 *
 * HERMETIC, like tests/onebar.spec.ts: no real Supabase, no signup. The session
 * is seeded into localStorage (seedSession from ./helpers/braindumpEnv) and
 * every PostgREST read is intercepted with a fixed fixture.
 *
 * The viewport comes from a per-test context (the shared playwright.config.ts
 * default is a phone), so the same spec covers 1280x900 and 393x852.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { USER_ID, USER_EMAIL, seedSession } from './helpers/braindumpEnv';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const PROJECT_NAME = 'Paneflow probe project';

const MOBILE = { width: 393, height: 852 };
const DESKTOP = { width: 1280, height: 900 };

function todayNoonIso(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

const taskRow = (n: number, title: string, status: string) => ({
  id: `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`,
  title,
  description: null,
  priority: 'medium',
  status,
  start_date: null,
  end_date: null,
  due_date: todayNoonIso(),
  timer_total_seconds: 0,
  timer_is_running: false,
  timer_start_time: null,
  project_id: PROJECT_ID,
  sort_order: n,
  completed_by_email: null,
  assigned_to_email: null,
  change_request_message: null,
  google_calendar_event_id: null,
  created_at: new Date(Date.now() - n * 60_000).toISOString(),
});

const OPEN_ROWS = [
  taskRow(1, 'Paneflow todo alpha', 'todo'),
  taskRow(2, 'Paneflow todo beta', 'todo'),
  taskRow(3, 'Paneflow progress gamma', 'in-progress'),
];
const COMPLETED_ROWS: ReturnType<typeof taskRow>[] = [];

const projectRow = () => ({
  id: PROJECT_ID,
  name: PROJECT_NAME,
  color: '#B8572E',
  is_shared: false,
  user_id: USER_ID,
  created_at: new Date(Date.now() - 600_000).toISOString(),
});

const prefRow = () => ({
  id: '55555555-5555-4555-8555-555555555557',
  user_id: USER_ID,
  default_view: 'today',
  default_display_mode: 'list',
  default_task_filter: 'all',
  default_task_card_view: 'compact',
  default_task_card_view_mobile: 'compact',
  theme: 'liquid-glass',
  has_completed_onboarding: true,
  has_completed_task_tour: true,
  has_completed_projects_tour: true,
  has_completed_home_tour: true,
  has_completed_meetings_tour: true,
});

async function installIntercepts(context: BrowserContext): Promise<void> {
  await context.route('**/auth/v1/**', (route) => {
    const user = {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: USER_EMAIL,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    };
    if (route.request().url().includes('/auth/v1/user')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'probe-refreshed',
        refresh_token: 'probe-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      }),
    });
  });

  await context.route('**/rest/v1/**', (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (method !== 'GET' && method !== 'HEAD') {
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
      return reply(wantsObject ? {} : []);
    }
    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_tasks')) {
      if (url.includes('status=neq.completed')) return reply(OPEN_ROWS);
      if (url.includes('status=eq.completed')) return reply(COMPLETED_ROWS);
      return reply([]); // deferred image hydration
    }
    if (url.includes('focusos_projects')) return reply([projectRow()]);
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/** Boot /app in its own context at `viewport`, resolved once the list painted. */
async function openApp(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const touch = viewport.width < 1024;
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    timezoneId: 'UTC',
  });
  await installIntercepts(context);
  const page = await context.newPage();
  await seedSession(page);
  await page.goto(`/app?view=${PROJECT_ID}`);
  await expect(page.locator('[data-task-card]').first()).toBeVisible({ timeout: 25_000 });
  return { context, page };
}

type Box = { x: number; y: number; width: number; height: number };

const PANE = '[data-side-panel]';
/** SidePanel's own close X. Structural, because the panel TITLE also carries
 *  buttons (hand-off, share) and the X itself has no accessible name — the
 *  header is the panel's first child, the X its only direct button child. */
const PANE_CLOSE = '[data-side-panel] > div:first-child > button';
/** The task-list container of whichever view mode is on screen. Radix hides the
 *  inactive TabsContent siblings, so exactly one .lg-content is ever visible. */
const CONTENT = '.lg-content:visible';

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * THE spec, in one place: the list container must end at or before the pane
 * starts, and the two boxes must not intersect. Polled, because the column
 * animates its reservation (300ms) — the poll is also what fails, loudly and
 * with numbers, when no reservation exists at all.
 */
async function expectNoOverlap(page: Page, label: string): Promise<void> {
  await expect(page.locator(PANE)).toBeVisible();
  const pane = await box(page, PANE);
  await expect
    .poll(async () => Math.round((await box(page, CONTENT)).x + (await box(page, CONTENT)).width), {
      timeout: 6_000,
      message: `${label}: task-list right edge must not run under the docked pane (pane left = ${Math.round(pane.x)})`,
    })
    .toBeLessThanOrEqual(Math.round(pane.x));
  expect(intersects(await box(page, CONTENT), pane), `${label}: pane must not cover the task list`).toBe(false);
}

/** The single visible "Edit task" pencil on the first row (both layout branches
 *  are in the DOM; only one is displayed at a given width). */
function editButton(page: Page) {
  return page.locator('[data-task-card]').first().locator('[title="Edit task"]:visible').first();
}

// ---------------------------------------------------------------------------
// 1. Edit pane: reserves space rather than covering the list, and gives the
//    width back on close.
// ---------------------------------------------------------------------------
test('1280x900: the docked Edit pane reserves space instead of covering the task list', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, DESKTOP);

  const before = await box(page, CONTENT);
  await expect(page.locator(PANE)).toHaveCount(0);

  await page.locator('[data-task-card]').first().hover();
  await editButton(page).click();

  await expectNoOverlap(page, 'edit pane');

  // The reservation is what moved, so the column must actually be narrower.
  const open = await box(page, CONTENT);
  expect(open.width).toBeLessThan(before.width);

  // Closing restores the original width exactly.
  await page.locator(PANE_CLOSE).click();
  await expect(page.locator(PANE)).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await box(page, CONTENT)).width), { timeout: 6_000 })
    .toBe(Math.round(before.width));

  await context.close();
});

// ---------------------------------------------------------------------------
// 2. Create pane: same geometry, opened from the desktop Add Task button.
// ---------------------------------------------------------------------------
test('1280x900: the docked Create pane reserves space instead of covering the task list', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, DESKTOP);

  const before = await box(page, CONTENT);
  await page.getByRole('button', { name: 'Add task' }).click();

  await expectNoOverlap(page, 'create pane');
  expect((await box(page, CONTENT)).width).toBeLessThan(before.width);

  await page.locator(PANE_CLOSE).click();
  await expect(page.locator(PANE)).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await box(page, CONTENT)).width), { timeout: 6_000 })
    .toBe(Math.round(before.width));

  await context.close();
});

// ---------------------------------------------------------------------------
// 3. The reservation belongs to the container ALL view modes share: grid holds
//    it, and switching modes while the pane is open keeps it.
// ---------------------------------------------------------------------------
test('1280x900: grid view keeps the reservation, and switching modes with the pane open keeps it', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, DESKTOP);

  await page.locator('.lg-row1 .lg-seg button:has-text("Grid")').click();
  await expect(page.locator('.lg-content.grid:visible')).toBeVisible();

  await page.getByRole('button', { name: 'Add task' }).click();
  await expectNoOverlap(page, 'grid + create pane');

  // Switch view mode with the pane still open — only possible at all because the
  // row1 controls are no longer underneath it.
  await page.locator('.lg-row1 .lg-seg button:has-text("Gantt")').click();
  await expectNoOverlap(page, 'gantt + create pane');

  await page.locator('.lg-row1 .lg-seg button:has-text("List")').click();
  await expect(page.locator('[data-task-card]').first()).toBeVisible();
  await expectNoOverlap(page, 'list + create pane');

  await context.close();
});

// ---------------------------------------------------------------------------
// 4. MOBILE REGRESSION: below lg the pane is the Radix dialog/sheet path, never
//    docked, so nothing may reserve space or shift the content column.
// ---------------------------------------------------------------------------
test('393x852: opening a task uses the dialog path and never shifts the content column', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, MOBILE);

  const before = await box(page, CONTENT);

  // Both layout branches (mobile + desktop) are in the DOM; only one is shown.
  await page.locator('[data-task-card]').first().locator('h3:visible').first().tap();
  await expect(page.locator('.lg-editsheet')).toBeVisible();

  // No docked pane exists at this width, and the column is untouched.
  await expect(page.locator(PANE)).toHaveCount(0);
  await expect(page.locator('.lg-maincol.lg-pane-open')).toHaveCount(0);
  await page.waitForTimeout(400); // long enough for any reservation transition to land
  const after = await box(page, CONTENT);
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  expect(Math.round(after.x)).toBe(Math.round(before.x));

  await context.close();
});
