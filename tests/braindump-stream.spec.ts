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
test.describe('step-1 dynamic bar layout', () => {
  type SeedTask = {
    id: string;
    title: string;
    status: string;
    due_date: string | null;
    project_id: string | null;
    priority: string;
  };

  async function openIdleHome(
    browser: Browser,
    opts: StandaloneOpts & { url?: string; tasks?: SeedTask[] },
  ) {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      isMobile: opts.mobile ?? true,
      hasTouch: opts.mobile ?? true,
      timezoneId: 'UTC',
    });
    await installIntercepts(context);
    // seeded open tasks + count 42 so the Today's Focus card actually renders
    await context.route('**/rest/v1/focusos_tasks**', (route) => {
      const tasks: SeedTask[] =
        opts.tasks ??
        [1, 2, 3].map((i) => ({
          id: `upnext-${i}`,
          title: `Seeded task ${i}`,
          status: 'todo',
          due_date: null,
          project_id: null,
          priority: 'medium',
        }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-range': '0-2/42', 'access-control-expose-headers': 'content-range' },
        body: JSON.stringify(tasks),
      });
    });
    const page = await context.newPage();
    await seedSession(page);
    if (opts.standalone) await forceStandalone(page);
    await page.goto(opts.url ?? '/home?fakedump=0');
    await page.waitForSelector('.lg-upnext', { timeout: 20_000 });
    return { context, page };
  }

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
    expect(g.actionsMarginBottom, 'orb block dropped to 72px').toBe('72px');
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
    await page.screenshot({ path: 'test-results/step1-desktop.png' });
    await context.close();
  });

  test("today's focus ranking: fossils demoted, priority rules the tiers, tap navigates", async ({ browser }) => {
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
    // future task; the 60-day urgent fossil must be nowhere in the top 3.
    await expect(page.locator('.lg-utask .lg-utitle')).toHaveText([
      'newover-med',
      'today-low',
      'future-urgent',
    ]);

    await page.locator('.lg-utask').first().click();
    await expect(page).toHaveURL(/\/app$/);
    await context.close();
  });
});
