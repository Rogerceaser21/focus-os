// EDIT TASK SHEET, NON-MODAL ON MOBILE (O4, 2026-08-23).
//
// Igor: on the phone, dragging the iOS selection handles to grow or shrink a
// selection in the Edit Task description barely worked. Sim-bisected on
// 2026-08-23 (iPhone16-P4-393, iOS 26.3 Safari, identical gesture and
// coordinates in every arm): with the stock Radix MODAL dialog the selection
// went [47,51] -> [47,51] (no growth); with modal={false} it went [47,51] ->
// [47,64] (the exact target); with modal={false} but react-remove-scroll added
// back it went [47,51] -> [47,51] again. The mechanism is react-remove-scroll's
// non-passive document 'touchmove' listener, which preventDefault()s the drag.
// body { pointer-events: none } was proven innocent (its own arm grew the
// selection fine).
//
// The fix: the MOBILE sheet only (src/components/EditTaskDialog.tsx,
// MobileSheet) runs the Dialog with modal={false}, hand-renders the house
// overlay (Radix's own <DialogOverlay> returns null when modal is false), and
// replaces the dropped scroll lock with pure CSS: body.lg-sheet-open
// { overflow: hidden } plus .lg-sheet-overlay { touch-action: none }. No JS
// touch listener anywhere. Desktop is untouched and still modal.
//
// End-to-end against the real demo account and the real Supabase backend, same
// shape as tests/share-status-live.spec.ts: REST sign-in, a timestamped
// throwaway project + task, try/finally cleanup with asserted deletes, a
// stamp-based leak sweep, and raw project/task counts before and after.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/edit-dialog-selection.spec.ts
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

// Plain words, one sentence per line, no punctuation: the same fixture shape
// the sim driver selects a word inside.
const DESCRIPTION = [
  'the quick brown fox jumps over lazy dogs',
  'every good boy deserves fruit and more cake',
  'pack my box with five dozen liquor jugs',
  'how vexingly quick daft zebras jump about',
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

// return=representation echoes the deleted row, so an id that was already gone
// (or that RLS refused) is reported as a leak instead of passing silently.
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

/** Body state, read straight off the document. `pointerEvents` is the INLINE
 *  style, which is exactly what Radix's DismissableLayer writes when a modal
 *  layer is up, so an empty string here proves nothing is stranded. */
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

/** Dispatch a real, cancelable touchmove inside the description textarea and
 *  report whether anything preventDefault()ed it. This is the exact shape
 *  react-remove-scroll's non-passive document listener acts on, and therefore
 *  the closest a Chromium run can get to Igor's handle drag. */
const touchMoveBlocked = (page: Page, dx: number, dy: number) =>
  page.evaluate(([ddx, ddy]) => {
    const el = document.querySelector('#description') as HTMLTextAreaElement | null;
    if (!el) throw new Error('no #description in the open sheet');
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const mk = (cx: number, cy: number) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [mk(x, y)], targetTouches: [mk(x, y)], changedTouches: [mk(x, y)],
    }));
    const t = mk(x + ddx, y + ddy);
    const move = new TouchEvent('touchmove', {
      bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t],
    });
    el.dispatchEvent(move);
    return move.defaultPrevented;
  }, [dx, dy]);

