/**
 * OVERLAY PROJECTS DRAWER regression suite (2026-08-03).
 *
 * The dock's Projects button on /home, /meetings and /meetings/:id used to
 * navigate to /app?openSidebar=true, so the BACKGROUND page switched to the
 * last project / Today view before the drawer had even opened. It now opens
 * ProjectsDrawerHost OVER the current page: nothing navigates until a pick is
 * made INSIDE the drawer.
 *
 * HERMETIC, like tests/onebar.spec.ts: seeded localStorage session, every
 * PostgREST read intercepted, no real Supabase. Per-test browser contexts so
 * the same spec covers 393x852 (touch) and 1280x900 (desktop mouse).
 *
 * The drawer's own reads are counted, because overlay mode must ALSO defer its
 * data layer until the first open (perf guard at the bottom).
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { USER_ID, USER_EMAIL, seedSession } from './helpers/braindumpEnv';

const PROJECT_ID = '88888888-8888-4888-8888-888888888888';
const PROJECT_NAME = 'Overlay probe project';
const MEETING_ID = '99999999-9999-4999-8999-999999999999';

const MOBILE = { width: 393, height: 852 };
const DESKTOP = { width: 1280, height: 900 };

const DOCK_PROJECTS = '[data-home-tour-step="projects"]';
const PANEL = '[role="dialog"][aria-label="Projects"]';
const OVERLAY = '.lg-side-overlay';
const FOCUS_CARD = '.lg-upnext';

/**
 * The drawer's OWN four network calls, counted per context.
 *
 * Matched on their exact query signatures, NOT on the table name: /home's
 * usePrefetchAppData already reads focusos_meetings (select=*),
 * focusos_project_members (select=project_id, status=accepted) and
 * focusos_shared_items (the sender key) on page load, so a table-level counter
 * would be green no matter what this component does. Request-log verified
 * 2026-08-03. The drawer's own reads are the slim meetings list, the
 * pending/accepted inbox, the pending invitations, and the RSVP edge sync.
 *
 * (focusos_projects is deliberately absent: the drawer routes through the
 * shared single-flight key the prefetch already warmed, so opening it adds no
 * projects request at all.)
 */
interface DrawerReads {
  meetingsSlim: number;
  inbox: number;
  invitations: number;
  rsvpSync: number;
}

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

const meetingRow = () => ({
  id: MEETING_ID,
  title: 'Overlay probe meeting',
  user_id: USER_ID,
  created_at: new Date(Date.now() - 300_000).toISOString(),
  updated_at: new Date(Date.now() - 300_000).toISOString(),
  duration_seconds: 600,
  summary: null,
  transcript_gcs_path: null,
  action_items: [],
  participants: [],
  project_id: null,
});

const taskRow = (n: number) => ({
  id: `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`,
  title: `Overlay seeded task ${n}`,
  description: null,
  priority: 'medium',
  status: 'todo',
  start_date: null,
  end_date: null,
  due_date: null,
  timer_total_seconds: 0,
  timer_is_running: false,
  timer_start_time: null,
  project_id: null,
  sort_order: n,
  completed_by_email: null,
  assigned_to_email: null,
  change_request_message: null,
  google_calendar_event_id: null,
  created_at: new Date(Date.now() - n * 60_000).toISOString(),
});

async function installIntercepts(context: BrowserContext, reads: DrawerReads): Promise<void> {
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
    const url = decodeURIComponent(req.url());
    const method = req.method();
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const reply = (body: unknown, headers?: Record<string, string>) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      });

    if (method === 'GET') {
      if (url.includes('focusos_meetings') && url.includes('select=id,title')) reads.meetingsSlim += 1;
      if (url.includes('focusos_shared_items') && url.includes('status=in.')) reads.inbox += 1;
      if (url.includes('focusos_project_members') && url.includes('status=eq.pending')) reads.invitations += 1;
    }

    if (url.includes('focusos_meetings')) return reply(wantsObject ? meetingRow() : [meetingRow()]);
    if (url.includes('focusos_project_members')) return reply([]);
    if (url.includes('focusos_shared_items')) return reply([]);

    if (method !== 'GET' && method !== 'HEAD') return reply(wantsObject ? {} : []);
    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_profiles')) {
      return reply(wantsObject ? { first_name: 'Igor' } : [{ first_name: 'Igor' }]);
    }
    if (url.includes('focusos_projects')) return reply(wantsObject ? projectRow() : [projectRow()]);
    if (url.includes('focusos_tasks')) {
      const rows = [taskRow(1), taskRow(2), taskRow(3)];
      return reply(rows, {
        'content-range': `0-${rows.length - 1}/42`,
        'access-control-expose-headers': 'content-range',
      });
    }
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) => {
    if (route.request().url().includes('focusos-sync-shared-rsvp')) reads.rsvpSync += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function openPage(
  browser: Browser,
  viewport: { width: number; height: number },
  url: string,
  ready: string,
): Promise<{ context: BrowserContext; page: Page; reads: DrawerReads }> {
  const touch = viewport.width < 1024;
  const reads: DrawerReads = { meetingsSlim: 0, inbox: 0, invitations: 0, rsvpSync: 0 };
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    timezoneId: 'UTC',
  });
  await installIntercepts(context, reads);
  const page = await context.newPage();
  await seedSession(page);
  await page.goto(url);
  await page.waitForSelector(ready, { timeout: 25_000 });
  return { context, page, reads };
}

/** Tap on touch contexts, click on the desktop one. */
async function press(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector);
  if (await page.evaluate(() => 'ontouchstart' in window)) await el.tap();
  else await el.click();
}

