// TOUCH-SAFE DIALOGS ACROSS THE APP (O6, 2026-08-23).
//
// O4 proved on the iPhone16-P4-393 iOS 26.3 sim that Radix's MODAL dialog path
// installs react-remove-scroll, whose non-passive document 'touchmove' listener
// preventDefault()s an iOS selection-handle drag, and shipped the cure for the
// Edit Task sheet alone. O6 turned that cure into a house primitive
// (src/components/ui/touch-dialog.tsx) and put every dialog that holds a text
// field behind it, on phones AND on any coarse pointer (an iPad is >= 768px, so
// useIsMobile is false there and the modal path used to win).
//
// This spec walks the converted dialogs on the real demo account and the real
// Supabase backend, same shape as tests/edit-dialog-selection.spec.ts: REST
// sign-in, a timestamped throwaway project + task, try/finally cleanup with
// asserted deletes, a stamp-based leak sweep, and raw counts before and after.
// Nothing that can email a human is ever submitted, and every edge function is
// intercepted and fulfilled locally as a second line of defence.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/touch-dialogs.spec.ts
import { test, expect, type Page, type Locator, type BrowserContext, type APIRequestContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

const DESCRIPTION = [
  'the quick brown fox jumps over lazy dogs',
  'every good boy deserves fruit and more cake',
].join('\n');

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

function todayNoonIso(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

// ---- UI helpers -------------------------------------------------------------

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

/** Nothing in this spec presses a Send / Invite / Share button, and this makes
 *  sure a stray click could not reach one anyway: every edge function under
 *  /functions/v1/ is answered locally, so no email can ever leave. */
const blockEdgeFunctions = async (context: BrowserContext, hits: string[]) => {
  await context.route('**/functions/v1/**', async (route) => {
    hits.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
};

const bodyState = (page: Page) =>
  page.evaluate(() => ({
    inlinePointerEvents: document.body.style.pointerEvents,
    computedPointerEvents: getComputedStyle(document.body).pointerEvents,
    sheetOpenClass: document.body.classList.contains('lg-sheet-open'),
    manualOverlays: document.querySelectorAll('[data-sheet-overlay]').length,
    radixOverlays: document.querySelectorAll('.lg-overlay:not([data-sheet-overlay])').length,
  }));

const expectBodyClean = async (page: Page, when: string) => {
  const after = await bodyState(page);
  expect(after.inlinePointerEvents, `body must carry no inline pointer-events ${when}`).not.toBe('none');
  expect(after.computedPointerEvents, `body must still take pointer events ${when}`).not.toBe('none');
  expect(after.sheetOpenClass, `lg-sheet-open must be gone ${when}`).toBe(false);
  expect(after.manualOverlays, `no manual overlay may survive ${when}`).toBe(0);
  expect(after.radixOverlays, `no Radix overlay may survive ${when}`).toBe(0);
};

/** Dispatch a real, cancelable touchmove inside the dialog's first text field
 *  (or, when it holds none, on the dialog itself) and report whether anything
 *  preventDefault()ed it. This is the exact shape react-remove-scroll's
 *  non-passive document listener acts on, and therefore the closest a Chromium
 *  run can get to Igor's iOS selection-handle drag. */
const touchMoveBlockedIn = (dialog: Locator, dx: number, dy: number) =>
  dialog.evaluate((root, [ddx, ddy]) => {
    const el = (root.querySelector('textarea, input[type="text"], input[type="email"], input:not([type])') ??
      root) as HTMLElement;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const mk = (cx: number, cy: number) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [mk(x, y)], targetTouches: [mk(x, y)], changedTouches: [mk(x, y)],
    }));
    const t = mk(x + (ddx as number), y + (ddy as number));
    const move = new TouchEvent('touchmove', {
      bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t],
    });
    el.dispatchEvent(move);
    return move.defaultPrevented;
  }, [dx, dy]);

/** The whole O6 contract for ONE open dialog. `depth` is how many touch-safe
 *  dialogs are open right now (1 unless sheets are stacked). */
