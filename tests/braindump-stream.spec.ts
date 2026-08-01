/**
 * Live brain-dump stream regression (Fix A, 2026-07-27).
 *
 * The bug: while recording, .lg-hero-col.rec double-booked the bottom of the
 * 100svh hero column (standalone padding-bottom 110 + 2*env, PLUS the actions'
 * 108px margin-bottom = 286px reserved for a 68px dock band). .lg-stream is the
 * only flex item with an automatic minimum size of 0 (overflow-y:auto, CSS
 * Flexbox 4.5), so it absorbed the whole deficit and collapsed to ~1 visible
 * row — and with tasks appended newest-LAST and no auto-scroll anywhere, every
 * new task landed below the fold, invisible.
 *
 * This spec is HERMETIC — no Gemini, no microphone, no real Supabase. Auth is a
 * seeded localStorage session plus intercepted /auth/v1 and PostgREST (same
 * strategy as tests/braindump-save.spec.ts). The recording stage is driven by
 * the URL-param harness `?fakedump=N` (src/pages/Home.tsx), which puts Home in
 * the .rec visual state and streams N synthetic tasks in at 700ms intervals.
 *
 * Standalone geometry is reproduced the way the app itself decides it: the
 * matchMedia('(display-mode: browser)') probe main.tsx reads is stubbed to
 * false, so main.tsx adds html.standalone on its own.
 *
 * CAVEAT (stated, not buried): Chromium has no safe-area insets and no ICB
 * shortfall, so env(safe-area-inset-*) is 0 here and 100lvh === 100svh. The
 * standalone budget therefore evaluates to its full 78px in this rig and to
 * 78 - 59 = 19px on a real 393x852 icon-app. The clearance assertion below is
 * the invariant that holds in both; the absolute pixel heights are not.
 *
 * Bisect proof (house law): set BISECT_DISABLE_FOLLOW = true in
 * src/hooks/useStickToBottom.ts and the "newest task is visible" assertion
 * FAILS; set it back and it passes.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const PROJECT_REF = 'mshlbsgsyzzfxyxramjj';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'stream.probe@example.test';
const BASE_PROJECT_ID = '22222222-2222-4222-8222-222222222222';

/** The floor .lg-hero-col.rec .lg-stream declares (index.css). */
const STREAM_FLOOR_PX = 380;
/** The clearance the Stop/Save row must keep above the dock (--sp-gap is 10). */
const MIN_DOCK_CLEARANCE_PX = 8;