// ===========================================================================
// MOBILE: the sheet is non-modal, nothing blocks a touchmove, and it still
// saves, still closes on Escape, and still closes on a tap outside.
// ===========================================================================
test.describe('mobile 390x844: the Edit Task sheet is non-modal', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('non-modal, no touchmove block, still types, saves, and closes both ways', async ({ page, request }) => {
    test.setTimeout(180_000);
    const s = await restSignIn(request);
    const stamp = Date.now();
    const projectName = `O4 Sel ${stamp}`;
    const taskTitle = `O4 sel ${stamp}`;
    const savedTitle = `${taskTitle} saved`;
    const savedDescription = `${DESCRIPTION}\nedited on ${stamp}`;

    const projectsBefore = await restCount(request, s, 'focusos_projects');
    const tasksBefore = await restCount(request, s, 'focusos_tasks');

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, description: DESCRIPTION,
      status: 'todo', priority: 'medium', due_date: todayNoonIso(),
    });

    let bodyError: Error | null = null;
    try {
      await signIn(page);
      await page.goto(`${BASE}/app?view=${projectId}`);

      const sheet = page.locator('.lg-editsheet');
      const openSheet = async () => {
        await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible({ timeout: 25000 });
        await page.getByText(taskTitle, { exact: true }).first().click();
        await expect(sheet).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#description')).toBeVisible({ timeout: 10000 });
      };

      // ---- (1) mode + overlay + the mechanism ------------------------------
      await openSheet();
      await expect(sheet, 'the mobile sheet must publish its non-modal mode').toHaveAttribute('data-sheet-mode', 'nonmodal');

      const open1 = await bodyState(page);
      expect(open1.inlinePointerEvents, 'a non-modal sheet must never lock body pointer-events').not.toBe('none');
      expect(open1.computedPointerEvents, 'the page behind must still take pointer events').not.toBe('none');
      expect(open1.sheetOpenClass, 'the CSS scroll lock must be on <body> while the sheet is open').toBe(true);
      expect(open1.radixOverlays, 'Radix must render no overlay of its own when modal is false').toBe(0);
      expect(open1.manualOverlays, 'the house dim must be hand-rendered exactly once').toBe(1);

      const overlayTouchAction = await page
        .locator('[data-sheet-overlay]')
        .evaluate((el) => getComputedStyle(el).touchAction);
      expect(overlayTouchAction, 'the dim must swallow pans with CSS, not a listener').toBe('none');

      // The whole point of the fix.
      expect(await touchMoveBlocked(page, 40, 0), 'a horizontal touchmove in the description must NOT be preventDefaulted').toBe(false);
      expect(await touchMoveBlocked(page, 0, 40), 'a vertical touchmove in the description must NOT be preventDefaulted').toBe(false);

      // ---- (1b) nested layers opened FROM the sheet must not dismiss it ------
      // Radix's non-modal branch dismisses on any focusin outside the layer,
      // with no layer guard at all, and on any pointer down outside that is not
      // inside a pointer-events-disabling layer. Both would kill the sheet the
      // moment a nested portal opened. This is the guard in MobileSheet's
      // onInteractOutside; without it tests/share-status-live.spec.ts fails
      // with the Share dialog detaching mid-click.
      await page.locator('[data-task-tour-step="start-date"] button').click();
      const calendar = page.locator('[role="dialog"]').filter({ has: page.locator('table') });
      await expect(calendar, 'the date popover must open').toBeVisible({ timeout: 8000 });
      await expect(sheet, 'opening the date popover must not dismiss the sheet').toBeVisible();
      await calendar.locator('button:not([disabled])').first().click();
      await expect(sheet, 'picking a date must not dismiss the sheet').toBeVisible();
      await page.waitForTimeout(300);

      await page.getByRole('button', { name: 'Share', exact: true }).click();
      const shareDialog = page.locator('[role="dialog"]').filter({ hasText: 'Add Recipients' });
      await expect(shareDialog, 'the Share dialog must open from the sheet').toBeVisible({ timeout: 8000 });
      await shareDialog.getByLabel('Add Recipients').click();
      await expect(sheet, 'focusing a nested dialog must not dismiss the sheet').toBeVisible();
      await page.keyboard.press('Escape');
      await expect(shareDialog).toBeHidden({ timeout: 8000 });
      await expect(sheet, 'closing the nested dialog must leave the sheet open').toBeVisible();

      // ---- (2) Escape still closes, and leaves nothing behind ---------------
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600); // the lg-sheet-out exit animation
      await expectBodyClean(page, 'after Escape');

      // ---- (3) a tap on the dim still closes it -----------------------------
      await openSheet();
      const overlay = page.locator('[data-sheet-overlay]');
      await expect(overlay).toHaveCount(1);
      const sheetBox = await sheet.boundingBox();
      expect(sheetBox, 'the sheet must have a box to tap above').not.toBeNull();
      // The sheet is full width on a phone, so the only uncovered strip of the
      // dim is above it (max-h-[90vh] centred leaves ~5vh clear top and bottom).
      const tapY = Math.max(4, Math.round((sheetBox as { y: number }).y / 2));
      // Prove the tap point is actually ON the dim before firing it, so a pass
      // can never come from the tap landing somewhere else entirely.
      const hit = await page.evaluate((y) => {
        const el = document.elementFromPoint(195, y);
        return el ? { tag: el.tagName, isOverlay: el.hasAttribute('data-sheet-overlay') } : null;
      }, tapY);
      expect(hit, 'something must be hit-testable at the tap point').not.toBeNull();
      expect(hit?.isOverlay, `the point 195,${tapY} must be the dim itself`).toBe(true);
      await page.touchscreen.tap(195, tapY);
      await expect(sheet, 'a tap on the dim must dismiss the sheet, as it did when modal').toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after a tap on the dim');

      // ---- (4) both textareas still accept typing, and Save still persists ---
      await openSheet();
      const title = page.locator('#title');
      const description = page.locator('#description');
      await title.fill(savedTitle);
      await expect(title).toHaveValue(savedTitle);
      await description.fill(savedDescription);
      await expect(description).toHaveValue(savedDescription);

      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(sheet).toBeHidden({ timeout: 15000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Save Changes');

      await expect
        .poll(async () => {
          const rows = await restSelect(request, s, `focusos_tasks?select=title,description&id=eq.${taskId}`);
          return rows[0] ? `${rows[0].title}||${rows[0].description}` : null;
        }, { timeout: 20000, message: 'Save Changes must persist both fields to the backend' })
        .toBe(`${savedTitle}||${savedDescription}`);
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
// DESKTOP: unchanged. /home renders EditTaskDialog with no `desktopDocked`
// (src/pages/Home.tsx ~1327), so on a wide viewport it is the stock MODAL
// Radix dialog: Radix renders its own overlay and DismissableLayer writes
// body { pointer-events: none }. This Radix version sets no aria-modal and no
// data-radix-* attribute (checked in node_modules/@radix-ui/react-dialog), so
// those two are what "modal" actually exposes here.
// ===========================================================================
test.describe('desktop 1280x900: the Edit Task dialog is still modal', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

  test('stock modal dialog, untouched by the mobile fix', async ({ page, request }) => {
    test.setTimeout(180_000);
    const s = await restSignIn(request);
    const stamp = Date.now();
    const projectName = `O4 Desk ${stamp}`;
    const taskTitle = `O4 desk ${stamp}`;

    const projectsBefore = await restCount(request, s, 'focusos_projects');
    const tasksBefore = await restCount(request, s, 'focusos_tasks');

    const projectId = await restInsert(request, s, 'focusos_projects', {
      name: projectName, color: '#8b5cf6', user_id: s.userId,
    });
    const taskId = await restInsert(request, s, 'focusos_tasks', {
      user_id: s.userId, project_id: projectId, title: taskTitle, description: DESCRIPTION,
      status: 'todo', priority: 'medium', due_date: todayNoonIso(),
    });

    let bodyError: Error | null = null;
    try {
      await signIn(page);
      // /app on desktop is the DOCKED SidePanel, not a dialog at all
      // (tests/paneflow.spec.ts). /home is the surface that still renders the
      // plain dialog on every width.
      await page.goto(`${BASE}/home`);
      const row = page.locator('.lg-utap').filter({ hasText: taskTitle });
      await expect(row).toBeVisible({ timeout: 25000 });
      await row.scrollIntoViewIfNeeded();
      await row.click();

      const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#description') });
      await expect(dialog).toBeVisible({ timeout: 10000 });

      expect(await dialog.getAttribute('data-sheet-mode'), 'desktop must not take the mobile non-modal path').toBeNull();

      const open = await bodyState(page);
      expect(open.radixOverlays, 'the modal path must render Radix\'s own overlay').toBe(1);
      expect(open.manualOverlays, 'the hand-rendered dim belongs to mobile only').toBe(0);
      expect(open.inlinePointerEvents, 'DismissableLayer must still lock body pointer-events while modal').toBe('none');
      expect(open.sheetOpenClass, 'the mobile CSS scroll lock must not appear on desktop').toBe(false);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 8000 });
      await page.waitForTimeout(600);
      await expectBodyClean(page, 'after Escape on desktop');
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