const assertTouchSafe = async (page: Page, dialog: Locator, label: string, depth = 1) => {
  await expect(dialog, `${label}: must be visible before it can be checked`).toBeVisible();
  await expect(dialog, `${label}: must publish the non-modal mode`).toHaveAttribute('data-sheet-mode', 'nonmodal');

  const st = await bodyState(page);
  expect(st.inlinePointerEvents, `${label}: a non-modal dialog must never lock body pointer-events`).not.toBe('none');
  expect(st.computedPointerEvents, `${label}: the page behind must still take pointer events`).not.toBe('none');
  expect(st.sheetOpenClass, `${label}: the CSS scroll lock must ride <body> while it is open`).toBe(true);
  expect(st.radixOverlays, `${label}: Radix must render no overlay of its own when modal is false`).toBe(0);
  expect(st.manualOverlays, `${label}: one hand-rendered dim per open touch dialog`).toBe(depth);

  const touchActions = await page
    .locator('[data-sheet-overlay]')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).touchAction));
  expect(touchActions, `${label}: every dim must swallow pans with CSS, not a listener`)
    .toEqual(Array(depth).fill('none'));

  expect(await touchMoveBlockedIn(dialog, 40, 0), `${label}: a horizontal touchmove in its field must NOT be preventDefaulted`).toBe(false);
  expect(await touchMoveBlockedIn(dialog, 0, 40), `${label}: a vertical touchmove in its field must NOT be preventDefaulted`).toBe(false);
};

/** A nested Radix layer opened from inside a non-modal dialog must not dismiss
 *  it. Radix's non-modal branch dismisses on any focusin outside the layer with
 *  no layer guard at all, and on any pointer down outside that is not inside a
 *  pointer-events-disabling layer (a date Popover is NOT one), so without
 *  TouchDialogContent's onInteractOutside rule both would kill the dialog the
 *  moment a nested portal opened. */
const assertNestedLayerSurvives = async (page: Page, dialog: Locator, trigger: Locator, label: string) => {
  await trigger.click();
  const option = page.getByRole('option').first();
  await expect(option, `${label}: the nested layer must open`).toBeVisible({ timeout: 8000 });
  await expect(dialog, `${label}: opening a nested layer must not dismiss the dialog`).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(option, `${label}: Escape must close the nested layer`).toBeHidden({ timeout: 8000 });
  await expect(dialog, `${label}: Escape on the nested layer must leave the dialog open`).toBeVisible();
};

/** Tap the strip of `overlay` that sits above `dialog`, having first proved the
 *  point really is that dim. */
const tapDim = async (page: Page, dialog: Locator, expectedOverlayId: string, label: string) => {
  const box = await dialog.boundingBox();
  expect(box, `${label}: the dialog must have a box to tap above`).not.toBeNull();
  const tapY = Math.max(4, Math.round((box as { y: number }).y / 2));
  const hit = await page.evaluate((y) => {
    const el = document.elementFromPoint(195, y);
    return el ? el.getAttribute('data-sheet-overlay') : null;
  }, tapY);
  expect(hit, `${label}: the point 195,${tapY} must be the topmost dim`).toBe(expectedOverlayId);
  await page.touchscreen.tap(195, tapY);
};

const overlayIds = (page: Page) =>
  page.locator('[data-sheet-overlay]').evaluateAll((els) => els.map((el) => el.getAttribute('data-sheet-overlay')));

/** Dialogs are located by the ATTRIBUTE role, never by getByRole. Radix Select
 *  calls hideOthers() while its listbox is open, which sets aria-hidden on
 *  every other layer: a getByRole('dialog') locator stops matching an open,
 *  perfectly visible dialog the moment a nested Select opens, and would read as
 *  "the nested layer dismissed the dialog" when nothing of the sort happened. */
const dialogWithText = (page: Page, text: string) =>
  page.locator('[role="dialog"]').filter({ hasText: text });

/** The mobile drawer is a portal exposed as role="dialog" aria-label="Projects".
 *  On desktop the sidebar renders inline and no such dialog exists, so opening
 *  it is a no-op there (same shape as tests/projectbar-widths.spec.ts). */
const openProjectsDrawer = async (page: Page) => {
  const drawer = page.getByLabel('Projects');
  if ((await drawer.count()) === 0) return false;
  if ((await drawer.getAttribute('data-state').catch(() => null)) === 'open') return true;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer).toHaveAttribute('data-state', 'open', { timeout: 5000 });
  return true;
};

