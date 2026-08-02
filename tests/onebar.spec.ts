/**
 * MOBILE ONE-BAR regression suite (.lg-onebar, 2026-08-02).
 *
 * Below Tailwind's `lg` (1024px) the /app top chrome collapses from three
 * stacked bars — .lg-row1 (search + view seg + density seg + Add), the
 * .lg-tabs status TabsList, and the project/special .lg-projbar banner — into
 * ONE glass bar with four slots: context title, status pill, search, Add.
 * At >= 1024px nothing changed: the three bars must still be there and the
 * one-bar must not exist.
 *
 * HERMETIC, like tests/braindump-save.spec.ts: no real Supabase, no signup.
 * The session is seeded into localStorage (seedSession from
 * ./helpers/braindumpEnv) and every PostgREST read is intercepted below with a
 * fixture whose status mix is known, so the pill counts are exactly assertable:
 *
 *   3 todo + 2 in-progress + 1 completed  ->  All 5 / To Do 3 / Progress 2 / Done 1
 *
 * The viewport comes from a per-test context (the shared playwright.config.ts
 * default is a phone), so the same spec covers 393x852, 768x1024 and 1280x900.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PROJECT_REF, USER_ID, USER_EMAIL, seedSession } from './helpers/braindumpEnv';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const PROJECT_NAME = 'Onebar probe project';

const MOBILE = { width: 393, height: 852 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

// Expected counts, derived from the fixture below — the same expressions the
// desktop lg-tabs triggers use (all = status !== 'completed').
const EXPECTED = { all: 5, todo: 3, 'in-progress': 2, completed: 1 };

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
  taskRow(1, 'Onebar todo alpha', 'todo'),
  taskRow(2, 'Onebar todo beta', 'todo'),
  taskRow(3, 'Onebar todo gamma', 'todo'),
  taskRow(4, 'Onebar progress delta', 'in-progress'),
  taskRow(5, 'Onebar progress epsilon', 'in-progress'),
];
const COMPLETED_ROWS = [taskRow(6, 'Onebar done zeta', 'completed')];

const projectRow = () => ({
  id: PROJECT_ID,
  name: PROJECT_NAME,
  color: '#B8572E',
  is_shared: false,
  user_id: USER_ID,
  created_at: new Date(Date.now() - 600_000).toISOString(),
});

const prefRow = () => ({
  id: '55555555-5555-4555-8555-555555555556',
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

/**
 * Boot /app in its own context at `viewport`, pointed at the probe project so a
 * project banner (and therefore the full mobile action set) is in play.
 * Resolves once the task list has painted.
 */
async function openApp(
  browser: Browser,
  viewport: { width: number; height: number },
  search = `?view=${PROJECT_ID}`,
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
  await page.goto(`/app${search}`);
  await expect(page.locator('[data-task-card]').first()).toBeVisible({ timeout: 25_000 });
  return { context, page };
}

/** Tap on touch contexts, click on the desktop one. */
async function press(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector);
  if (page.context() && (await page.evaluate(() => 'ontouchstart' in window))) {
    await el.tap();
  } else {
    await el.click();
  }
}

const PILL = '[data-testid="onebar-status-open"]';
const TITLE = '[data-testid="onebar-title"]';
const SEARCH_BTN = '[data-testid="onebar-search-btn"]';
const SEARCH_FIELD = '[data-testid="onebar-search-field"]';
const SEARCH_CANCEL = '[data-testid="onebar-search-cancel"]';
const ADD = '[data-testid="onebar-add"]';

// ---------------------------------------------------------------------------
// 1 + 2. The bar exists with all four slots, and the three old bars do not,
//        at both sub-lg widths.
// ---------------------------------------------------------------------------
for (const [label, viewport] of [['393x852', MOBILE], ['768x1024', TABLET]] as const) {
  test(`${label}: one bar with four slots replaces the three top bars`, async ({ browser }) => {
    test.setTimeout(90_000);
    const { context, page } = await openApp(browser, viewport);

    await expect(page.locator('.lg-onebar')).toBeVisible();
    await expect(page.locator(TITLE)).toBeVisible();
    await expect(page.locator('[data-testid="onebar-status"]')).toBeVisible();
    await expect(page.locator(SEARCH_BTN)).toBeVisible();
    await expect(page.locator(ADD)).toBeVisible();

    // The bar carries the context title in slot 1.
    await expect(page.locator(TITLE)).toContainText(PROJECT_NAME);

    // The three old bars are all hidden. .lg-tabs stays MOUNTED (Radix Tabs
    // keeps its roving-focus group) but must not be visible.
    await expect(page.locator('.lg-row1')).toBeHidden();
    await expect(page.locator('.lg-tabs')).toBeHidden();
    await expect(page.locator('.lg-tabs')).toHaveCount(1);
    await expect(page.locator('.lg-projbar')).toBeHidden();

    // The TabsContent machinery still renders behind the hidden TabsList.
    await expect(page.locator('.lg-content[data-state="active"]')).toBeVisible();

    // ~52px + the shell gutter: the bar must not eat the screen.
    const box = await page.locator('.lg-onebar').boundingBox();
    expect(box!.height).toBeLessThanOrEqual(56);

    await context.close();
  });
}

