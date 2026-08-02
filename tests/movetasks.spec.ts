/**
 * MOVE TASKS (reorder mode) regression suite — 2026-08-02.
 *
 * Device-proven bug (screen recording, iOS): with "Move Tasks" active on /app
 *   (a) the dragged card's ghost renders OFFSET from the finger, so the drop
 *       lands somewhere other than where the user is pointing, and
 *   (b) mid-drag iOS raises its text-selection loupe / highlight over the list.
 *
 * The rig here is Chromium with emulated touch, so it cannot reproduce the iOS
 * loupe itself (that is a WebKit UI affordance, not a DOM state). What it CAN
 * prove, and what these tests lock, is the mechanism behind both symptoms:
 *   - the DragOverlay is `position: fixed`, and every ancestor of it inside the
 *     liquid-glass shell that carries `backdrop-filter` becomes its containing
 *     block — so the ghost is laid out relative to `.lg-content`, not the
 *     viewport, and drifts away from the finger by that panel's origin;
 *   - reorder mode leaves the rows text-selectable (`user-select: auto`), which
 *     is exactly the state iOS needs to raise the loupe on a long press.
 *
 * HERMETIC, modelled on tests/onebar.spec.ts: seeded localStorage session +
 * intercepted PostgREST, no real Supabase. Five `todo` tasks in ONE priority
 * group (medium) with sort_order 0..4, so the resulting order after a drag is
 * unambiguous and the reorder write is exactly assertable.
 *
 * Touch is dispatched through CDP `Input.dispatchTouchEvent` (the same pipeline
 * tests/braindump-stream.spec.ts's A2 swipe suite uses), because dnd-kit's
 * TouchSensor needs a real touchstart -> hold -> touchmove -> touchend sequence.
 *
 * Selector note: the grip handle is matched by `.cursor-grab`, a class that is
 * present both before and after the fix, so the same spec runs against both.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { USER_ID, USER_EMAIL, seedSession } from './helpers/braindumpEnv';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_NAME = 'Move probe project';

const MOBILE = { width: 393, height: 852 };
const DESKTOP = { width: 1280, height: 900 };

const TITLES = ['Move task 1', 'Move task 2', 'Move task 3', 'Move task 4', 'Move task 5'];
const taskId = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;

function todayNoonIso(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

/** Five same-priority todo rows: the drag result is a pure permutation. */
const TASK_ROWS = TITLES.map((title, i) => ({
  id: taskId(i + 1),
  title,
  description: null,
  priority: 'medium',
  status: 'todo',
  start_date: null,
  end_date: null,
  due_date: todayNoonIso(),
  timer_total_seconds: 0,
  timer_is_running: false,
  timer_start_time: null,
  project_id: PROJECT_ID,
  sort_order: i,
  completed_by_email: null,
  assigned_to_email: null,
  change_request_message: null,
  google_calendar_event_id: null,
  created_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
}));

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

interface Write {
  method: string;
  url: string;
  body: any;
}

async function installIntercepts(context: BrowserContext, writes: Write[]): Promise<void> {
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
      if (url.includes('focusos_tasks')) {
        let body: any = null;
        try {
          body = req.postDataJSON();
        } catch {
          body = req.postData();
        }
        writes.push({ method, url, body });
      }
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
      return reply(wantsObject ? {} : []);
    }
    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_tasks')) {
      if (url.includes('status=neq.completed')) return reply(TASK_ROWS);
      if (url.includes('status=eq.completed')) return reply([]);
      return reply([]); // deferred image hydration
    }
    if (url.includes('focusos_projects')) return reply([projectRow()]);
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

async function openApp(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page; writes: Write[] }> {
  const touch = viewport.width < 1024;
  const writes: Write[] = [];
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    timezoneId: 'UTC',
  });
  await installIntercepts(context, writes);
  const page = await context.newPage();
  await seedSession(page);
  await page.goto(`/app?view=${PROJECT_ID}`);
  await expect(page.locator('.lg-rows [data-task-card]').first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.lg-rows [data-task-card]')).toHaveCount(5);
  return { context, page, writes };
}

/** The rendered top-to-bottom order of the five seeded rows. */
async function rowOrder(page: Page): Promise<string[]> {
  return page.evaluate((titles: string[]) => {
    const cards = Array.from(document.querySelectorAll('.lg-rows [data-task-card]')) as HTMLElement[];
    return cards.map((c) => titles.find((t) => (c.innerText || '').includes(t)) ?? '?');
  }, TITLES);
}

/**
 * Enter reorder mode. On mobile Move Tasks lives in the one-bar context sheet
 * (open via the title chip); on desktop it is the project-banner button.
 */
async function enterReorderMode(page: Page, touch: boolean): Promise<void> {
  if (touch) {
    await page.locator('[data-testid="onebar-title"]').tap();
    await expect(page.locator('[data-testid="onebar-context-sheet"]')).toBeVisible();
    await page.locator('[data-testid="onebar-reorder"]').tap();
    await expect(page.locator('[data-testid="onebar-context-sheet"]')).toHaveCount(0);
  } else {
    await page.getByRole('button', { name: 'Move Tasks' }).click();
  }
  await expect(page.locator('.lg-rows .cursor-grab')).toHaveCount(5);
}