// ===========================================================================
// PHONE 390x844 — every converted dialog reachable on the demo account.
// ===========================================================================
test.describe('phone 390x844: converted dialogs run the touch-safe path', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('non-modal, one dim each, no touchmove block, nested layers survive, all close clean', async ({ page, context, request }) => {
    test.setTimeout(300_000);
    const s = await restSignIn(request);
    const stamp = Date.now();
    const projectName = `O6 Touch ${stamp}`;
    const taskTitle = `O6 touch ${stamp}`;

    const projectsBefore = await restCount(request, s, 'focusos_projects');
    const tasksBefore = await restCount(request, s, 'focusos_tasks');

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, description: DESCRIPTION,
      status: 'todo', priority: 'medium', due_date: todayNoonIso(),
    });

    const edgeHits: string[] = [];
    let bodyError: Error | null = null;
    try {
      await blockEdgeFunctions(context, edgeHits);
      await signIn(page);
      await page.goto(`${BASE}/app?view=${projectId}`);
      await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible({ timeout: 25000 });

      // ---- Add Task (the onebar-add path) ---------------------------------
      await page.getByTestId('onebar-add').click();
      const addTask = dialogWithText(page, 'Create New Task');
      await assertTouchSafe(page, addTask, 'Add Task');
      // a Select (pointer-events-disabling) and a date Popover (NOT one)
      await assertNestedLayerSurvives(page, addTask, addTask.locator('#priority'), 'Add Task priority Select');
      await addTask.locator('#title').fill(`${taskTitle} typed`);
      await expect(addTask.locator('#title')).toHaveValue(`${taskTitle} typed`);
      await page.keyboard.press('Escape');
      await expect(addTask).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on Add Task');

      // reopen and dismiss it by tapping the dim
      await page.getByTestId('onebar-add').click();
      await expect(addTask).toBeVisible({ timeout: 8000 });
      const [addDim] = await overlayIds(page);
      await tapDim(page, addTask, addDim as string, 'Add Task');
      await expect(addTask, 'a tap on the dim must dismiss Add Task').toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after a dim tap on Add Task');

      // …and the third exit, the X the house DialogContent renders itself.
      await page.getByTestId('onebar-add').click();
      await expect(addTask).toBeVisible({ timeout: 8000 });
      await addTask.getByRole('button', { name: 'Close' }).click();
      await expect(addTask, 'the X must dismiss Add Task').toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after the X on Add Task');

      // ---- Edit Task, and the STACKED case on top of it --------------------
      await page.getByText(taskTitle, { exact: true }).first().click();
      const editSheet = page.locator('.lg-editsheet');
      await expect(editSheet).toBeVisible({ timeout: 10000 });
      await assertTouchSafe(page, editSheet, 'Edit Task');

      // Share, stacked on the sheet. Opened and typed into, NEVER submitted.
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      const shareDialog = dialogWithText(page, 'Add Recipients');
      await assertTouchSafe(page, shareDialog, 'Share (stacked on the Edit sheet)', 2);
      await expect(editSheet, 'opening Share must not dismiss the sheet under it').toBeVisible();
      await shareDialog.locator('#share-email').fill('nobody@example.test');

      // The later portal must win: dim, sheet, dim, dialog in document order.
      const order = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-sheet-overlay], [data-sheet-mode="nonmodal"]'))
          .map((el) => (el.hasAttribute('data-sheet-overlay') ? 'dim' : 'content')));
      expect(order, 'the stacked dialog\'s dim must sit above the sheet beneath it')
        .toEqual(['dim', 'content', 'dim', 'content']);

      // Escape closes ONLY the top layer.
      await page.keyboard.press('Escape');
      await expect(shareDialog).toBeHidden({ timeout: 8000 });
      await expect(editSheet, 'closing Share must leave the Edit sheet open').toBeVisible();
      expect((await bodyState(page)).sheetOpenClass, 'the scroll lock must survive while the sheet under it is still open').toBe(true);

      // …and so does a tap on the TOP dialog's own dim: the sheet below owns a
      // different dim id, so it must ignore that tap entirely.
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await expect(shareDialog).toBeVisible({ timeout: 8000 });
      const ids = await overlayIds(page);
      expect(ids.length, 'two stacked touch dialogs must own two dims').toBe(2);
      expect(ids[0], 'the two dims must be distinguishable').not.toBe(ids[1]);
      await tapDim(page, shareDialog, ids[1] as string, 'Share');
      await expect(shareDialog, 'a tap on the top dim must dismiss Share').toBeHidden({ timeout: 8000 });
      await expect(editSheet, 'a tap on the top dim must NOT dismiss the sheet beneath it').toBeVisible();

      // Hand off to AI, also stacked on the sheet.
      await page.getByTitle('Hand off to AI').click();
      const handoff = dialogWithText(page, 'Send this task as a high-quality prompt');
      await assertTouchSafe(page, handoff, 'Hand off to AI (stacked on the Edit sheet)', 2);
      await page.keyboard.press('Escape');
      await expect(handoff).toBeHidden({ timeout: 8000 });
      await expect(editSheet, 'closing Hand off to AI must leave the Edit sheet open').toBeVisible();

      // The Google Calendar picker only renders when the account is connected.
      const calendarButton = page.getByRole('button', { name: /Google Calendar/i });
      console.log('Google Calendar picker reachable on the demo account:', (await calendarButton.count()) > 0);
      if (await calendarButton.count()) {
        await calendarButton.first().click();
        const picker = dialogWithText(page, 'Add to Google Calendar');
        await assertTouchSafe(page, picker, 'Google Calendar picker (stacked on the Edit sheet)', 2);
        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden({ timeout: 8000 });
        await expect(editSheet).toBeVisible();
      }

      await page.keyboard.press('Escape');
      await expect(editSheet).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on the Edit sheet');

      // ---- Create Project, from the drawer ---------------------------------
      await openProjectsDrawer(page);
      await page.getByRole('button', { name: 'New Project' }).click();
      const createProject = dialogWithText(page, 'Create New Project');
      await assertTouchSafe(page, createProject, 'Create Project');
      await assertNestedLayerSurvives(page, createProject, createProject.getByTestId('create-project-parent'), 'Create Project parent Select');
      await page.keyboard.press('Escape');
      await expect(createProject).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on Create Project');
      // Close the drawer by tapping its own overlay to the right of the 280px
      // panel: the bottom nav's Projects button is underneath that overlay
      // while the drawer is open, so it cannot be clicked to toggle it shut.
      await page.touchscreen.tap(350, 400);
      await expect(page.getByLabel('Projects')).toHaveAttribute('data-state', 'closed', { timeout: 5000 });

      // ---- Invite Project Member, from the onebar context sheet ------------
      await page.getByTestId('onebar-title').click();
      await expect(page.getByTestId('onebar-context-sheet')).toBeVisible({ timeout: 8000 });
      await page.getByTestId('onebar-invite').click();
      // The onebar context Sheet is a MODAL Radix layer and it is still exiting
      // (Presence keeps its DismissableLayer mounted through the close
      // animation), so <body> carries ITS pointer-events lock for a few frames
      // after the Invite dialog opens. Wait that transient out before reading
      // the body, or the assertion blames this dialog for the Sheet's lock.
      await expect(page.getByTestId('onebar-context-sheet')).toHaveCount(0, { timeout: 8000 });
      await page.waitForFunction(() => document.body.style.pointerEvents !== 'none', undefined, { timeout: 8000 });
      const invite = dialogWithText(page, 'Invite to');
      await assertTouchSafe(page, invite, 'Invite Project Member');
      await invite.locator('input[type="email"]').fill('nobody@example.test');
      await page.keyboard.press('Escape');
      await expect(invite).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on Invite Project Member');

      // ---- Settings, from the bottom nav -----------------------------------
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      const settings = page.locator('[role="dialog"]').filter({ has: page.locator('#default-view') });
      await assertTouchSafe(page, settings, 'Settings');
      await assertNestedLayerSurvives(page, settings, settings.locator('#default-view'), 'Settings default-view Select');
      await page.keyboard.press('Escape');
      await expect(settings).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on Settings');

      // Every edge function is fulfilled locally, so nothing can leave the
      // browser; this asserts that none of the MAIL-CAPABLE ones was even
      // reached, i.e. no Send / Invite / Share button was ever pressed.
      expect(edgeHits.filter((p) => /share-item|invite|summary|send/i.test(p)),
        'no mail-capable edge function may be reached').toEqual([]);
      console.log('edge functions reached (all fulfilled locally):', JSON.stringify([...new Set(edgeHits)]));
    } catch (e) {
      bodyError = e as Error;
    }

    // ---- cleanup, asserted ------------------------------------------------
    const leaks: string[] = [];
    const taskLeak = await restDelete(request, s, 'focusos_tasks', taskId);
    if (taskLeak) leaks.push(taskLeak);
    const projectLeak = await restDelete(request, s, 'focusos_projects', projectId);
    if (projectLeak) leaks.push(projectLeak);

    const strayProjects = await restSelect(request, s, `focusos_projects?select=id,name&name=like.*${stamp}*`);
    const strayTasks = await restSelect(request, s, `focusos_tasks?select=id,title&title=like.*${stamp}*`);
    const projectsAfter = await restCount(request, s, 'focusos_projects');
    const tasksAfter = await restCount(request, s, 'focusos_tasks');

    if (bodyError) throw bodyError;
    expect(leaks, 'every throwaway row must delete cleanly').toEqual([]);
    expect(strayProjects, 'no stamped project may survive').toEqual([]);
    expect(strayTasks, 'no stamped task may survive').toEqual([]);
    expect(projectsAfter, 'project count must return to where it started').toBe(projectsBefore);
    expect(tasksAfter, 'task count must return to where it started').toBe(tasksBefore);
  });
});