// ---------------------------------------------------------------------------
// 1. Home 393x852: Projects opens the drawer OVER /home. URL unchanged, the
//    Today's Focus card still behind it.
// ---------------------------------------------------------------------------
test('393x852 /home: dock Projects opens the drawer over the page, no navigation', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  // Permanently mounted and closed before the tap (white-flash law).
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');

  const urlBefore = page.url();
  await press(page, DOCK_PROJECTS);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  await expect(page.locator(PANEL)).toBeVisible();
  // The URL is byte-identical to before the tap: no route change, and above all
  // no ?openSidebar=true handshake into /app.
  expect(page.url(), 'URL untouched by opening the drawer').toBe(urlBefore);
  expect(page.url()).not.toContain('openSidebar');
  // The background page never changed.
  await expect(page.locator(FOCUS_CARD)).toBeVisible();

  await context.close();
});

// ---------------------------------------------------------------------------
// 2 + 3. Picks inside the drawer navigate to the /app deep links.
// ---------------------------------------------------------------------------
test('393x852 /home: picking a project navigates to /app?view=<id>', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  await press(page, `${PANEL} button:has-text("${PROJECT_NAME}")`);

  await expect
    .poll(() => new URL(page.url()).pathname + new URL(page.url()).search, { timeout: 15_000 })
    .toBe(`/app?view=${PROJECT_ID}`);

  await context.close();
});

test('393x852 /home: picking Today navigates to /app?view=today', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  await press(page, `${PANEL} button:has-text("Today")`);

  await expect
    .poll(() => new URL(page.url()).pathname + new URL(page.url()).search, { timeout: 15_000 })
    .toBe('/app?view=today');

  await context.close();
});

// ---------------------------------------------------------------------------
// 4. Closing leaves the user exactly where they were.
// ---------------------------------------------------------------------------
test('393x852 /home: tapping the overlay closes the drawer and stays on /home', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  // Top-right, always outside the 280px left panel: lands on the overlay. A
  // real pointerdown + click pair, which is what the ghost-click latch demands.
  await page.touchscreen.tap(360, 200);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  expect(new URL(page.url()).pathname, 'still on /home').toBe('/home');
  await expect(page.locator(FOCUS_CARD)).toBeVisible();

  await context.close();
});

// ---------------------------------------------------------------------------
// 5. Same behaviour on /meetings.
// ---------------------------------------------------------------------------
test('393x852 /meetings: dock Projects opens the drawer over the page', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/meetings', DOCK_PROJECTS);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  await press(page, DOCK_PROJECTS);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(new URL(page.url()).pathname, 'still on /meetings').toBe('/meetings');

  await context.close();
});

test('393x852 /meetings/:id: dock Projects opens the drawer over the meeting', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, `/meetings/${MEETING_ID}`, DOCK_PROJECTS);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  await press(page, DOCK_PROJECTS);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(new URL(page.url()).pathname, 'still on the meeting').toBe(`/meetings/${MEETING_ID}`);

  await context.close();
});

// ---------------------------------------------------------------------------
// 6. Desktop: the SAME overlay panel (not the in-flow /app sidebar), URL fixed.
// ---------------------------------------------------------------------------
test('1280x900 /home: Projects opens the overlay panel, URL stays /home', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, DESKTOP, '/home?fakedump=0', FOCUS_CARD);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  await press(page, DOCK_PROJECTS);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(new URL(page.url()).pathname, 'still on /home').toBe('/home');
  await expect(page.locator(FOCUS_CARD)).toBeVisible();

  // It really is the portalled overlay construct, and it really is on top.
  await expect(page.locator(OVERLAY)).toHaveAttribute('data-state', 'open');
  const parentIsBody = await page.locator(PANEL).evaluate((el) => el.parentElement === document.body);
  expect(parentIsBody, 'panel portals to <body> (backdrop-filter containing-block law)').toBe(true);
  const box = await page.locator(PANEL).boundingBox();
  expect(Math.round(box!.width), 'the 280px drawer, not the in-flow sidebar').toBe(280);

  await context.close();
});

// ---------------------------------------------------------------------------
// 7. /app regression: Projects still toggles the existing sidebar, and the
//    overlay drawer is NOT double-mounted there.
// ---------------------------------------------------------------------------
test('393x852 /app: Projects still toggles the existing drawer, exactly one panel', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, `/app?view=${PROJECT_ID}`, PANEL);

  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(new URL(page.url()).pathname, 'no navigation on /app either').toBe('/app');

  // Toggle shut again from the dock's location (the open overlay covers it —
  // documented behaviour, tests/drawer.spec.ts).
  await page.touchscreen.tap(360, 200);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  await expect(page.locator(PANEL)).toHaveCount(1);

  await context.close();
});

// ---------------------------------------------------------------------------
// 8. PERF guard: the drawer's own data layer must not touch the network until
//    the drawer is first opened.
// ---------------------------------------------------------------------------
test('393x852 /home: drawer fetches nothing until it is first opened', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page, reads } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  // Well past the 3s deferred RSVP sync and any settling refetch.
  await page.waitForTimeout(5_000);
  expect(reads.meetingsSlim, 'no slim meetings read on a closed drawer').toBe(0);
  expect(reads.inbox, 'no shared-items inbox read on a closed drawer').toBe(0);
  expect(reads.invitations, 'no invitations read on a closed drawer').toBe(0);
  expect(reads.rsvpSync, 'no RSVP edge sync on a closed drawer').toBe(0);

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  // Opening arms the data layer: all four now fire.
  await expect.poll(() => reads.meetingsSlim, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => reads.inbox, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => reads.invitations, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => reads.rsvpSync, { timeout: 15_000 }).toBeGreaterThan(0);
  // And the list it fetched is really there.
  await expect(page.locator(`${PANEL} button:has-text("${PROJECT_NAME}")`)).toBeVisible();

  await context.close();
});