interface MidDrag {
  hasOverlay: boolean;
  overlay: { x: number; y: number; w: number; h: number } | null;
  selection: string;
  rowUserSelect: string;
  listUserSelect: string;
  gripTouchAction: string | null;
  calloutSupported: boolean;
  listCallout: string;
}

/** Everything only readable with the finger still down. */
async function readMidDrag(page: Page): Promise<MidDrag> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-task-card]')) as HTMLElement[];
    const inList = all.filter((c) => c.closest('.lg-rows'));
    const overlayCard = all.find((c) => !c.closest('.lg-rows')) ?? null;
    const r = overlayCard ? overlayCard.getBoundingClientRect() : null;
    const grip = document.querySelector('.lg-rows .cursor-grab') as HTMLElement | null;
    // The list container the DndContext renders (parent of the priority groups).
    const list = inList[0] ? (inList[0].closest('.lg-rows')!.parentElement!.parentElement as HTMLElement) : null;
    const calloutSupported =
      typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('-webkit-touch-callout', 'none');
    return {
      hasOverlay: !!overlayCard,
      overlay: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      selection: window.getSelection()?.toString() ?? '',
      rowUserSelect: inList[0] ? getComputedStyle(inList[0]).userSelect : '',
      listUserSelect: list ? getComputedStyle(list).userSelect : '',
      gripTouchAction: grip ? getComputedStyle(grip).touchAction : null,
      calloutSupported,
      listCallout: list ? getComputedStyle(list).getPropertyValue('-webkit-touch-callout') : '',
    };
  });
}

/**
 * Long-press the nth grip, drag the finger to `toY`, run `beforeRelease` with
 * the finger still down, then lift. Dispatched through Chromium's real input
 * pipeline via CDP so dnd-kit's TouchSensor sees genuine touch events.
 */
async function touchDragGrip(
  page: Page,
  nth: number,
  toY: number,
  opts: { holdMs?: number; steps?: number; beforeRelease?: (finger: { x: number; y: number }) => Promise<void> } = {},
): Promise<void> {
  const holdMs = opts.holdMs ?? 450;
  const steps = opts.steps ?? 24;
  const box = await page.locator('.lg-rows .cursor-grab').nth(nth).boundingBox();
  if (!box) throw new Error(`no bounding box for grip ${nth}`);
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    // Hold still: TouchSensor's activation constraint is a delay with a small
    // movement tolerance, so nothing may move during this window.
    await page.waitForTimeout(holdMs);
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x0, y: y0 + ((toY - y0) * i) / steps }],
      });
    }
    // Let dnd-kit's rAF-driven transform settle before anything is read.
    await page.waitForTimeout(120);
    if (opts.beforeRelease) await opts.beforeRelease({ x: x0, y: toY });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/** id -> sort_order from the PATCH burst handleBatchUpdateTasks fires. */
function sortOrderWrites(writes: Write[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of writes) {
    if (w.method !== 'PATCH') continue;
    const m = /id=eq\.([0-9a-f-]+)/.exec(decodeURIComponent(w.url));
    if (!m || !w.body || typeof w.body.sort_order !== 'number') continue;
    out[m[1]] = w.body.sort_order;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. THE FINGER-ACCURACY TEST (the one that must fail before the fix).
//    Mid-drag, the ghost must be under the finger; on release the grabbed task
//    must land exactly where the finger stopped, and the write must say so.
// ---------------------------------------------------------------------------
test('393x852: the drag ghost tracks the finger and the drop matches the finger travel', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, writes } = await openApp(browser, MOBILE);
  await enterReorderMode(page, true);
  expect(await rowOrder(page)).toEqual(TITLES);

  // Finger target: the centre of row 3's grip, i.e. two rows down.
  const row3 = await page.locator('.lg-rows .cursor-grab').nth(2).boundingBox();
  const targetY = row3!.y + row3!.height / 2;

  writes.length = 0;
  let mid: MidDrag | null = null;
  let finger = { x: 0, y: 0 };

  await touchDragGrip(page, 0, targetY, {
    beforeRelease: async (f) => {
      finger = f;
      mid = await readMidDrag(page);
    },
  });

  const m = mid!;
  expect(m.hasOverlay, 'a DragOverlay ghost exists while the finger is down').toBe(true);

  // FINGER ACCURACY: the finger must be INSIDE the ghost, and (because the grab
  // started on the grip, which is vertically centred on the row) within a dozen
  // pixels of the ghost's vertical centre.
  const o = m.overlay!;
  expect(finger.y, `ghost top ${o.y.toFixed(1)} is below the finger`).toBeGreaterThanOrEqual(o.y - 4);
  expect(finger.y, `ghost bottom ${(o.y + o.h).toFixed(1)} is above the finger`).toBeLessThanOrEqual(
    o.y + o.h + 4,
  );
  expect(finger.x, `ghost left ${o.x.toFixed(1)} is right of the finger`).toBeGreaterThanOrEqual(o.x - 4);
  expect(finger.x, `ghost right ${(o.x + o.w).toFixed(1)} is left of the finger`).toBeLessThanOrEqual(
    o.x + o.w + 4,
  );
  expect(
    Math.abs(finger.y - (o.y + o.h / 2)),
    'the ghost is vertically centred on the finger, not drifted',
  ).toBeLessThanOrEqual(12);

  // DROP ACCURACY: task 1 lands in slot 3 (where the finger stopped), the two
  // rows it passed shift up, the tail is untouched.
  await expect
    .poll(() => rowOrder(page), { timeout: 10_000 })
    .toEqual(['Move task 2', 'Move task 3', 'Move task 1', 'Move task 4', 'Move task 5']);

  // WRITE: the same permutation reaches the DB as sort_order 0..4.
  await expect.poll(() => Object.keys(sortOrderWrites(writes)).length, { timeout: 10_000 }).toBe(5);
  expect(sortOrderWrites(writes)).toEqual({
    [taskId(2)]: 0,
    [taskId(3)]: 1,
    [taskId(1)]: 2,
    [taskId(4)]: 3,
    [taskId(5)]: 4,
  });

  await context.close();
});