// ===========================================================================
// iPAD 820x1180 — the gap O6 exists to close. useIsMobile is FALSE here
// (>= 768px), so before O6 /home's Edit Task dialog took the stock modal path
// and its textareas kept the react-remove-scroll touchmove listener. The
// primitive's second rule, (pointer: coarse), is what catches this width.
// Chromium reports (pointer: coarse) true under Playwright's touch emulation
// (probed: hasTouch true + isMobile false -> pointer:coarse true, maxTouchPoints
// 1), so no matchMedia override is needed and the app's own rule is what runs.
// ===========================================================================
test.describe('iPad 820x1180: the Edit Task dialog is touch-safe even though useIsMobile is false', () => {
  test.use({ viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true, actionTimeout: 15000 });

  test('coarse pointer alone puts /home on the non-modal path', async ({ page, context, request }) => {
    test.setTimeout(180_000);
    const s = await restSignIn(request);
    const stamp = Date.now();
    const projectName = `O6 iPad ${stamp}`;
    const taskTitle = `O6 ipad ${stamp}`;

    const projectsBefore = await restCount(request, s, 'focusos_projects');
    const tasksBefore = await restCount(request, s, 'focusos_tasks');

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, description: DESCRIPTION,
      status: 'todo', priority: 'medium', due_date: todayNoonIso(),
    });

    const edgeHits: string[] = [];
    let bodyError: Error | null = null;
    try {
      await blockEdgeFunctions(context, edgeHits);
      await signIn(page);

      const media = await page.evaluate(() => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        mobileBreakpoint: matchMedia('(max-width: 767px)').matches,
      }));
      expect(media.coarse, 'this describe only means anything if the context really is a coarse pointer').toBe(true);
      expect(media.mobileBreakpoint, 'and useIsMobile must be FALSE at this width, or the test proves nothing').toBe(false);

      await page.goto(`${BASE}/home`);
      const row = page.locator('.lg-utap').filter({ hasText: taskTitle });
      await expect(row).toBeVisible({ timeout: 25000 });
      await row.scrollIntoViewIfNeeded();
      await row.click();

      const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#description') });
      await assertTouchSafe(page, dialog, 'iPad /home Edit Task');

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on the iPad');
      expect(edgeHits.filter((p) => /share-item|invite|summary|send/i.test(p)),
        'no mail-capable edge function may be reached').toEqual([]);
    } catch (e) {
      bodyError = e as Error;
    }

    const leaks: string[] = [];
    const taskLeak = await restDelete(request, s, 'focusos_tasks', taskId);
    if (taskLeak) leaks.push(taskLeak);
    const projectLeak = await restDelete(request, s, 'focusos_projects', projectId);
    if (projectLeak) leaks.push(projectLeak);

    const strayProjects = await restSelect(request, s, `focusos_projects?select=id,name&name=like.*${stamp}*`);
    const strayTasks = await restSelect(request, s, `focusos_tasks?select=id,title&title=like.*${stamp}*`);
    const projectsAfter = await restCount(request, s, 'focusos_projects');
    const tasksAfter = await restCount(request, s, 'focusos_tasks');

    if (bodyError) throw bodyError;
    expect(leaks, 'every throwaway row must delete cleanly').toEqual([]);
    expect(strayProjects, 'no stamped project may survive').toEqual([]);
    expect(strayTasks, 'no stamped task may survive').toEqual([]);
    expect(projectsAfter, 'project count must return to where it started').toBe(projectsBefore);
    expect(tasksAfter, 'task count must return to where it started').toBe(tasksBefore);
  });
});