// ---------------------------------------------------------------------------
// 3. Status pill: text matches the computed count, the sheet filters the list,
//    and the ✕ resets to All without opening the sheet.
// ---------------------------------------------------------------------------
test('393x852: status pill reads the live count, its sheet filters, ✕ resets', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, MOBILE);

  // The pill's count must equal the expression the desktop tab uses. Computed
  // from the DOM so the assertion cannot drift from the fixture.
  await expect(page.locator(PILL)).toHaveText(`All · ${EXPECTED.all}`);
  await expect(page.locator('[data-task-card]')).toHaveCount(EXPECTED.all);
  // No ✕ while the filter is All.
  await expect(page.locator('[data-testid="onebar-status-clear"]')).toHaveCount(0);

  // Open the status sheet; Done needs the deferred completed hydration, so poll.
  await press(page, PILL);
  await expect(page.locator('[data-testid="onebar-status-sheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="onebar-status-all"]')).toContainText(`All (${EXPECTED.all})`);
  await expect(page.locator('[data-testid="onebar-status-todo"]')).toContainText(`To Do (${EXPECTED.todo})`);
  await expect(page.locator('[data-testid="onebar-status-in-progress"]')).toContainText(
    `Progress (${EXPECTED['in-progress']})`,
  );
  await expect
    .poll(async () => page.locator('[data-testid="onebar-status-completed"]').innerText(), { timeout: 20_000 })
    .toContain(`Done (${EXPECTED.completed})`);

  // Choosing To Do filters the list and closes the sheet.
  await press(page, '[data-testid="onebar-status-todo"]');
  await expect(page.locator('[data-testid="onebar-status-sheet"]')).toHaveCount(0);
  await expect(page.locator(PILL)).toHaveText(`To Do · ${EXPECTED.todo}`);
  await expect(page.locator('[data-task-card]')).toHaveCount(EXPECTED.todo);
  await expect(page.locator('[data-task-card]').first()).toContainText('Onebar todo');

  // ✕ resets to All without opening the sheet.
  await expect(page.locator('[data-testid="onebar-status-clear"]')).toBeVisible();
  await press(page, '[data-testid="onebar-status-clear"]');
  await expect(page.locator('[data-testid="onebar-status-sheet"]')).toHaveCount(0);
  await expect(page.locator(PILL)).toHaveText(`All · ${EXPECTED.all}`);
  await expect(page.locator('[data-task-card]')).toHaveCount(EXPECTED.all);

  await context.close();
});

// ---------------------------------------------------------------------------
// 4. Context sheet: view switching changes the rendered view, Density appears
//    only in list mode (the same condition the desktop lg-density seg uses),
//    and every relocated project action is reachable.
// ---------------------------------------------------------------------------
test('393x852: context sheet switches view, gates density, keeps every banner action', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, MOBILE);

  await press(page, TITLE);
  const sheet = page.locator('[data-testid="onebar-context-sheet"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(PROJECT_NAME);

  // List is current; density rows are present with the current one checked.
  await expect(page.locator('[data-testid="onebar-density-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="onebar-density-compact"] svg')).toHaveCount(1);

  // Nothing the desktop banner offers may be unreachable here.
  for (const action of ['rename', 'reorder', 'meetings', 'invite', 'share', 'delete']) {
    await expect(page.locator(`[data-testid="onebar-${action}"]`)).toBeVisible();
  }

  // Rename opens an inline input inside the sheet (the mobile home of the
  // handleStartEditingProject flow, which used to live in the hidden banner).
  await press(page, '[data-testid="onebar-rename"]');
  await expect(page.locator('[data-testid="onebar-rename-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="onebar-rename-input"]')).toHaveValue(PROJECT_NAME);
  // Escape cancels the rename AND dismisses the sheet (Radix DismissableLayer).
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await press(page, TITLE);
  await expect(sheet).toBeVisible();
  await expect(page.locator('[data-testid="onebar-rename-input"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="onebar-rename"]')).toBeVisible();

  // Switch to Grid: the sheet closes, the list rows go, the grid cards arrive.
  await press(page, '[data-testid="onebar-view-grid"]');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('[data-task-card]')).toHaveCount(0);
  await expect(page.getByText('Onebar todo alpha')).toBeVisible();
  await expect(page.locator('.lg-content.grid[data-state="active"]')).toBeVisible();

  // Density is list-only, exactly as the desktop lg-density seg is.
  await press(page, TITLE);
  await expect(sheet).toBeVisible();
  await expect(page.locator('[data-testid="onebar-view-grid"] svg')).toHaveCount(2); // icon + check
  await expect(page.locator('[data-testid="onebar-density-section"]')).toHaveCount(0);

  // Back to List restores it.
  await press(page, '[data-testid="onebar-view-list"]');
  await expect(page.locator('[data-task-card]')).toHaveCount(EXPECTED.all);
  await press(page, TITLE);
  await expect(page.locator('[data-testid="onebar-density-section"]')).toBeVisible();

  await context.close();
});