// ---------------------------------------------------------------------------
// 2. NO TEXT SELECTION / LOUPE SURFACE while reorder mode is active.
//    iOS raises the selection loupe on a long press over selectable text; the
//    only DOM-side defence is user-select/touch-callout off, plus the grip
//    owning the gesture with touch-action: none.
// ---------------------------------------------------------------------------
test('393x852: reorder mode kills text selection and the grip owns the gesture', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await openApp(browser, MOBILE);

  // Before reorder mode nothing is locked down — the rows are normal text.
  const before = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.lg-rows [data-task-card]') as HTMLElement).userSelect,
  );
  expect(before, 'outside reorder mode the rows stay selectable (scope guard)').not.toBe('none');

  await enterReorderMode(page, true);

  const row3 = await page.locator('.lg-rows .cursor-grab').nth(2).boundingBox();
  const targetY = row3!.y + row3!.height / 2;

  let mid: MidDrag | null = null;
  await touchDragGrip(page, 0, targetY, {
    beforeRelease: async () => {
      mid = await readMidDrag(page);
    },
  });

  const m = mid!;
  expect(m.selection, 'no text got selected by the long press').toBe('');
  expect(m.rowUserSelect, 'rows are unselectable while reorder mode is active').toBe('none');
  expect(m.listUserSelect, 'the list container carries the lock').toBe('none');
  expect(m.gripTouchAction, 'the grip takes the gesture away from the scroller').toBe('none');
  if (m.calloutSupported) {
    expect(m.listCallout, 'the iOS callout/loupe is suppressed on the list').toBe('none');
  }

  // The lock is scoped: leaving reorder mode restores normal selection.
  await page.locator('[data-testid="onebar-title"]').tap();
  await expect(page.locator('[data-testid="onebar-context-sheet"]')).toBeVisible();
  await page.locator('[data-testid="onebar-reorder"]').tap();
  await expect(page.locator('.lg-rows .cursor-grab')).toHaveCount(0);
  const after = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.lg-rows [data-task-card]') as HTMLElement).userSelect,
  );
  expect(after, 'leaving reorder mode gives the text back').not.toBe('none');

  await context.close();
});

// ---------------------------------------------------------------------------
// 3. DESKTOP REGRESSION: the mouse drag still reorders correctly (PointerSensor
//    config is deliberately untouched by the fix).
// ---------------------------------------------------------------------------
test('1280x900: desktop mouse drag still reorders', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page, writes } = await openApp(browser, DESKTOP);
  await enterReorderMode(page, false);
  expect(await rowOrder(page)).toEqual(TITLES);

  const from = await page.locator('.lg-rows .cursor-grab').nth(0).boundingBox();
  const to = await page.locator('.lg-rows .cursor-grab').nth(2).boundingBox();
  const x0 = from!.x + from!.width / 2;
  const y0 = from!.y + from!.height / 2;
  const y1 = to!.y + to!.height / 2;

  writes.length = 0;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 24; i += 1) {
    await page.mouse.move(x0, y0 + ((y1 - y0) * i) / 24);
  }
  await page.waitForTimeout(120);
  await page.mouse.up();

  await expect
    .poll(() => rowOrder(page), { timeout: 10_000 })
    .toEqual(['Move task 2', 'Move task 3', 'Move task 1', 'Move task 4', 'Move task 5']);
  await expect.poll(() => Object.keys(sortOrderWrites(writes)).length, { timeout: 10_000 }).toBe(5);
  expect(sortOrderWrites(writes)).toEqual({
    [taskId(2)]: 0,
    [taskId(3)]: 1,
    [taskId(1)]: 2,
    [taskId(4)]: 3,
    [taskId(5)]: 4,
  });

  await context.close();
});