// ===========================================================================
// DESKTOP 1280x900 (mouse) — nothing changed. (pointer: coarse) is false here,
// so the primitive renders the stock modal Dialog: Radix's own overlay, and
// DismissableLayer's body { pointer-events: none }.
// Note Add Task has NO desktop dialog at all — every desktop call site passes
// `desktopDocked`, which renders the SidePanel instead — so Create Project
// stands in as the second dialog here.
// ===========================================================================
test.describe('desktop 1280x900: converted dialogs are still stock modal', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

  test('a mouse pointer keeps Edit Task and Create Project on the modal path', async ({ page, context, request }) => {
    test.setTimeout(180_000);
    const s = await restSignIn(request);
    const stamp = Date.now();
    const projectName = `O6 Desk ${stamp}`;
    const taskTitle = `O6 desk ${stamp}`;

    const projectsBefore = await restCount(request, s, 'focusos_projects');
    const tasksBefore = await restCount(request, s, 'focusos_tasks');

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, description: DESCRIPTION,
      status: 'todo', priority: 'medium', due_date: todayNoonIso(),
    });

    const edgeHits: string[] = [];
    let bodyError: Error | null = null;
    try {
      await blockEdgeFunctions(context, edgeHits);
      await signIn(page);

      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
        'a mouse context must NOT report a coarse pointer, or every desktop dialog silently goes non-modal').toBe(false);

      await page.goto(`${BASE}/home`);
      const row = page.locator('.lg-utap').filter({ hasText: taskTitle });
      await expect(row).toBeVisible({ timeout: 25000 });
      await row.scrollIntoViewIfNeeded();
      await row.click();

      const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#description') });
      await expect(dialog).toBeVisible({ timeout: 10000 });
      expect(await dialog.getAttribute('data-sheet-mode'), 'desktop must not take the touch-safe path').toBeNull();
      const open = await bodyState(page);
      expect(open.radixOverlays, 'the modal path must render Radix\'s own overlay').toBe(1);
      expect(open.manualOverlays, 'the hand-rendered dim belongs to the touch path only').toBe(0);
      expect(open.inlinePointerEvents, 'DismissableLayer must still lock body pointer-events while modal').toBe('none');
      expect(open.sheetOpenClass, 'the CSS scroll lock must not appear on desktop').toBe(false);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on the desktop Edit Task dialog');

      await page.goto(`${BASE}/app?view=${projectId}`);
      await openProjectsDrawer(page);
      await page.getByRole('button', { name: 'New Project' }).click();
      const createProject = dialogWithText(page, 'Create New Project');
      await expect(createProject).toBeVisible({ timeout: 10000 });
      expect(await createProject.getAttribute('data-sheet-mode'), 'desktop Create Project must not take the touch-safe path').toBeNull();
      const open2 = await bodyState(page);
      expect(open2.radixOverlays, 'desktop Create Project must render Radix\'s own overlay').toBe(1);
      expect(open2.manualOverlays, 'no hand-rendered dim on desktop').toBe(0);
      expect(open2.inlinePointerEvents, 'desktop Create Project must still lock body pointer-events').toBe('none');
      await page.keyboard.press('Escape');
      await expect(createProject).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on desktop Create Project');
      expect(edgeHits.filter((p) => /share-item|invite|summary|send/i.test(p)),
        'no mail-capable edge function may be reached').toEqual([]);
    } catch (e) {
      bodyError = e as Error;
    }

    const leaks: string[] = [];
    const taskLeak = await restDelete(request, s, 'focusos_tasks', taskId);
    if (taskLeak) leaks.push(taskLeak);
    const projectLeak = await restDelete(request, s, 'focusos_projects', projectId);
    if (projectLeak) leaks.push(projectLeak);

    const strayProjects = await restSelect(request, s, `focusos_projects?select=id,name&name=like.*${stamp}*`);
    const strayTasks = await restSelect(request, s, `focusos_tasks?select=id,title&title=like.*${stamp}*`);
    const projectsAfter = await restCount(request, s, 'focusos_projects');
    const tasksAfter = await restCount(request, s, 'focusos_tasks');

    if (bodyError) throw bodyError;
    expect(leaks, 'every throwaway row must delete cleanly').toEqual([]);
    expect(strayProjects, 'no stamped project may survive').toEqual([]);
    expect(strayTasks, 'no stamped task may survive').toEqual([]);
    expect(projectsAfter, 'project count must return to where it started').toBe(projectsBefore);
    expect(tasksAfter, 'task count must return to where it started').toBe(tasksBefore);
  });
});
