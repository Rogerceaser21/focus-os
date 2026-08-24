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

const NEW_PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_PROJECT_NAME = 'Fresh overlay project';

/** Mutable server state for the write-flow specs. */
interface Harness {
  reads: DrawerReads;
  /** Rows GET focusos_projects returns; a POST appends to it. */
  projects: any[];
  /** True once a project has been created through the UI. */
  projectInserted: boolean;
  /**
   * Stall applied to GET focusos_projects AFTER an insert. It models the only thing
   * that matters for the create-then-navigate race: /app reaching first paint before
   * the (unawaited) fresh projects fetch has landed. With the stall, the ONLY way /app
   * can know the new project is the cache seed the create handler writes.
   */
  postInsertGetStallMs: number;
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

async function installIntercepts(context: BrowserContext, h: Harness): Promise<void> {
  const reads = h.reads;
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

  await context.route('**/rest/v1/**', async (route) => {
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

    if (method !== 'GET' && method !== 'HEAD') {
      // Project create: return the inserted row (the app reads its id) and remember it
      // as server state, exactly like the real insert+select round trip.
      if (url.includes('focusos_projects')) {
        let name = NEW_PROJECT_NAME;
        try {
          const body = req.postDataJSON();
          name = (Array.isArray(body) ? body[0]?.name : body?.name) ?? name;
        } catch { /* keep the default */ }
        const row = {
          id: NEW_PROJECT_ID,
          name,
          color: '#3b82f6',
          is_shared: false,
          user_id: USER_ID,
          created_at: new Date().toISOString(),
        };
        h.projects = [row, ...h.projects];
        h.projectInserted = true;
        return reply(wantsObject ? row : [row]);
      }
      // Task create (the Tasks tour seeds its demo task through this path).
      if (url.includes('focusos_tasks')) {
        const row = { ...taskRow(9), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Plan Holidays' };
        return reply(wantsObject ? row : [row]);
      }
      // The wallpaper sync pushes a silent PATCH here; PostgREST echoes the full
      // updated row, so the harness must too (an `{}` echo wipes the tour flags
      // from the cache and relaunches the tours over the drawer). Same line as
      // tests/helpers/braindumpEnv.ts.
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
      return reply(wantsObject ? {} : []);
    }
    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_profiles')) {
      return reply(wantsObject ? { first_name: 'Igor' } : [{ first_name: 'Igor' }]);
    }
    if (url.includes('focusos_projects')) {
      if (h.projectInserted && h.postInsertGetStallMs > 0) {
        await new Promise((r) => setTimeout(r, h.postInsertGetStallMs));
      }
      return reply(wantsObject ? h.projects[0] : h.projects);
    }
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
  opts?: { postInsertGetStallMs?: number },
): Promise<{ context: BrowserContext; page: Page; reads: DrawerReads; harness: Harness }> {
  const touch = viewport.width < 1024;
  const harness: Harness = {
    reads: { meetingsSlim: 0, inbox: 0, invitations: 0, rsvpSync: 0 },
    projects: [projectRow()],
    projectInserted: false,
    postInsertGetStallMs: opts?.postInsertGetStallMs ?? 0,
  };
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    timezoneId: 'UTC',
  });
  await installIntercepts(context, harness);
  const page = await context.newPage();
  await seedSession(page);
  await page.goto(url);
  await page.waitForSelector(ready, { timeout: 25_000 });
  return { context, page, reads: harness.reads, harness };
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

// ===========================================================================
// Review round 2 (adversarial review of 83fdc5f) — the four majors + FAB minor.
// ===========================================================================

// ---------------------------------------------------------------------------
// MAJOR 1. Creating a project from the overlay lands IN that project, not Today.
//
// handleCreateProject fires its refresh unawaited and navigates in the same tick;
// /app seeds during render from the shared projects cache, so without the cache
// seed the new id is missing on arrival and Index's deleted-project fallback
// resets the view to Today. The harness stalls every projects GET after the
// insert, so the seed is the only possible source of truth at first paint.
// ---------------------------------------------------------------------------
test('393x852 /home: creating a project from the drawer lands in that project, not Today', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD, {
    postInsertGetStallMs: 2_500,
  });

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  await press(page, `${PANEL} button:has-text("New Project")`);
  await page.locator('#project-name').fill(NEW_PROJECT_NAME);
  await press(page, 'button:has-text("Create Project")');

  await expect
    .poll(() => new URL(page.url()).pathname + new URL(page.url()).search, { timeout: 15_000 })
    .toBe(`/app?view=${NEW_PROJECT_ID}`);

  // Inside the stall window: the only way this title can be right is the cache seed.
  await expect(page.locator('[data-testid="onebar-title"]')).toContainText(NEW_PROJECT_NAME, {
    timeout: 2_000,
  });

  // And it stays put once the real (stalled) list finally lands — no late bounce.
  await page.waitForTimeout(3_500);
  await expect(page.locator('[data-testid="onebar-title"]')).toContainText(NEW_PROJECT_NAME);
  expect(page.url(), 'still the project deep link').toContain(`view=${NEW_PROJECT_ID}`);

  await context.close();
});