// ---------------------------------------------------------------------------
// 5. Search: ONE tap expands the field AND focuses it inside the same handler
//    (WKWebView drops focus taken outside the gesture), Cancel restores the bar
//    without clearing the query, and the collapsed icon shows the live filter.
// ---------------------------------------------------------------------------
test('393x852: search expands with synchronous focus, Cancel restores the bar', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, MOBILE);

  await press(page, SEARCH_BTN);
  await expect(page.locator(SEARCH_FIELD)).toBeVisible();
  // The field must already hold focus — no post-paint effect, no second tap.
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
    'onebar-search-field',
  );
  // The other slots stepped aside for the field.
  await expect(page.locator(TITLE)).toHaveCount(0);
  await expect(page.locator(SEARCH_CANCEL)).toBeVisible();

  await page.locator(SEARCH_FIELD).fill('alpha');
  await expect(page.locator(SEARCH_FIELD)).toHaveValue('alpha');

  await press(page, SEARCH_CANCEL);
  await expect(page.locator(SEARCH_FIELD)).toHaveCount(0);
  await expect(page.locator(TITLE)).toBeVisible();
  await expect(page.locator(ADD)).toBeVisible();
  // Cancel drops focus but deliberately keeps the query (the desktop lg-search
  // has no clear affordance either), so the icon carries an active indicator.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  await expect(page.locator('[data-testid="onebar-search-active"]')).toBeVisible();

  // Reopening shows the retained query.
  await press(page, SEARCH_BTN);
  await expect(page.locator(SEARCH_FIELD)).toHaveValue('alpha');

  await context.close();
});

// ---------------------------------------------------------------------------
// 6. DESKTOP REGRESSION: at >= lg the one-bar must not exist and the three
//    original bars must all still be there.
// ---------------------------------------------------------------------------
test('1280x900: desktop keeps the three bars and never renders the one bar', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, DESKTOP);

  // The bar is CSS-hidden (lg:hidden), never a separate desktop tree: it stays
  // mounted but must contribute nothing visible at >= lg.
  await expect(page.locator('.lg-onebar')).toBeHidden();
  await expect(page.locator(TITLE)).toBeHidden();
  await expect(page.locator(PILL)).toBeHidden();
  expect((await page.locator('.lg-onebar').boundingBox()) ?? null).toBeNull();

  await expect(page.locator('.lg-row1')).toBeVisible();
  await expect(page.locator('.lg-search input')).toBeVisible();
  await expect(page.locator('.lg-seg').first()).toBeVisible();
  await expect(page.locator('.lg-density')).toBeVisible();
  await expect(page.locator('.lg-tabs')).toBeVisible();
  await expect(page.locator('.lg-projbar')).toBeVisible();
  await expect(page.locator('.lg-projbar')).toContainText(PROJECT_NAME);
  await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();

  await context.close();
});

// ---------------------------------------------------------------------------
// 7. Special lists keep their identity and their own two actions on mobile.
// ---------------------------------------------------------------------------
test('393x852: special list shows its label and relocates Move Tasks + Share', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openApp(browser, MOBILE, '?view=today');

  await expect(page.locator(TITLE)).toContainText('Today');
  await expect(page.locator('.lg-projbar')).toBeHidden();

  await press(page, TITLE);
  await expect(page.locator('[data-testid="onebar-context-sheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="onebar-reorder"]')).toBeVisible();
  await expect(page.locator('[data-testid="onebar-share"]')).toBeVisible();
  // Owner-only project actions do not appear for a special list.
  await expect(page.locator('[data-testid="onebar-delete"]')).toHaveCount(0);

  await context.close();
});