function seedSession(page: Page) {
  return page.addInitScript(
    ({ ref, userId, email }) => {
      const b64 = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
        sub: userId,
        email,
        aud: 'authenticated',
        role: 'authenticated',
        exp: expiresAt,
      })}.probe-signature`;
      const user = {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: new Date(0).toISOString(),
      };
      localStorage.setItem(
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: jwt,
          refresh_token: 'probe-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: expiresAt,
          user,
        }),
      );
    },
    { ref: PROJECT_REF, userId: USER_ID, email: USER_EMAIL },
  );
}

/**
 * Make main.tsx's own standalone detection fire, rather than stamping the class
 * ourselves. Since 2026-07-30 (iOS shell wave, commit dba836f) main.tsx no
 * longer has the notBrowser clause — the honoured signals are
 * `(display-mode: standalone)` / `(display-mode: fullscreen)` /
 * `navigator.standalone` / `window.__FOCUSOS_SHELL__`. Spoof the first one:
 * this rig emulates the Safari A2HS icon-app (NOT the shell, which would also
 * add html.shell and change the geometry under test).
 */
function forceStandalone(page: Page) {
  return page.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) => {
      const mql = orig(query);
      if (query !== '(display-mode: standalone)') return mql;
      return new Proxy(mql, {
        get(target, prop) {
          if (prop === 'matches') return true;
          const value = (target as never)[prop];
          return typeof value === 'function' ? (value as () => void).bind(target) : value;
        },
      });
    }) as typeof window.matchMedia;
  });
}

async function installIntercepts(context: BrowserContext) {
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
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    // A returning user: has_completed_home_tour true. Without it HomeTour opens
    // and scrolls the overflow:hidden hero column, which is a separate artifact
    // (it lifts the greeting ~32px off the top) and would mask this one.
    if (url.includes('focusos_user_preferences')) {
      const prefs = {
        id: '55555555-5555-4555-8555-555555555555',
        user_id: USER_ID,
        default_view: 'today',
        default_display_mode: 'list',
        default_task_filter: 'all',
        default_task_card_view: 'compact',
        default_task_card_view_mobile: 'minimal',
        theme: 'liquid-glass',
        has_completed_onboarding: true,
        has_completed_task_tour: true,
        has_completed_projects_tour: true,
        has_completed_home_tour: true,
        has_completed_meetings_tour: true,
      };
      return reply(wantsObject ? prefs : [prefs]);
    }
    if (url.includes('focusos_profiles')) return reply(wantsObject ? { first_name: 'Igor' } : [{ first_name: 'Igor' }]);
    if (url.includes('focusos_projects')) {
      const row = { id: BASE_PROJECT_ID, name: 'Baseline project', color: '#B8572E' };
      return reply(wantsObject ? row : [row]);
    }
    if (url.includes('focusos_tasks')) {
      // One open task, so the Up Next card really exists and its .rec lifecycle
      // (absolute + faded out) is exercised rather than sidestepped.
      const row = {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Baseline task alpha',
        status: 'todo',
        due_date: null,
        project_id: BASE_PROJECT_ID,
      };
      return reply(wantsObject ? row : [row]);
    }
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

interface StandaloneOpts {
  width: number;
  height: number;
  standalone?: boolean;
  mobile?: boolean;
}

async function openHome(browser: Browser, url: string, opts: StandaloneOpts) {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    isMobile: opts.mobile ?? true,
    hasTouch: opts.mobile ?? true,
    timezoneId: 'UTC',
  });
  await installIntercepts(context);
  const page = await context.newPage();
  await seedSession(page);
  if (opts.standalone) await forceStandalone(page);
  await page.goto(url);
  await page.waitForSelector('.lg-hero-col.rec', { timeout: 20_000 });
  return { context, page };
}

/** Everything the geometry assertions need, read in one pass. */
function readStage(page: Page) {
  return page.evaluate(() => {
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
    };
    const stream = document.querySelector('.lg-stream') as HTMLElement;
    const rows = [...document.querySelectorAll('.lg-stask')];
    const last = rows[rows.length - 1] as HTMLElement | undefined;
    const lastRect = last?.getBoundingClientRect();
    const streamRect = stream.getBoundingClientRect();
    const upnext = document.querySelector('.lg-upnext');
    return {
      standalone: document.documentElement.classList.contains('standalone'),
      innerHeight: window.innerHeight,
      streamClientHeight: stream.clientHeight,
      streamScrollHeight: stream.scrollHeight,
      streamScrollTop: stream.scrollTop,
      streamMinHeight: getComputedStyle(stream).minHeight,
      streamRect: { top: streamRect.top, bottom: streamRect.bottom },
      rowCount: rows.length,
      lastRowText: last?.textContent ?? '',
      lastRowTop: lastRect?.top ?? null,
      lastRowBottom: lastRect?.bottom ?? null,
      recbtns: rect('.lg-recbtns'),
      stop: rect('.lg-recbtns .lg-btn'),
      save: rect('.lg-recbtns .lg-btn.acc'),
      dock: rect('.lg-dock'),
      help: rect('button[aria-label="Take the Home tour"]'),
      orbHeight: rect('.lg-orb')?.height ?? 0,
      greetingTop: rect('.lg-hero-col > div:first-child')?.top ?? null,
      upnextPosition: upnext ? getComputedStyle(upnext).position : null,
      upnextOpacity: upnext ? getComputedStyle(upnext).opacity : null,
      jumpPillVisible: !!document.querySelector('.lg-stream-jump'),
      logRole: document.querySelector('.lg-stream-list')?.getAttribute('role') ?? null,
    };
  });
}

test.describe('brain dump live stream — 393x852 standalone', () => {
  test('stream keeps its floor, follows the newest task, and clears the dock', async ({ browser }) => {
    test.setTimeout(90_000);
    const { context, page } = await openHome(browser, '/home?fakedump=8', {
      width: 393,
      height: 852,
      standalone: true,
    });

    // All 8 synthetic tasks streamed in (700ms apart), then let the scroll settle.
    await expect.poll(() => page.locator('.lg-stask').count(), { timeout: 30_000 }).toBe(8);
    await page.waitForTimeout(600);
    const s = await readStage(page);

    expect(s.standalone, 'standalone geometry is active').toBe(true);

    // (a) the stream is not starved
    expect(s.streamMinHeight, 'floor declared').toBe(`${STREAM_FLOOR_PX}px`);
    expect(
      s.streamClientHeight,
      `stream height ${s.streamClientHeight} >= floor ${STREAM_FLOOR_PX}`,
    ).toBeGreaterThanOrEqual(STREAM_FLOOR_PX);
    // ...and it is genuinely a scroll box with more content than fits, i.e. the
    // follow behaviour below is being exercised rather than trivially satisfied.
    expect(s.streamScrollHeight, 'content overflows the box').toBeGreaterThan(s.streamClientHeight);

    // (b) the newest task is inside the visible box, scroll settled at the bottom
    expect(s.lastRowText, 'newest task is the 8th').toContain('8.');
    expect(s.streamScrollTop, 'scrolled to the bottom').toBeCloseTo(
      s.streamScrollHeight - s.streamClientHeight,
      0,
    );
    expect(s.lastRowTop!, 'newest task below the top edge').toBeGreaterThanOrEqual(s.streamRect.top - 0.5);
    expect(s.lastRowBottom!, 'newest task above the bottom edge').toBeLessThanOrEqual(
      s.streamRect.bottom + 0.5,
    );

    // (d) Stop / Save clear the dock band
    expect(s.stop!.bottom, 'Stop clears the dock').toBeLessThanOrEqual(s.dock!.top - MIN_DOCK_CLEARANCE_PX);
    expect(s.save!.bottom, 'Save clears the dock').toBeLessThanOrEqual(s.dock!.top - MIN_DOCK_CLEARANCE_PX);
    // Step-1 Dynamic Bar prep (2026-08-01): the tour button lives in the idle
    // row beside Record Meeting and unmounts during recording (same swap as
    // that button), so a collision with Stop/Save is structurally impossible.
    expect(s.help, 'tour button is unmounted while recording').toBeNull();

    // laws that must survive the change
    expect(s.greetingTop!, 'greeting still on screen').toBeGreaterThanOrEqual(0);
    expect(s.orbHeight, 'orb is still >= 118px').toBeGreaterThanOrEqual(118);
    expect(s.upnextPosition, 'up-next overlay still absolute while recording').toBe('absolute');
    expect(s.upnextOpacity, 'up-next overlay still faded out').toBe('0');
    expect(s.logRole, 'stream list is a polite live region').toBe('log');

    await context.close();
  });

  test('scrolling up unpins: no yank, jump-to-latest returns to the bottom', async ({ browser }) => {
    test.setTimeout(90_000);
    // 14 tasks: the box only starts overflowing at ~7 rows, so a longer stream is
    // needed for "scroll up, then more tasks arrive" to be a real scenario.
    const { context, page } = await openHome(browser, '/home?fakedump=14', {
      width: 393,
      height: 852,
      standalone: true,
    });

    await expect.poll(() => page.locator('.lg-stask').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(8);
    await page.waitForTimeout(200);

    // A user scroll (not a programmatic one): the wheel goes through the same
    // scroll event path a finger would.
    const stream = page.locator('.lg-stream');
    await stream.hover({ position: { x: 100, y: 60 } });
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(200);

    const afterScrollUp = await readStage(page);
    expect(afterScrollUp.streamScrollTop, 'user scrolled away from the bottom').toBeLessThan(
      afterScrollUp.streamScrollHeight - afterScrollUp.streamClientHeight - 24,
    );

    // (c) the pill appears, and new arrivals do NOT yank the view back down
    await expect(page.locator('.lg-stream-jump'), 'jump-to-latest pill appears').toBeVisible();
    const rowsBefore = afterScrollUp.rowCount;
    await expect
      .poll(() => page.locator('.lg-stask').count(), { timeout: 15_000 })
      .toBeGreaterThan(rowsBefore + 1);
    await page.waitForTimeout(200);
    const afterAppend = await readStage(page);
    expect(afterAppend.streamScrollTop, 'reading position untouched by new tasks').toBeCloseTo(
      afterScrollUp.streamScrollTop,
      0,
    );

    // tapping the pill returns to the bottom and re-pins
    await page.locator('.lg-stream-jump').click();
    await page.waitForTimeout(200);
    const afterJump = await readStage(page);
    expect(afterJump.streamScrollTop, 'jumped to the bottom').toBeCloseTo(
      afterJump.streamScrollHeight - afterJump.streamClientHeight,
      0,
    );
    expect(afterJump.lastRowBottom!, 'newest task visible again').toBeLessThanOrEqual(
      afterJump.streamRect.bottom + 0.5,
    );
    expect(afterJump.jumpPillVisible, 'pill hidden once re-pinned').toBe(false);

    await context.close();
  });
});

test.describe('brain dump live stream — 1280x800 wide stage', () => {
  test('the >=1000px absolute panel geometry is unchanged', async ({ browser }) => {
    test.setTimeout(60_000);
    const { context, page } = await openHome(browser, '/home?fakedump=8', {
      width: 1280,
      height: 800,
      mobile: false,
    });

    await expect.poll(() => page.locator('.lg-stask').count(), { timeout: 30_000 }).toBe(8);
    await page.waitForTimeout(800); // GSAP column expansion settles

    const wide = await page.evaluate(() => {
      const el = document.querySelector('.lg-stream') as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        right: cs.right,
        width: cs.width,
        maxHeight: cs.maxHeight,
        minHeight: cs.minHeight,
        marginTop: cs.marginTop,
      };
    });

    expect(wide.position, 'still absolutely positioned').toBe('absolute');
    expect(wide.right, 'right offset still 44px').toBe('44px');
    expect(wide.width, 'panel width still 460px').toBe('460px');
    expect(wide.marginTop, 'no flow margin on the absolute panel').toBe('0px');
    // the mobile floor must not leak into the absolute stage
    expect(wide.minHeight, 'mobile floor neutralised at >=1000px').toBe('0px');

    await context.close();
  });
});

/* ── Step-1 Dynamic Bar layout (2026-08-01) ──────────────────────────────────
   Home layout prep: tour button rides the idle row beside Record Meeting, the
   Up Next card flex-grows into the freed space (orb block dropped 108->72),
   and wide viewports get real column widths (680 tablet / 760 desktop —
   the desktop number must equal the GSAP idle-return width in Home.tsx). */
type SeedTask = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  project_id: string | null;
  priority: string;
};

/** One intercepted write against focusos_tasks (A1 row controls). */
type TaskWrite = { method: string; url: string; body: any };

interface IdleHomeOpts extends StandaloneOpts {
  url?: string;
  tasks?: SeedTask[];
  /** Dynamic seed, read on every GET, so a test can mutate the served list
   *  (the mock server applying the write it just accepted). */
  getTasks?: () => SeedTask[];
  /** Every non-GET request against focusos_tasks, in order. */
  onWrite?: (write: TaskWrite) => void;
}

async function openIdleHome(browser: Browser, opts: IdleHomeOpts) {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    isMobile: opts.mobile ?? true,
    hasTouch: opts.mobile ?? true,
    timezoneId: 'UTC',
  });
  await installIntercepts(context);
  // seeded open tasks + count 42 so the Today's Focus card actually renders
  await context.route('**/rest/v1/focusos_tasks**', (route) => {
    const req = route.request();
    const method = req.method();
    if (method !== 'GET') {
      let body: any = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = req.postData();
      }
      opts.onWrite?.({ method, url: req.url(), body });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    const all: SeedTask[] =
      opts.getTasks?.() ??
      opts.tasks ??
      [1, 2, 3].map((i) => ({
        id: `upnext-${i}`,
        title: `Seeded task ${i}`,
        status: 'todo',
        due_date: null,
        project_id: null,
        priority: 'medium',
      }));
    // A single-row read (the edit pane's select('*')) filters by id; `[?&]`
    // keeps this off `project_id=eq.…`.
    const idMatch = /[?&]id=eq\.([^&]+)/.exec(req.url());
    const rows = idMatch ? all.filter((t) => t.id === decodeURIComponent(idMatch[1])) : all;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-range': `0-${Math.max(rows.length - 1, 0)}/42`,
        'access-control-expose-headers': 'content-range',
      },
      body: JSON.stringify(rows),
    });
  });
  const page = await context.newPage();
  await seedSession(page);
  if (opts.standalone) await forceStandalone(page);
  await page.goto(opts.url ?? '/home?fakedump=0');
  await page.waitForSelector('.lg-upnext', { timeout: 20_000 });
  return { context, page };
}

test.describe('step-1 dynamic bar layout', () => {
  const geom = (page: Page) =>
    page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
      };
      return {
        col: r('.lg-hero-col'),
        card: r('.lg-upnext'),
        orb: r('.lg-orb'),
        record: r('[data-home-tour-step="record-meeting"]'),
        help: r('button[aria-label="Take the Home tour"]'),
        dock: r('.lg-dock'),
        actionsMarginBottom: getComputedStyle(document.querySelector('.lg-hero-actions')!).marginBottom,
      };
    });

  test('mobile 393x852 standalone: help joins the record row, card grows, no overlap', async ({ browser }) => {
    const { context, page } = await openIdleHome(browser, { width: 393, height: 852, standalone: true });
    const g = await geom(page);
    expect(g.help, 'tour button rendered').not.toBeNull();
    expect(g.record, 'record meeting rendered').not.toBeNull();
    expect(Math.abs(g.help!.top - g.record!.top), 'same row').toBeLessThan(4);
    expect(g.help!.left, 'help sits right of record').toBeGreaterThan(g.record!.right);
    expect(g.card!.height, 'card has grown past its content height').toBeGreaterThanOrEqual(260);
    expect(g.card!.bottom, 'card clears the orb').toBeLessThanOrEqual(g.orb!.top);
    // browser-mode rig keeps 108px (the 72px orb-down is shell-scoped; browser
    // mode has no bottom padding reservation — the 2026-08-01 desktop overlap)
    expect(g.actionsMarginBottom, 'browser-mode margin stays 108px').toBe('108px');
    if (g.dock) expect(g.record!.bottom, 'record row clears the dock').toBeLessThanOrEqual(g.dock.top - 8);
    await page.screenshot({ path: 'test-results/step1-mobile.png' });
    await context.close();
  });

  test('tablet 768x1024: column uses the width', async ({ browser }) => {
    const { context, page } = await openIdleHome(browser, { width: 768, height: 1024, mobile: false });
    const g = await geom(page);
    expect(Math.round(g.col!.width), 'tablet column 680').toBe(680);
    await page.screenshot({ path: 'test-results/step1-tablet.png' });
    await context.close();
  });

  test('desktop 1280x900: column 760, card uses the height', async ({ browser }) => {
    const { context, page } = await openIdleHome(browser, { width: 1280, height: 900, mobile: false });
    const g = await geom(page);
    expect(Math.round(g.col!.width), 'desktop column 760 (GSAP-synced)').toBe(760);
    expect(g.card!.height, 'card grown on desktop').toBeGreaterThanOrEqual(320);
    // the assertion whose absence let the dock overlap ship (2026-08-01)
    expect(g.dock, 'dock rendered on desktop').not.toBeNull();
    expect(g.record!.bottom, 'record row clears the dock').toBeLessThanOrEqual(g.dock!.top - 8);
    expect(g.help!.bottom, 'tour button clears the dock').toBeLessThanOrEqual(g.dock!.top - 8);
    await page.screenshot({ path: 'test-results/step1-desktop.png' });
    await context.close();
  });

  test("today's focus ranking: fossils demoted, priority rules the tiers, text tap opens the pane", async ({ browser }) => {
    const day = 86400000;
    const ymd = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * day).toLocaleDateString('en-CA');
    const mk = (id: string, priority: string, due: string | null): SeedTask => ({
      id,
      title: id,
      status: 'todo',
      due_date: due,
      project_id: null,
      priority,
    });
    const seed = [
      // DB-format timestamp on purpose: live rows carry full ISO stamps, and
      // the day-slice parsing is exactly what the 2026-08-01 NaN bug broke.
      mk('fossil-urgent', 'urgent', `${ymd(-60)}T20:00:00+00:00`),
      mk('today-low', 'low', ymd(0)),
      mk('newover-med', 'medium', `${ymd(-3)}T20:00:00+00:00`),
      mk('future-urgent', 'urgent', ymd(10)),
      mk('nodue-high', 'high', null),
    ];
    const { context, page } = await openIdleHome(browser, {
      width: 393,
      height: 852,
      standalone: true,
      tasks: seed,
    });

    await expect(page.locator('.lg-uphead .ttl')).toHaveText("TODAY'S FOCUS");
    // tier 0 by priority (medium beats low), then tier 1 opens with the urgent
    // future task; the 60-day urgent fossil is demoted to LAST. The card shows
    // 10 rows since A1 (2026-08-01), so the whole seed is on screen and the
    // fossil's demotion is asserted directly rather than by absence.
    await expect(page.locator('.lg-utask .lg-utitle')).toHaveText([
      'newover-med',
      'today-low',
      'future-urgent',
      'nodue-high',
      'fossil-urgent',
    ]);

    // A1 replaced the whole-row navigate('/app') with the in-place edit pane:
    // tapping the task text opens it OVER Home and the URL never changes.
    await page.locator('.lg-utask').first().locator('.lg-utap').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/home/);
    await context.close();
  });
});

/* ── A1: interactive Today's Focus rows (2026-08-01) ─────────────────────────
   The card stopped being a read-only teaser: 10 ranked rows that scroll inside
   the card, a tick that completes, a play that starts the timer, an X behind
   the house confirm that deletes, and a text tap that opens the shared edit
   pane OVER /home. Every assertion below is on the WIRE (the intercepted
   PostgREST write) plus the visible refill, not on internal state. */
test.describe('A1 interactive rows', () => {
  type A1Row = SeedTask & {
    description: string | null;
    images: string[];
    timer_total_seconds: number;
    timer_is_running: boolean;
    timer_start_time: number | null;
    sort_order: number;
    completed_by_email: string | null;
    assigned_to_email: string | null;
  };

  const day = 86400000;
  const ymd = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * day).toLocaleDateString('en-CA');

  const row = (n: number, priority: string, due: string | null): A1Row => ({
    id: `a1-${n}`,
    title: `A1 task ${n}`,
    status: 'todo',
    due_date: due,
    project_id: null,
    priority,
    description: `desc ${n}`,
    images: [],
    timer_total_seconds: 0,
    timer_is_running: false,
    timer_start_time: null,
    sort_order: n,
    completed_by_email: null,
    assigned_to_email: null,
  });

  /* 12 open tasks with varied priorities and dues, seeded ALREADY in rank order
     so "row 1" is unambiguous: tier 0 (due today) urgent→low, then tier 1
     (future dues) urgent→low, then tier 1 no-due (Infinity sorts last within
     its priority), then the >30-day fossil, which rankTodaysFocus demotes. */
  const seed = (): A1Row[] => [
    row(1, 'urgent', ymd(0)),
    row(2, 'high', ymd(0)),
    row(3, 'medium', ymd(0)),
    row(4, 'low', ymd(0)),
    row(5, 'urgent', `${ymd(3)}T20:00:00+00:00`),
    row(6, 'high', `${ymd(5)}T20:00:00+00:00`),
    row(7, 'medium', `${ymd(7)}T20:00:00+00:00`),
    row(8, 'low', `${ymd(9)}T20:00:00+00:00`),
    row(9, 'low', null),
    row(10, 'low', null),
    row(11, 'low', null),
    row(12, 'urgent', `${ymd(-60)}T20:00:00+00:00`),
  ];

  const idOf = (url: string) => /[?&]id=eq\.([^&]+)/.exec(url)?.[1] ?? null;

  /** A mock server that APPLIES the writes it accepts, so the refetch that the
   *  invalidation triggers returns a genuinely changed list. */
  function makeStore() {
    const state = { tasks: seed(), writes: [] as TaskWrite[] };
    const onWrite = (w: TaskWrite) => {
      state.writes.push(w);
      const id = idOf(w.url);
      if (!id) return;
      if (w.method === 'DELETE' || (w.method === 'PATCH' && w.body?.status === 'completed')) {
        state.tasks = state.tasks.filter((t) => t.id !== id);
      } else if (w.method === 'PATCH') {
        // Apply accepted field writes so the refetch the invalidation triggers
        // returns genuinely changed rows (the timer toggle depends on this).
        const t = state.tasks.find((x) => x.id === id);
        if (t) Object.assign(t, w.body);
      }
    };
    return { state, getTasks: () => state.tasks, onWrite };
  }

  const writesOf = (store: ReturnType<typeof makeStore>, method: string) =>
    store.state.writes.filter((w) => w.method === method);

  test('desktop 1280x900: 10 rows, the card scrolls internally, nothing is half-clipped', async ({
    browser,
  }) => {
    const store = makeStore();
    const { context, page } = await openIdleHome(browser, {
      width: 1280,
      height: 900,
      mobile: false,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });

    await expect(page.locator('.lg-utask'), '10 ranked rows rendered').toHaveCount(10);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A1 task 1');

    const box = await page.evaluate(() => {
      const rows = document.querySelector('.lg-uprows') as HTMLElement;
      const r = rows.getBoundingClientRect();
      const card = document.querySelector('.lg-upnext')!.getBoundingClientRect();
      const items = [...document.querySelectorAll('.lg-utask')].map((el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      });
      return {
        scrollHeight: rows.scrollHeight,
        clientHeight: rows.clientHeight,
        overflowY: getComputedStyle(rows).overflowY,
        minHeight: getComputedStyle(rows).minHeight,
        top: r.top,
        bottom: r.bottom,
        cardBottom: card.bottom,
        fullyVisible: items.filter((i) => i.top >= r.top - 0.5 && i.bottom <= r.bottom + 0.5).length,
      };
    });

    expect(box.overflowY, 'rows own the overflow').toBe('auto');
    expect(box.minHeight, 'min-height:0 so flex can actually shrink it').toBe('0px');
    expect(box.scrollHeight, 'content is taller than the box').toBeGreaterThan(box.clientHeight);
    expect(box.fullyVisible, 'at least 5 whole rows on screen').toBeGreaterThanOrEqual(5);
    // the scroll box ends INSIDE the glass card, so the overflow is clipped by
    // the card instead of spilling past its edge
    expect(box.bottom, 'rows box ends inside the card').toBeLessThanOrEqual(box.cardBottom + 0.5);

    // scrolled to the end, the last row is whole: the box owns the card's
    // remaining height properly (padding included), so nothing is half-cut
    const tail = await page.evaluate(() => {
      const rows = document.querySelector('.lg-uprows') as HTMLElement;
      rows.scrollTop = rows.scrollHeight;
      const r = rows.getBoundingClientRect();
      const last = document.querySelectorAll('.lg-utask')[9].getBoundingClientRect();
      return { boxBottom: r.bottom, boxTop: r.top, lastTop: last.top, lastBottom: last.bottom };
    });
    expect(tail.lastBottom, 'last row fully inside the box once scrolled').toBeLessThanOrEqual(
      tail.boxBottom + 0.5,
    );
    expect(tail.lastTop, 'last row starts inside the box').toBeGreaterThanOrEqual(tail.boxTop - 0.5);

    // The @media(max-height:800px) nth-child(n + 3) hide rule still matches the
    // new nesting (rows are direct children of .lg-uprows).
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.waitForTimeout(200);
    const shown = await page.evaluate(
      () =>
        [...document.querySelectorAll('.lg-utask')].filter(
          (el) => getComputedStyle(el).display !== 'none',
        ).length,
    );
    expect(shown, 'short viewport still shows only the first two rows').toBe(2);

    await context.close();
  });

  test('tick completes the task and the ranked list refills', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openIdleHome(browser, {
      width: 1280,
      height: 900,
      mobile: false,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    await page.getByRole('button', { name: 'Complete A1 task 1', exact: true }).click();

    await expect.poll(() => writesOf(store, 'PATCH').length, { timeout: 10_000 }).toBe(1);
    const patch = writesOf(store, 'PATCH')[0];
    expect(idOf(patch.url), 'the tapped row was the one written').toBe('a1-1');
    // completion writes status ONLY. completed_at is the DB trigger's job, and
    // Index's fuller payload just echoes every other column back unchanged.
    expect(patch.body).toEqual({ status: 'completed' });

    // the refill is invalidation -> refetch -> re-rank during render
    await expect
      .poll(() => page.locator('.lg-utask .lg-utitle').first().textContent(), { timeout: 10_000 })
      .toBe('A1 task 2');
    await expect(page.locator('.lg-utask'), 'the 10-row window refilled').toHaveCount(10);
    await expect(page.locator('.lg-utask .lg-utitle').last()).toHaveText('A1 task 11');

    await context.close();
  });

  test('play toggles the timer with the project-row writes AND the project-row visuals', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openIdleHome(browser, {
      width: 1280,
      height: 900,
      mobile: false,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });
    await expect(page.locator('.lg-utask')).toHaveCount(10);
    const row2 = page
      .locator('.lg-utask')
      .filter({ has: page.locator('.lg-utitle', { hasText: /^A1 task 2$/ }) });

    const before = Date.now();
    await page.getByRole('button', { name: 'Start timer for A1 task 2', exact: true }).click();

    await expect.poll(() => writesOf(store, 'PATCH').length, { timeout: 10_000 }).toBe(1);
    const patch = writesOf(store, 'PATCH')[0];
    expect(idOf(patch.url)).toBe('a1-2');
    expect(patch.body.status, 'same status flip as TaskListItem.handleStartStop').toBe('in-progress');
    expect(patch.body.timer_is_running).toBe(true);
    expect(typeof patch.body.timer_start_time, 'epoch ms, like Date.now()').toBe('number');
    expect(patch.body.timer_start_time).toBeGreaterThanOrEqual(before);
    // the start branch never rewrites the accrued total
    expect('timer_total_seconds' in patch.body, 'total seconds untouched on start').toBe(false);

    // the row now shows the HOUSE running state, not an invented one: the same
    // border-glow-pulse ring the project rows run plus the Play→Pause icon flip.
    await expect(row2).toHaveClass(/border-glow-pulse/);
    await expect(
      page.getByRole('button', { name: 'Pause timer for A1 task 2', exact: true }),
    ).toBeVisible();

    // second tap PAUSES — the TaskListItem stop branch: total += elapsed,
    // running false, status untouched, start_time dropped from the payload.
    await page.getByRole('button', { name: 'Pause timer for A1 task 2', exact: true }).click();
    await expect.poll(() => writesOf(store, 'PATCH').length, { timeout: 10_000 }).toBe(2);
    const pause = writesOf(store, 'PATCH')[1];
    expect(idOf(pause.url)).toBe('a1-2');
    expect(pause.body.timer_is_running).toBe(false);
    expect(typeof pause.body.timer_total_seconds).toBe('number');
    expect(pause.body.timer_total_seconds).toBeGreaterThanOrEqual(0);
    expect('status' in pause.body, 'stop branch never touches status').toBe(false);
    expect('timer_start_time' in pause.body, 'stop branch drops start_time, like the house write').toBe(false);

    // and the running visuals clear again
    await expect(row2).not.toHaveClass(/border-glow-pulse/);
    await expect(
      page.getByRole('button', { name: 'Start timer for A1 task 2', exact: true }),
    ).toBeVisible();

    await context.close();
  });

  test('a timer started elsewhere shows the house running state on the card', async ({ browser }) => {
    const store = makeStore();
    // Seeded as ALREADY running (e.g. started from the Today view): the card
    // must show it without any tap — this is exactly what the start-only latch
    // version could not do (device-found by Igor, 2026-08-01).
    const external = store.state.tasks.find((t) => t.id === 'a1-3')!;
    external.timer_is_running = true;
    external.timer_start_time = Date.now() - 60_000;
    external.timer_total_seconds = 120;

    const { context, page } = await openIdleHome(browser, {
      width: 1280,
      height: 900,
      mobile: false,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });
    await expect(page.locator('.lg-utask')).toHaveCount(10);
    const row3 = page
      .locator('.lg-utask')
      .filter({ has: page.locator('.lg-utitle', { hasText: /^A1 task 3$/ }) });
    await expect(row3).toHaveClass(/border-glow-pulse/);
    await expect(
      page.getByRole('button', { name: 'Pause timer for A1 task 3', exact: true }),
    ).toBeVisible();

    // pausing from the card banks the elapsed time on top of the accrued total
    await page.getByRole('button', { name: 'Pause timer for A1 task 3', exact: true }).click();
    await expect.poll(() => writesOf(store, 'PATCH').length, { timeout: 10_000 }).toBe(1);
    const pause = writesOf(store, 'PATCH')[0];
    expect(idOf(pause.url)).toBe('a1-3');
    expect(pause.body.timer_is_running).toBe(false);
    expect(pause.body.timer_total_seconds).toBeGreaterThanOrEqual(120 + 59);
    expect(pause.body.timer_total_seconds).toBeLessThan(120 + 70);
    await expect(row3).not.toHaveClass(/border-glow-pulse/);

    await context.close();
  });

  test('X opens the house delete confirm and deletes on confirm', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openIdleHome(browser, {
      width: 1280,
      height: 900,
      mobile: false,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    await page.getByRole('button', { name: 'Delete A1 task 1', exact: true }).click();
    // the same AlertDialog copy the project rows use
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toContainText('Delete this task?');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect.poll(() => writesOf(store, 'DELETE').length, { timeout: 10_000 }).toBe(1);
    expect(idOf(writesOf(store, 'DELETE')[0].url), 'hard delete of the tapped row').toBe('a1-1');

    await expect
      .poll(() => page.locator('.lg-utask .lg-utitle').first().textContent(), { timeout: 10_000 })
      .toBe('A1 task 2');

    await context.close();
  });

  test('tapping the task text opens the edit pane over /home and leaves the route alone', async ({
    browser,
  }) => {
    const store = makeStore();
    const { context, page } = await openIdleHome(browser, {
      width: 1280,
      height: 900,
      mobile: false,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    await page.locator('.lg-utask').nth(2).locator('.lg-utap').click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#title'), 'the pane is loaded with that task').toHaveValue('A1 task 3');
    expect(new URL(page.url()).pathname, 'no navigation on open').toBe('/home');

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(new URL(page.url()).pathname, 'no navigation on close').toBe('/home');
    // Radix law guard: a modal layer that unmounts must hand the page back.
    const pointerEvents = await page.evaluate(() => document.body.style.pointerEvents);
    expect(pointerEvents, 'body pointer-events restored after the modal closes').not.toBe('none');
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    await context.close();
  });

  test('focused pane fields draw the ring ON the box — no outside paint to clip (Igor device-found)', async ({
    browser,
  }) => {
    // The stock shadcn focus ring is a shadow painted OUTSIDE the field plus a
    // background-colour offset band; outside paint clips against the scrolling
    // dialog body, so the ring showed broken on device. The contract here: the
    // focus state lives ON the box (border colour + inset shadow only), which
    // no ancestor can ever clip.
    const store = makeStore();
    const { context, page } = await openIdleHome(browser, {
      width: 393,
      height: 852,
      standalone: true,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });
    await expect(page.locator('.lg-utask')).toHaveCount(10);
    await page.locator('.lg-utask').first().locator('.lg-utap').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    for (const fieldId of ['title', 'description']) {
      const probe = await page.evaluate((id) => {
        const el = document.getElementById(id) as HTMLTextAreaElement;
        el.focus();
        const cs = getComputedStyle(el);
        const ref = document.createElement('div');
        ref.style.color = 'hsl(var(--ring))';
        document.body.appendChild(ref);
        const ringColor = getComputedStyle(ref).color;
        ref.remove();
        return { boxShadow: cs.boxShadow, borderColor: cs.borderColor, ringColor };
      }, fieldId);
      // split shadow list on commas OUTSIDE parentheses (colours contain commas)
      const segments = probe.boxShadow.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
      for (const seg of segments) {
        // Tailwind leaves no-op placeholder segments (transparent colour, zero
        // geometry) in the composed shadow — they paint nothing and cannot clip.
        const geometry = seg.replace(/rgba?\([^)]*\)\s*/, '').trim();
        const invisible = /rgba\(0, 0, 0, 0\)/.test(seg) || /^0px 0px 0px(?: 0px)?$/.test(geometry);
        if (seg !== 'none' && !invisible) {
          expect(seg, `${fieldId}: every painted shadow stays inside the box`).toContain('inset');
        }
      }
      expect(probe.borderColor, `${fieldId}: the focus border takes the ring colour`).toBe(
        probe.ringColor,
      );
    }
    await context.close();
  });
});

/* ── A2: swipe gestures + the animated hint (2026-08-01) ─────────────────────
   Right past +72px completes through the SAME write A1's tick fires; left past
   -72px sets the task aside for TODAY (a per-day localStorage key the ranked
   memo re-reads during render, so it survives a same-day reload with no server
   round trip). Everything under the threshold is still a tap, and everything
   vertical is still .lg-uprows' native scroll: the two regressions the intent
   threshold exists to prevent, both asserted below.

   The gestures are dispatched as REAL touch input through CDP (the same
   pipeline a finger uses), not as synthetic DOM events, so React's handlers and
   Chromium's own gesture recognition both see exactly what the device sends. */
test.describe('A2 swipe gestures', () => {
  type A2Row = SeedTask & {
    description: string | null;
    images: string[];
    timer_total_seconds: number;
    timer_is_running: boolean;
    timer_start_time: number | null;
    sort_order: number;
    completed_by_email: string | null;
    assigned_to_email: string | null;
  };

  const day = 86400000;
  const ymd = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * day).toLocaleDateString('en-CA');

  const row = (n: number, priority: string, due: string | null): A2Row => ({
    id: `a2-${n}`,
    title: `A2 task ${n}`,
    status: 'todo',
    due_date: due,
    project_id: null,
    priority,
    description: `desc ${n}`,
    images: [],
    timer_total_seconds: 0,
    timer_is_running: false,
    timer_start_time: null,
    sort_order: n,
    completed_by_email: null,
    assigned_to_email: null,
  });

  /** 12 open tasks seeded ALREADY in rank order, so "row 1" is unambiguous. */
  const seed = (): A2Row[] => [
    row(1, 'urgent', ymd(0)),
    row(2, 'high', ymd(0)),
    row(3, 'medium', ymd(0)),
    row(4, 'low', ymd(0)),
    row(5, 'urgent', `${ymd(3)}T20:00:00+00:00`),
    row(6, 'high', `${ymd(5)}T20:00:00+00:00`),
    row(7, 'medium', `${ymd(7)}T20:00:00+00:00`),
    row(8, 'low', `${ymd(9)}T20:00:00+00:00`),
    row(9, 'low', null),
    row(10, 'low', null),
    row(11, 'low', null),
    row(12, 'low', null),
  ];

  const idOf = (url: string) => /[?&]id=eq\.([^&]+)/.exec(url)?.[1] ?? null;

  function makeStore() {
    const state = { tasks: seed(), writes: [] as TaskWrite[] };
    const onWrite = (w: TaskWrite) => {
      state.writes.push(w);
      const id = idOf(w.url);
      if (!id) return;
      if (w.method === 'DELETE' || (w.method === 'PATCH' && w.body?.status === 'completed')) {
        state.tasks = state.tasks.filter((t) => t.id !== id);
      } else if (w.method === 'PATCH') {
        // Apply accepted field writes so the refetch the invalidation triggers
        // returns genuinely changed rows (the timer toggle depends on this).
        const t = state.tasks.find((x) => x.id === id);
        if (t) Object.assign(t, w.body);
      }
    };
    return { state, getTasks: () => state.tasks, onWrite };
  }

  /** The phone rig: 393x852 standalone, which is the only place the swipes and
   *  the hint exist at all (both are gated to coarse pointers). */
  const openPhone = (browser: Browser, store: ReturnType<typeof makeStore>) =>
    openIdleHome(browser, {
      width: 393,
      height: 852,
      standalone: true,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });

  /**
   * One finger: touchStart, N touchMoves, touchEnd, dispatched through
   * Chromium's real input pipeline. `beforeRelease` runs with the finger still
   * down, which is the only moment the mid-drag affordance can be read.
   */
  async function touchDrag(
    page: Page,
    selector: string,
    dx: number,
    opts: { dy?: number; steps?: number; nth?: number; beforeRelease?: () => Promise<void> } = {},
  ) {
    const dy = opts.dy ?? 0;
    const steps = opts.steps ?? 12;
    const box = await page.locator(selector).nth(opts.nth ?? 0).boundingBox();
    if (!box) throw new Error(`no bounding box for ${selector}`);
    const x0 = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= steps; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps }],
        });
      }
      if (opts.beforeRelease) await opts.beforeRelease();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
  }

  /** The page's own idea of today. Home reads it in the page timezone, and so
   *  must the assertion on the key it wrote. */
  const pageYmd = (page: Page) => page.evaluate(() => new Date().toLocaleDateString('en-CA'));

  const dismissedIds = async (page: Page) => {
    const key = `fos-dismissed:${await pageYmd(page)}`;
    return page.evaluate((k) => {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as string[]) : null;
    }, key);
  };

  test('swipe right completes the task with the tick write and the list refills', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openPhone(browser, store);
    await expect(page.locator('.lg-utask')).toHaveCount(10);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 1');

    await touchDrag(page, '.lg-utask', 130, {
      beforeRelease: async () => {
        // mid-drag, with the finger still down: the row has travelled and the
        // completion affordance is painted behind it
        const mid = await page.evaluate(() => {
          const r = document.querySelector('.lg-utask') as HTMLElement;
          const tint = r.querySelector('.lg-uswipe') as HTMLElement;
          return {
            rowTransform: getComputedStyle(r).transform,
            dir: tint.getAttribute('data-dir'),
            opacity: Number(getComputedStyle(tint).opacity),
            touchAction: getComputedStyle(r).touchAction,
          };
        });
        expect(mid.rowTransform, 'the row is translated, not re-laid-out').toMatch(/^matrix\(1, 0, 0, 1, /);
        expect(Number(/matrix\(1, 0, 0, 1, ([-\d.]+)/.exec(mid.rowTransform)![1]), 'moved right').toBeGreaterThan(60);
        expect(mid.dir, 'completion affordance revealed').toBe('right');
        expect(mid.opacity, 'tint follows the drag').toBeGreaterThan(0.5);
        expect(mid.touchAction, 'vertical axis still belongs to the scroll box').toBe('pan-y');
      },
    });

    await expect.poll(() => store.state.writes.length, { timeout: 10_000 }).toBe(1);
    const patch = store.state.writes[0];
    expect(patch.method).toBe('PATCH');
    expect(idOf(patch.url), 'the swiped row was the one written').toBe('a2-1');
    // byte-identical to the A1 tick payload: status only, completed_at is the
    // DB trigger's job
    expect(patch.body).toEqual({ status: 'completed' });

    // the refill is invalidation -> refetch -> re-rank during render
    await expect
      .poll(() => page.locator('.lg-utask .lg-utitle').first().textContent(), { timeout: 10_000 })
      .toBe('A2 task 2');
    await expect(page.locator('.lg-utask'), 'the 10-row window refilled').toHaveCount(10);
    expect(await dismissedIds(page), 'a completion never writes the dismiss key').toBeNull();

    await context.close();
  });

  test('swipe left sets the task aside for today, with no write, and it survives a reload', async ({
    browser,
  }) => {
    const store = makeStore();
    const { context, page } = await openPhone(browser, store);
    await expect(page.locator('.lg-utask')).toHaveCount(10);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 1');

    await touchDrag(page, '.lg-utask', -130, {
      beforeRelease: async () => {
        const dir = await page.evaluate(() =>
          document.querySelector('.lg-utask .lg-uswipe')!.getAttribute('data-dir'),
        );
        expect(dir, 'set-aside affordance revealed').toBe('left');
      },
    });

    // the row leaves the ranked list (the memo re-derives; nothing is deleted)
    await expect
      .poll(() => page.locator('.lg-utask .lg-utitle').first().textContent(), { timeout: 10_000 })
      .toBe('A2 task 2');
    await expect(page.locator('.lg-utask'), 'the window refilled from the tail').toHaveCount(10);

    expect(await dismissedIds(page), 'today key holds the set-aside id').toEqual(['a2-1']);
    expect(store.state.writes, 'setting aside is local only, no network write').toEqual([]);

    // same day, same browser: it must still be gone after a full reload, and
    // the seeded list still contains it (nothing was deleted server-side)
    await page.reload();
    await page.waitForSelector('.lg-upnext', { timeout: 20_000 });
    await expect(page.locator('.lg-utask')).toHaveCount(10);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 2');
    const titles = await page.locator('.lg-utask .lg-utitle').allTextContents();
    expect(titles, 'the set-aside task is absent from the whole window').not.toContain('A2 task 1');
    expect(store.state.tasks.some((t) => t.id === 'a2-1'), 'the task itself is untouched').toBe(true);
    expect(store.state.writes, 'still no write after the reload').toEqual([]);

    // yesterday's key is cleaned up lazily by the write that replaced it
    const stale = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('fos-dismissed:')),
    );
    expect(stale.length, 'exactly one dismiss key survives (today\'s)').toBe(1);

    await context.close();
  });

  test('a short swipe springs back: no write, no dismissal, no edit pane', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openPhone(browser, store);
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    await touchDrag(page, '.lg-utask', 30, { steps: 6 });
    await page.waitForTimeout(700); // the spring-back plus its settle window

    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 1');
    await expect(page.locator('.lg-utask')).toHaveCount(10);
    expect(store.state.writes, 'nothing was written').toEqual([]);
    expect(await dismissedIds(page), 'nothing was set aside').toBeNull();
    await expect(page.getByRole('dialog'), 'a swipe is not a tap').toHaveCount(0);
    // and the row is back home, transform-wise
    const back = await page.evaluate(() => {
      const t = getComputedStyle(document.querySelector('.lg-utask') as HTMLElement).transform;
      return t === 'none' ? 0 : Number(/matrix\(1, 0, 0, 1, ([-\d.]+)/.exec(t)?.[1] ?? NaN);
    });
    expect(Math.abs(back), 'row settled back to 0').toBeLessThan(0.5);

    await context.close();
  });

  test('a tap still opens the edit pane (the intent threshold guard)', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openPhone(browser, store);
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    await page.locator('.lg-utask').first().locator('.lg-utap').tap();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#title'), 'the pane is loaded with that task').toHaveValue('A2 task 1');
    expect(new URL(page.url()).pathname, 'no navigation on open').toBe('/home');
    expect(store.state.writes, 'a tap writes nothing on its own').toEqual([]);
    expect(await dismissedIds(page), 'a tap sets nothing aside').toBeNull();

    await context.close();
  });

  test('vertical drags still scroll the rows box and fire no action', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openPhone(browser, store);
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    const before = await page.evaluate(() => {
      const b = document.querySelector('.lg-uprows') as HTMLElement;
      return { top: b.scrollTop, scrollHeight: b.scrollHeight, clientHeight: b.clientHeight };
    });
    expect(before.scrollHeight, 'the rows box really does overflow').toBeGreaterThan(before.clientHeight + 20);

    // a touch-sourced scroll gesture: the browser's own recogniser drives it,
    // and React's touch handlers see every event of it
    const box = (await page.locator('.lg-uprows').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      xDistance: 0,
      yDistance: -120, // negative = scroll down through the list
      gestureSourceType: 'touch',
      speed: 800,
    });
    await cdp.detach();
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => (document.querySelector('.lg-uprows') as HTMLElement).scrollTop);
    expect(after, 'the rows box scrolled').toBeGreaterThan(before.top + 20);
    expect(store.state.writes, 'scrolling completes nothing').toEqual([]);
    expect(await dismissedIds(page), 'scrolling sets nothing aside').toBeNull();
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 1');
    // no row was left translated by the scroll
    const offsets = await page.evaluate(() =>
      [...document.querySelectorAll('.lg-utask')].map((el) => {
        const t = getComputedStyle(el).transform;
        return t === 'none' ? 0 : Number(/matrix\(1, 0, 0, 1, ([-\d.]+)/.exec(t)?.[1] ?? 0);
      }),
    );
    expect(Math.max(...offsets.map(Math.abs)), 'every row is still at rest').toBeLessThan(0.5);

    await context.close();
  });

  test('the hint sits under the card, loops on a coarse pointer, and stops for reduced motion', async ({
    browser,
  }) => {
    const store = makeStore();
    const { context, page } = await openPhone(browser, store);
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    const hint = await page.evaluate(() => {
      const el = document.querySelector('.lg-uhint') as HTMLElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rows = (document.querySelector('.lg-uprows') as HTMLElement).getBoundingClientRect();
      const card = (document.querySelector('.lg-upnext') as HTMLElement).getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent ?? '',
        display: cs.display,
        animationName: cs.animationName,
        animationIterationCount: cs.animationIterationCount,
        left: getComputedStyle(el.querySelector('.l')!).animationName,
        right: getComputedStyle(el.querySelector('.r')!).animationName,
        belowRows: r.top >= rows.bottom - 0.5,
        insideCard: r.bottom <= card.bottom + 0.5,
        running: el.getAnimations().length,
      };
    });

    expect(hint, 'the hint is rendered under the card').not.toBeNull();
    expect(hint!.display, 'visible on a coarse pointer').not.toBe('none');
    expect(hint!.text.toLowerCase(), 'both gestures are named').toContain('set aside');
    expect(hint!.text.toLowerCase()).toContain('complete');
    expect(hint!.animationName, 'the nudge loop is running').not.toBe('none');
    expect(hint!.animationIterationCount, 'it loops').toBe('infinite');
    expect(hint!.left, 'the left phrase has its own emphasis loop').not.toBe('none');
    expect(hint!.right, 'the right phrase has its own emphasis loop').not.toBe('none');
    expect(hint!.belowRows, 'attached below the scrolling rows').toBe(true);
    expect(hint!.insideCard, 'and inside the glass card').toBe(true);
    expect(hint!.running, 'the element really is animating').toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(150);
    const reduced = await page.evaluate(() => {
      const el = document.querySelector('.lg-uhint') as HTMLElement;
      return {
        animationName: getComputedStyle(el).animationName,
        left: getComputedStyle(el.querySelector('.l')!).animationName,
        right: getComputedStyle(el.querySelector('.r')!).animationName,
        display: getComputedStyle(el).display,
        justify: getComputedStyle(el).justifyContent,
        // the swipe spring must NOT be zeroed: the release handler retires a
        // settled row on transitionend
        spring: getComputedStyle(document.querySelector('.lg-utask') as HTMLElement).transitionDuration,
      };
    });
    expect(reduced.animationName, 'no nudge under reduced motion').toBe('none');
    expect(reduced.left, 'no left emphasis under reduced motion').toBe('none');
    expect(reduced.right, 'no right emphasis under reduced motion').toBe('none');
    expect(reduced.display, 'the text stays, static and centred').not.toBe('none');
    expect(reduced.justify).toBe('center');

    await context.close();
  });

  test('desktop (pointer: fine) gets no hint and keeps the A1 buttons', async ({ browser }) => {
    const store = makeStore();
    const { context, page } = await openIdleHome(browser, {
      width: 1280,
      height: 900,
      mobile: false,
      getTasks: store.getTasks,
      onWrite: store.onWrite,
    });
    await expect(page.locator('.lg-utask')).toHaveCount(10);

    const display = await page.evaluate(
      () => getComputedStyle(document.querySelector('.lg-uhint') as HTMLElement).display,
    );
    expect(display, 'no swipe hint where there are no swipes').toBe('none');

    // and the A1 controls still write exactly what they used to
    await page.getByRole('button', { name: 'Complete A2 task 1', exact: true }).click();
    await expect.poll(() => store.state.writes.length, { timeout: 10_000 }).toBe(1);
    expect(store.state.writes[0].body).toEqual({ status: 'completed' });

    await context.close();
  });

  test('consecutive swipes keep working: right, right again, left, right (device-found regression)', async ({ browser }) => {
    test.setTimeout(90_000);
    // 2026-08-01, Igor's phone: ONE successful right swipe, then the feature
    // was dead. Root cause: the success path never cleared mode 'exit' (the
    // refill unmounts the row before transitionend), and touchStart refuses
    // every gesture while an exit is in flight. This test swipes FOUR times
    // in a row, which the original single-swipe test never did.
    const store = makeStore();
    const { context, page } = await openPhone(browser, store);

    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 1');
    await touchDrag(page, '.lg-utask', 160);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 2', { timeout: 10_000 });

    // The regression: this second swipe used to be silently ignored.
    await touchDrag(page, '.lg-utask', 160);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 3', { timeout: 10_000 });
    const completions = store.state.writes.filter((w) => w.method === 'PATCH' && w.body?.status === 'completed');
    expect(completions.length, 'both right swipes wrote a completion').toBe(2);

    // Left after rights: dismiss still works...
    await touchDrag(page, '.lg-utask', -160);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 4', { timeout: 10_000 });
    expect(await dismissedIds(page), 'task 3 set aside').toContain('a2-3');

    // ...and a right after the left still lands.
    await touchDrag(page, '.lg-utask', 160);
    await expect(page.locator('.lg-utask .lg-utitle').first()).toHaveText('A2 task 5', { timeout: 10_000 });

    await context.close();
  });
});