// ---------------------------------------------------------------------------
// MAJOR 2a. A closed drawer is not in the tab order. aria-hidden alone does not
// do this — only `inert` does.
// ---------------------------------------------------------------------------
test('393x852 /home: Tab never walks into the closed drawer', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  // Proof the attribute really reached the DOM (React 18 knows nothing about inert).
  expect(await page.locator(PANEL).getAttribute('inert'), 'panel inert while closed').not.toBeNull();
  expect(await page.locator(OVERLAY).getAttribute('inert'), 'overlay inert while closed').not.toBeNull();

  const insideHits: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"][aria-label="Projects"]');
      const active = document.activeElement as HTMLElement | null;
      if (!panel || !active) return null;
      return panel.contains(active) ? active.outerHTML.slice(0, 80) : null;
    });
    if (hit) insideHits.push(hit);
  }
  expect(insideHits, 'focus never entered the closed panel').toEqual([]);

  // Sanity: once open, the panel IS reachable — the guard is state-driven, not a wall.
  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  expect(await page.locator(PANEL).getAttribute('inert'), 'inert lifted when open').toBeNull();

  await context.close();
});

// ---------------------------------------------------------------------------
// MAJOR 2b. Closing with focus INSIDE the drawer: focus must leave first, or
// Chrome refuses to apply aria-hidden ('retained focus') and the drawer stays
// in the a11y tree.
// ---------------------------------------------------------------------------
test('393x852 /home: Escape with focus in the drawer moves focus out and hides it', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  // Focus the drawer's own search field.
  await page.locator(`${PANEL} input[placeholder="Search projects & meetings..."]`).focus();
  expect(
    await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"][aria-label="Projects"]');
      return !!(panel && document.activeElement && panel.contains(document.activeElement));
    }),
    'focus really is inside the drawer',
  ).toBe(true);

  await page.keyboard.press('Escape');

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  expect(await page.locator(PANEL).getAttribute('aria-hidden'), 'aria-hidden applied').toBe('true');
  expect(
    await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"][aria-label="Projects"]');
      return !!(panel && document.activeElement && panel.contains(document.activeElement));
    }),
    'focus left the panel',
  ).toBe(false);
  expect(new URL(page.url()).pathname, 'Escape does not navigate').toBe('/home');

  await context.close();
});

// ---------------------------------------------------------------------------
// MAJOR 3. The Help menu's Tasks Tour really starts the tour on /app instead of
// dead-ending in a false 'Coming soon!' toast.
// ---------------------------------------------------------------------------
test('393x852 /home: Tasks Tour from the drawer starts the tour on /app', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  await press(page, `${PANEL} button:has-text("Help")`);
  await press(page, '[role="menuitem"]:has-text("Tasks Tour")');

  // No lie: the "coming soon" toast must never appear.
  await expect(page.locator('text=Coming soon!')).toHaveCount(0);

  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/app');
  // The tour is actually running (its spotlight mask is in the DOM)…
  await expect(page.locator('#task-spotlight-mask')).toHaveCount(1, { timeout: 20_000 });
  // …and the handshake param was stripped, one-shot style.
  expect(page.url(), 'tour param stripped').not.toContain('tour=');

  await context.close();
});

// ---------------------------------------------------------------------------
// MAJOR 4. Home Tour tapped from the drawer while already on /home: the drawer
// must get out of the way of the tour it just launched.
// ---------------------------------------------------------------------------
test('393x852 /home: Home Tour from the drawer closes the drawer and runs', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/home?fakedump=0', FOCUS_CARD);

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');

  await press(page, `${PANEL} button:has-text("Help")`);
  await press(page, '[role="menuitem"]:has-text("Home Tour")');

  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  await expect(page.locator('#home-spotlight-mask')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator(PANEL), 'still closed once the tour is up').toHaveAttribute('data-state', 'closed');

  await context.close();
});

// ---------------------------------------------------------------------------
// MINOR A. The z-100 record FAB is not portalled, so it must hide behind the
// open drawer — the same guard /app already applies to its sheets.
// ---------------------------------------------------------------------------
test('393x852 /meetings: the record FAB hides behind the open drawer', async ({ browser }) => {
  test.setTimeout(90_000);
  const { context, page } = await openPage(browser, MOBILE, '/meetings', DOCK_PROJECTS);

  await expect(page.locator('[data-tour-step="menu-fab"]')).toBeVisible();

  await press(page, DOCK_PROJECTS);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'open');
  await expect(page.locator('[data-tour-step="menu-fab"]'), 'FAB gone while the drawer is open').toHaveCount(0);

  await page.touchscreen.tap(360, 200);
  await expect(page.locator(PANEL)).toHaveAttribute('data-state', 'closed');
  await expect(page.locator('[data-tour-step="menu-fab"]'), 'FAB back after close').toBeVisible();

  await context.close();
});
