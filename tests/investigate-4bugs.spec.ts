/**
 * INVESTIGATION HARNESS — Focus OS task 190c5048 (4 bugs from Igor's 07-24 video).
 * NOT part of the regression suite: gated behind PROBE4BUGS=1 so plain
 * `npx playwright test` never runs it. No app code is touched.
 *
 * Strategy: real signup (throwaway account, established practice) for a real
 * Supabase session, then intercept PostgREST reads so the client data layer is
 * exercised deterministically. Phase 'happy' serves one task + one project;
 * phase 'empty' models the failure road (tokenless-RLS empty / transient error
 * accepted as []). A page reload models the React-Query GC eviction of the
 * observer-less fetchQuery cache entries (default gcTime 5 min — no useQuery
 * observer exists anywhere for the tasks/projects keys, so entries die 5 min
 * after fetch; reload = same cold-cache state without the 5-min wait).
 *
 * Run:
 *   PROBE4BUGS=1 npx playwright test tests/investigate-4bugs.spec.ts
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.skip(!process.env.PROBE4BUGS, 'investigation harness — run with PROBE4BUGS=1');

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.join('test-results', '4bugs-evidence');
const CREDS_FILE = path.join(EVIDENCE_DIR, 'probe-creds.json');
const STATE_FILE = path.join(EVIDENCE_DIR, 'probe-state.json');

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const TASK_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

function todayNoonIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

const taskRow = () => ({
  id: TASK_ID,
  title: 'Probe task today',
  description: null,
  priority: 'high',
  status: 'todo',
  start_date: null,
  end_date: null,
  due_date: todayNoonIso(),
  timer_total_seconds: 0,
  timer_is_running: false,
  timer_start_time: null,
  project_id: PROJECT_ID,
  sort_order: 0,
  completed_by_email: null,
  assigned_to_email: null,
  change_request_message: null,
  google_calendar_event_id: null,
  created_at: new Date().toISOString(),
  images: [],
});


const taskRowOther = () => ({
  ...taskRow(),
  id: 'dddddddd-4444-4444-8444-dddddddddddd',
  title: 'Probe task other',
  due_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
});

const projectRow = (userId: string) => ({
  id: PROJECT_ID,
  name: 'Probe project',
  color: '#B8572E',
  is_shared: false,
  user_id: userId,
  created_at: new Date().toISOString(),
});

const prefRow = (userId: string) => ({
  id: 'cccccccc-3333-4333-8333-cccccccccccc',
  user_id: userId,
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
});

// Mutable knobs the route handler reads on every request.
const knobs = {
  dataPhase: 'happy' as 'happy' | 'empty',
  meetingsDelayMs: 0,
  meetingsRequests: 0,
  userId: 'unknown',
};

async function installRestIntercepts(context: BrowserContext) {
  await context.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const accept = (req.headers()['accept'] || '');
    const wantsObject = accept.includes('vnd.pgrst.object');
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (method !== 'GET' && method !== 'HEAD') {
      // inserts/updates (profile, prefs, tour flags…) — generic success
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow(knobs.userId) : [prefRow(knobs.userId)]);
      return reply(wantsObject ? {} : []);
    }
    if (url.includes('focusos_user_preferences')) {
      return reply(wantsObject ? prefRow(knobs.userId) : [prefRow(knobs.userId)]);
    }
    if (url.includes('focusos_tasks')) {
      return reply(knobs.dataPhase === 'happy' ? [taskRow(), taskRowOther()] : []);
    }
    if (url.includes('focusos_projects')) {
      return reply(knobs.dataPhase === 'happy' ? [projectRow(knobs.userId)] : []);
    }
    if (url.includes('focusos_meetings')) {
      knobs.meetingsRequests += 1;
      if (knobs.meetingsDelayMs) await new Promise((r) => setTimeout(r, knobs.meetingsDelayMs));
      return reply([]);
    }
    return reply(wantsObject ? {} : []);
  });
  // Edge functions (rsvp sync etc) — instant success, keeps runs deterministic.
  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

async function extractUserId(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
        try {
          const v = JSON.parse(localStorage.getItem(k) || '{}');
          return v?.user?.id || 'unknown';
        } catch {
          return 'unknown';
        }
      }
    }
    return 'unknown';
  });
}

test.describe.serial('4-bugs investigation', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test('bug1: task list vanishes after Meetings visit (void + GRID icon + sticky)', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext();
    await installRestIntercepts(context);
    const page = await context.newPage();

    // --- Throwaway signup (real auth, everything else intercepted) ---
    const stamp = Date.now();
    const email = `focusos.probe4bugs+${stamp}@thefeedbackapp.net`;
    const password = `Probe4bugs!${stamp}`;
    await page.goto('/auth');
    await page.getByRole('tab', { name: /sign up/i }).click();
    await page.locator('#signup-firstname').fill('Probe');
    await page.locator('#signup-lastname').fill('FourBugs');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-password').fill(password);
    await page.getByRole('button', { name: /sign up/i }).click();
    await page.waitForURL((u) => !u.pathname.includes('/auth'), { timeout: 30_000 });
    knobs.userId = await extractUserId(page);
    fs.writeFileSync(CREDS_FILE, JSON.stringify({ email, password }));

    // --- Happy pre-state: /app?view=today shows the task, LIST view active ---
    knobs.dataPhase = 'happy';
    await page.goto('/app?view=today');
    await expect(page.getByText('Probe task today')).toBeVisible({ timeout: 20_000 });
    const listBtn = page.locator('.lg-seg button', { hasText: 'List' }).first();
    const gridBtn = page.locator('.lg-seg button', { hasText: 'Grid' }).first();
    await expect(listBtn).toHaveClass(/on/);
    await expect(gridBtn).not.toHaveClass(/on/);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'bug1-1-happy.png'), fullPage: false });
    fs.writeFileSync(STATE_FILE, JSON.stringify(await context.storageState()));

    // --- Visit Meetings, then model the GC'd cache (reload) + failure road ---
    await page.getByRole('button', { name: /^meetings$/i }).click().catch(async () => {
      await page.goto('/meetings');
    });
    await page.waitForURL(/\/meetings/, { timeout: 15_000 });
    knobs.dataPhase = 'empty'; // from here every tasks/projects read returns []
    await page.reload(); // fresh JS heap = the state after React-Query GC eviction
    await page.waitForTimeout(2_000);

    // --- Return to Today ---
    await page.goto('/app?view=today');
    // empty-success retry burns ~2×(500+1500)ms before [] is accepted; wait it out
    await page.waitForTimeout(7_000);

    const voidState = {
      taskVisible: await page.getByText('Probe task today').isVisible().catch(() => false),
      skeletonPresent: await page.locator('.animate-pulse').first().isVisible().catch(() => false),
      gridActive: await gridBtn.getAttribute('class').then((c) => /\bon\b/.test(c || '')),
      listActive: await listBtn.getAttribute('class').then((c) => /\bon\b/.test(c || '')),
      anyToast: await page.locator('[data-sonner-toast]').count(),
      bodyTextSample: (await page.locator('.lg-maincol').innerText().catch(() => '')).slice(0, 400),
    };
    console.log('[bug1] post-return state:', JSON.stringify(voidState, null, 2));
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'bug1-2-void.png'), fullPage: false });

    expect(voidState.taskVisible, 'task list should have vanished').toBe(false);
    // Since fix 2 the prefs resolve during render and can no longer starve: the void now
    // keeps the user's LIST view (pre-fix-2 it flipped to the hardcoded GRID default).
    expect(voidState.gridActive, 'view stays LIST even in the void (fix 2)').toBe(false);
    expect(voidState.listActive, 'user default LIST retained (fix 2)').toBe(true);

    // --- Stickiness while the failure persists: Igor's nav mash Today→Meetings→Today.
    // Every remount either serves the cached-fresh [] or fresh-refetches into the same
    // empty answer; there is no error surface and no retry affordance.
    await page.goto('/meetings');
    await page.waitForTimeout(1_500);
    await page.goto('/app?view=today');
    await page.waitForTimeout(7_000);
    const stillVoid = !(await page.getByText('Probe task today').isVisible().catch(() => false));
    console.log('[bug1] still void after Today→Meetings→Today mash (failure persisting):', stillVoid);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'bug1-3-sticky-void.png'), fullPage: false });
    expect(stillVoid, 'void persists across /app↔/meetings navigation while reads stay empty').toBe(true);

    // --- Recovery path: backend healthy again + a window focus → the debounced
    // resync safety net (fetchAllTasks fresh) restores TASKS — but it never
    // refetches PROJECTS, so the prefs-apply effect stays starved and the
    // user's LIST default remains lost (view stuck on GRID).
    knobs.dataPhase = 'happy';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(4_500);
    const healedTaskVisible = await page.getByText('Probe task today').isVisible().catch(() => false);
    const gridStillActive = /\bon\b/.test((await gridBtn.getAttribute('class')) || '');
    console.log('[bug1] after recovery+focus: taskVisible=', healedTaskVisible, 'gridStillActive=', gridStillActive);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'bug1-4-healed.png'), fullPage: false });
    expect(healedTaskVisible, 'focus-resync heals tasks once backend recovers').toBe(true);
    expect(gridStillActive, 'view stays LIST through heal (fix 2 — no GRID stick)').toBe(false);

    await context.close();
  });

  test('bug3: Welcome back toast duration', async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    await installRestIntercepts(context);
    knobs.dataPhase = 'happy';
    const page = await context.newPage();
    const { email, password } = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));

    await page.goto('/auth');
    await page.locator('#signin-email').fill(email);
    await page.locator('#signin-password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    const toast = page.locator('[data-sonner-toast]', { hasText: 'Welcome back' });
    await toast.waitFor({ state: 'visible', timeout: 15_000 });
    const t0 = Date.now();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'bug3-toast-at-0.8s.png') });
    await toast.waitFor({ state: 'hidden', timeout: 15_000 });
    const visibleMs = Date.now() - t0;
    console.log(`[bug3] toast visible for ~${visibleMs}ms`);
    // FIX 3: the login toast is now capped at 1500ms (pre-fix this asserted the 4s default)
    expect(visibleMs, 'welcome toast dismisses quickly (duration: 1500)').toBeLessThan(2_600);

    await context.close();
  });

  test('bug4: Meetings skeleton + network refetch on every visit', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ storageState: STATE_FILE });
    await installRestIntercepts(context);
    knobs.dataPhase = 'happy';
    knobs.meetingsDelayMs = 400; // realistic REST latency so the skeleton is observable
    knobs.meetingsRequests = 0;
    const page = await context.newPage();

    await page.goto('/app?view=today');
    await expect(page.getByText('Probe task today')).toBeVisible({ timeout: 20_000 });

    // SPA navigation via the dock buttons — Igor's real flow. page.goto() would be a
    // hard reload that wipes the in-memory React-Query cache and masks the fix.
    const visitAndProbe = async (n: number) => {
      const before = knobs.meetingsRequests;
      await page.locator('[data-home-tour-step="meetings"]').click();
      await page.waitForURL(/\/meetings/);
      const skeletonSeen = await page
        .locator('.animate-pulse')
        .first()
        .isVisible()
        .catch(() => false);
      await page.waitForTimeout(1_200);
      const requests = knobs.meetingsRequests - before;
      console.log(`[bug4] visit ${n}: skeleton=${skeletonSeen} meetingsRequests=${requests}`);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `bug4-visit${n}.png`) });
      await page.locator('[data-home-tour-step="today"]').click();
      await page.waitForURL(/\/app/);
      await page.waitForTimeout(800);
      return { skeletonSeen, requests };
    };

    // FIX 1 (gcTime + quiet warm refresh) verification: first visit fetches once with a
    // skeleton; later visits inside staleTime serve the cache — no skeleton, no network.
    // (Pre-fix this test asserted the inverse: skeleton + refetch on EVERY visit.)
    const v1 = await visitAndProbe(1);
    const v2 = await visitAndProbe(2);
    const v3 = await visitAndProbe(3);
    expect(v1.skeletonSeen, 'first (cold) visit shows the skeleton').toBe(true);
    expect(v1.requests, 'first (cold) visit fetches over the network').toBeGreaterThan(0);
    expect(v2.skeletonSeen, 'second visit: no skeleton (cache-served)').toBe(false);
    expect(v2.requests, 'second visit: zero network (cache-served)').toBe(0);
    expect(v3.skeletonSeen, 'third visit: no skeleton (cache-served)').toBe(false);
    expect(v3.requests, 'third visit: zero network (cache-served)').toBe(0);

    await context.close();
  });


  test('fix2: no wrong-view frame on /app re-entries (Projects/Today/Past Due)', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext();
    await installRestIntercepts(context);
    knobs.dataPhase = 'happy';
    const page = await context.newPage();

    // fresh throwaway account (self-sufficient — does not depend on test order)
    const stamp = Date.now();
    const email = `focusos.probe4bugs+${stamp}@thefeedbackapp.net`;
    const password = `Probe4bugs!${stamp}`;
    await page.goto('/auth');
    await page.getByRole('tab', { name: /sign up/i }).click();
    await page.locator('#signup-firstname').fill('Probe');
    await page.locator('#signup-lastname').fill('FlashCheck');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-password').fill(password);
    await page.getByRole('button', { name: /sign up/i }).click();
    await page.waitForURL((u) => !u.pathname.includes('/auth'), { timeout: 30_000 });
    knobs.userId = await extractUserId(page);

    // warm baseline once so the re-entry path (the flash path) has a warm cache
    await page.goto('/app?view=today');
    await expect(page.getByText('Probe task today')).toBeVisible({ timeout: 20_000 });
    await page.goto('/home');
    await page.waitForTimeout(1_000);

    // rAF frame logger: records any frame showing grid cards or the not-due-today task
    await page.evaluate(() => {
      const w = window as any;
      w.__badFrames = [];
      let last = '';
      const tick = () => {
        const grid = document.querySelectorAll('.lg-grid-card').length;
        const other = !!Array.from(document.querySelectorAll('[data-task-card], .lg-grid-card'))
          .find((e) => /Probe task other/.test(e.textContent || ''));
        const sig = `${location.search}|g${grid}|o${other}`;
        if (sig !== last) {
          last = sig;
          if (grid > 0 || other) {
            w.__badFrames.push({ t: Math.round(performance.now()), search: location.search, grid, other });
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // Igor's exact sequence via the dock (SPA taps, no reloads)
    await page.locator('[data-home-tour-step="projects"]').click();
    await page.waitForURL(/\/app/);
    await page.waitForTimeout(2_500);
    // the drawer opens over the dock (real behaviour) — dismiss via the overlay first
    await page.touchscreen.tap(350, 400);
    await page.waitForTimeout(600);
    await page.locator('[data-home-tour-step="meetings"]').click();
    await page.waitForURL(/\/meetings/);
    await page.waitForTimeout(1_500);
    await page.locator('[data-home-tour-step="today"]').click();
    await page.waitForURL(/view=today/);
    await page.waitForTimeout(2_500);
    await page.locator('[data-home-tour-step="past-due"]').click();
    await page.waitForURL(/view=past-due/);
    await page.waitForTimeout(2_500);

    const badFrames = await page.evaluate(() => (window as any).__badFrames);
    console.log('[fix2] bad frames:', JSON.stringify(badFrames));
    expect(badFrames, 'no frame may show grid cards or unfiltered (not-due-today) tasks').toEqual([]);
    // and the end state is the correct one
    await expect(page.getByText('Probe task today')).not.toBeVisible(); // past-due holds no today task
    await context.close();
  });

  test('bug2: login dead-air timeline (throttled)', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    await installRestIntercepts(context);
    knobs.dataPhase = 'happy';
    knobs.meetingsDelayMs = 0;
    const page = await context.newPage();
    const { email, password } = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));

    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 200_000, // ~1.6 Mbps
      uploadThroughput: 94_000,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.goto('/auth');
    await page.locator('#signin-email').fill(email);
    await page.locator('#signin-password').fill(password);

    const timeline: Array<Record<string, unknown>> = [];
    const t0 = Date.now();
    await page.getByRole('button', { name: /sign in/i }).click();
    for (let i = 0; i < 60; i++) {
      const sample = await page
        .evaluate(() => ({
          path: location.pathname + location.search,
          spinner: !!document.querySelector('.animate-spin'),
          skeleton: !!document.querySelector('.animate-pulse'),
          taskCard: !!document.querySelector('[data-task-card], .lg-grid-card'),
          textLen: (document.body.innerText || '').trim().length,
        }))
        .catch(() => null);
      if (sample) timeline.push({ t: Date.now() - t0, ...sample });
      await page.waitForTimeout(200);
    }
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'bug2-timeline.json'), JSON.stringify(timeline, null, 2));

    // longest contiguous window with no meaningful content painted
    let worst = { start: 0, len: 0 };
    let curStart = -1;
    for (const s of timeline) {
      const blank = !(s as any).taskCard && !(s as any).skeleton && (s as any).textLen < 60;
      if (blank && curStart < 0) curStart = s.t as number;
      if (!blank && curStart >= 0) {
        if ((s.t as number) - curStart > worst.len) worst = { start: curStart, len: (s.t as number) - curStart };
        curStart = -1;
      }
    }
    if (curStart >= 0) {
      const last = timeline[timeline.length - 1].t as number;
      if (last - curStart > worst.len) worst = { start: curStart, len: last - curStart };
    }
    console.log(`[bug2] longest no-content window: ${worst.len}ms starting at +${worst.start}ms`);
    console.log('[bug2] timeline written to bug2-timeline.json');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'bug2-final.png') });

    await context.close();
  });
});
