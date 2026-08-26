// SHARED ITEMS LIVE REFRESH (O7, 2026-08-26): real demo sign-in and read-only
// task/project lookups against the real Supabase backend; the only faked
// network paths are the focusos-share-item edge function and the
// focusos_shared_items REST path (GET + PATCH), on this test's own browser
// context. Modelled on tests/share-status-live.spec.ts (same demo account,
// same interception shape) but hermetic on the data side too: the demo
// account is in concurrent use by a sibling agent right now, so this spec
// creates and deletes NOTHING (no REST insert, no REST delete, no global
// project/task count assertions). It reads one already-open task/project pair
// read-only and never mutates it.
//
// Two defects, four journeys (two on /app, the same two on /home):
//  (a) sharing a task from the Edit Task sheet used to leave the drawer's own
//      Shared Items section stale until a full reload (the purple pill was
//      already instant; this only covers the drawer);
//  (b) pressing Cancel on a shared item in the drawer used to leave the
//      purple pill on the task until reload (the drawer's own row already
//      refreshed correctly; this only covers the pill).
//
// The fix threads a `sharedItemsRefreshTrigger` counter (drawer's own Shared
// Items refetch) and an `onSenderSharedItemsChanged` callback (host page's
// pill refetch) through ProjectSidebar / ProjectsDrawerHost / Index / Home.
// Neither this spec nor the fix depends on the belt-and-braces realtime block
// firing; every assertion below is driven by the deterministic prop wiring.
//
// Run (against a running dev server; the repo config skips its own webServer
// when WAVE_BASE_URL points elsewhere is NOT a given - drop the webServer block
//   WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/shared-items-live.spec.ts
import { test, expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account the other project specs sign in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

// ---- UI sign-in ---------------------------------------------------------

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// ---- REST sign-in + read-only lookups (no insert, no delete) -----------

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

const restHeaders = (s: Session) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${s.token}`,
  'Content-Type': 'application/json',
});

const restSelect = async (request: APIRequestContext, s: Session, path: string): Promise<any[]> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(s) });
  expect(res.ok(), `select ${path} must succeed (${res.status()})`).toBeTruthy();
  return res.json();
};

interface ExistingTask { taskId: string; taskTitle: string; projectId: string; projectName: string; }

// Read-only: picks the account's own oldest still-open task that has a
// project, and that project's name. Never inserts or deletes anything, so it
// is safe to call while a sibling agent is also using this account.
const pickExistingOpenTask = async (request: APIRequestContext, s: Session): Promise<ExistingTask> => {
  const tasks = await restSelect(
    request, s,
    `focusos_tasks?select=id,title,project_id,status&user_id=eq.${s.userId}&status=neq.completed&project_id=not.is.null&order=created_at.asc&limit=10`,
  );
  expect(tasks.length, 'the demo account must have at least one open task with a project for this spec to use').toBeGreaterThan(0);
  const task = tasks[0];
  const projects = await restSelect(
    request, s,
    `focusos_projects?select=id,name&id=eq.${task.project_id}&limit=1`,
  );
  expect(projects.length, `the task's own project (${task.project_id}) must still resolve`).toBe(1);
  return { taskId: task.id, taskTitle: task.title, projectId: task.project_id, projectName: projects[0].name };
};

// ---- The two intercepted network paths (focusos-share-item + focusos_shared_items) ---
//
// focusos-share-item: fulfilled with the same {success:true} shape the real
// function returns on its happy path: ShareItemDialog.handleSend only checks
// that `error` is falsy, so this marks the send a success without ever
// reaching Resend or writing a real row. Each successful fake share appends
// one row to the accumulator below.
//
// focusos_shared_items: EVERY GET is answered from the accumulator regardless
// of the real query's filters (matches tests/share-status-live.spec.ts's own
// reasoning) and it always contains only pending/accepted rows, which mirrors
// loadSharedItems' own `.in('status', ['pending','accepted'])` real-backend
// filter. A PATCH (handleCancelSharedItem's direct `.update({status:
// 'cancelled'})`) removes the matching row from the accumulator instead of
// leaving a 'cancelled' row behind, for the same reason: the real backend
// would no longer return it either.
interface FakeSharedRow {
  id: string;
  item_id: string;
  item_type: 'task' | 'project';
  item_title: string;
  project_name: string | null;
  recipient_email: string;
  recipient_user_id: string | null;
  recipient_task_id: string | null;
  sender_email: string | null;
  sender_user_id: string;
  sender_name: string | null;
  status: 'pending' | 'accepted';
  sender_acknowledged: boolean;
  completion_acknowledged: boolean;
  completed_at: string | null;
  change_request_message: string | null;
  created_at: string;
}

interface ShareIntercept {
  rows: FakeSharedRow[];
  /** Number of times the focusos_shared_items GET route has fired. */
  getHits: number;
  /** Number of times the focusos_shared_items PATCH route has fired. */
  patchHits: number;
}

const installSharedItemsIntercepts = async (
  context: BrowserContext,
  s: Session,
  seed: FakeSharedRow[] = [],
): Promise<ShareIntercept> => {
  const state: ShareIntercept = { rows: [...seed], getHits: 0, patchHits: 0 };
  let fakeIdCounter = 0;

  await context.route('**/functions/v1/focusos-share-item', async (route) => {
    const body = route.request().postDataJSON() as
      | { itemType?: 'task' | 'project'; itemId?: string; recipientEmail?: string }
      | null;
    if (body && body.itemType && body.itemId && body.recipientEmail) {
      fakeIdCounter += 1;
      state.rows.push({
        id: `o7-fake-shared-row-${fakeIdCounter}`,
        item_id: body.itemId,
        item_type: body.itemType,
        item_title: body.itemType === 'task' ? 'Shared Task' : 'Shared Project',
        project_name: null,
        recipient_email: body.recipientEmail,
        recipient_user_id: null,
        recipient_task_id: null,
        sender_email: null,
        sender_user_id: s.userId,
        sender_name: null,
        status: 'pending',
        sender_acknowledged: false,
        completion_acknowledged: false,
        completed_at: null,
        change_request_message: null,
        created_at: new Date().toISOString(),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await context.route('**/rest/v1/focusos_shared_items*', async (route) => {
    const req = route.request();
    const method = req.method();

    if (method === 'GET') {
      state.getHits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.rows),
      });
      return;
    }

    if (method === 'PATCH') {
      state.patchHits += 1;
      // handleCancelSharedItem sends `.eq('id', sharedItemId)`, which
      // PostgREST renders as the query param `id=eq.<id>`.
      const url = new URL(req.url());
      const idParam = url.searchParams.get('id');
      const targetId = idParam?.startsWith('eq.') ? idParam.slice(3) : null;
      if (targetId) {
        state.rows = state.rows.filter((r) => r.id !== targetId);
      }
      // No .select() on the real call, so a bare 204 (no body) matches what
      // PostgREST itself returns without `Prefer: return=representation`.
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    await route.continue();
  });

  return state;
};

// ---- Drawer + pill locators ----------------------------------------------

// The mobile drawer is a plain, permanently-mounted portal at document.body
// (white-flash law in src/components/ProjectSidebar.tsx); open/close is CSS
// transform only. On desktop /app the same content renders inline instead
// (isMobile false there) and this node never appears. On /home the drawer is
// ALWAYS the portal branch, at every viewport (ProjectsDrawerHost always
// passes overlayMode, which aliases ProjectSidebar's isMobile to true).
const drawer = (page: Page) => page.locator('div[role="dialog"][aria-label="Projects"]');

const openDrawer = async (page: Page) => {
  const appeared = await drawer(page)
    .first()
    .waitFor({ state: 'attached', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return; // desktop /app: sidebar is already inline, nothing to open
  const state = await drawer(page).getAttribute('data-state').catch(() => null);
  if (state === 'open') return;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer(page)).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

// Symmetric close: same toggle button (BottomNav's Projects tab), only
// clicked when the drawer is actually attached and open. Needed before
// reopening a task's sheet from behind the drawer, since the open overlay
// sits on top of the task list and would otherwise swallow the tap.
const closeDrawer = async (page: Page) => {
  const appeared = await drawer(page)
    .first()
    .waitFor({ state: 'attached', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  const state = await drawer(page).getAttribute('data-state').catch(() => null);
  if (state !== 'open') return;
  // The panel (w-[280px], fixed inset-y-0 left-0, z-50) visually covers
  // BottomNav's own Projects button while open, so re-clicking that button
  // hits the drawer's own scrollable content instead. ProjectSidebar's
  // mobile-only Escape listener (isMobile && openMobile) is the one already-
  // proven way to close it (its "Close sidebar" X button is desktop-only,
  // gated `{!isMobile && (...)}`, so it does not exist in this branch).
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveAttribute('data-state', 'closed', { timeout: 5000 });
};

// ProjectSidebar's Shared Items section (src/components/ProjectSidebar.tsx,
// the block starting "Shared Items Section") renders this h3 ONLY when the
// queue is non-empty; it returns null otherwise, so this locator's absence
// vs presence is a plain conditional-render check, not a CSS-visibility one.
const sharedItemsHeading = (page: Page) => page.locator('h3').filter({ hasText: 'Shared Items' });

// The drawer's own card shows the recipient as plain text ("To: <email>"),
// not through ShareStatusPopover: resolveDisplayName falls back to the raw
// email whenever recipient_user_id is null (our fake rows always have it
// null), so the fake, timestamped email is a safe, unique match. Matches the
// "To: " paragraph directly rather than trying to wrap the whole card div:
// the recipient <p> and the Cancel button are SIBLING subtrees under the
// card's outer div, not one inside the other, so a div-text-filter trick
// aimed at "the smallest div containing this text" resolves to the deepest
// div along the title/recipient branch only, never reaching the actions row.
const sharedItemsCard = (page: Page, needle: string) => page.getByText(`To: ${needle}`, { exact: false });

// The section renders exactly one queued card at a time (ProjectSidebar.tsx:
// visibleItems.slice to one), so its Cancel button (aria-label="Cancel", only
// present for the sender's own pending item) is unambiguous on the page
// without needing to scope it to a specific card.
const cancelSharedItemButton = (page: Page) => page.getByRole('button', { name: 'Cancel' });

// ShareStatusPopover always renders its status text in this exact leaf span
// (src/components/ShareStatusPopover.tsx: <span className="break-words">),
// the purple pill, wherever it lives (task row, project bar, mobile Edit Task
// sheet header).
const sharedBadge = (page: Page, needle: string) =>
  page.locator('span.break-words:visible').filter({ hasText: needle });

// ---- /app task card + Edit Task pane/sheet --------------------------------

const taskCard = (page: Page, title: string) =>
  page.locator('[data-task-card]:visible').filter({ hasText: title });

const openAppTaskDesktop = async (page: Page, title: string) => {
  const card = taskCard(page, title);
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.hover();
  await card.locator('[title="Edit task"]:visible').first().click();
  const pane = page.locator('[data-side-panel]');
  await expect(pane).toBeVisible({ timeout: 10000 });
  return pane;
};

const openAppTaskMobile = async (page: Page, title: string) => {
  const card = taskCard(page, title);
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.getByText(title, { exact: true }).first().tap();
  const sheet = page.locator('.lg-editsheet');
  await expect(sheet).toBeVisible({ timeout: 10000 });
  return sheet;
};

const shareFromDialog = async (page: Page, container: ReturnType<Page['locator']>, email: string) => {
  await container.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share Task' });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await dialog.getByLabel('Add Recipients').fill(email);
  await dialog.getByLabel('Add Recipients').press('Enter');
  await dialog.getByRole('button', { name: /Share with/ }).click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
};

// ---- /home Today's Focus row + Edit Task sheet -----------------------------

const homeTaskRow = (page: Page, title: string) =>
  page.locator('.lg-utask').filter({ hasText: title });

const openHomeTask = async (page: Page, title: string) => {
  const row = homeTaskRow(page, title);
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.locator('.lg-utap').getByText(title, { exact: true }).click();
  const sheet = page.locator('.lg-editsheet');
  await expect(sheet).toBeVisible({ timeout: 10000 });
  return sheet;
};

// ---- Test A: /app desktop, direction (a): share updates the drawer live ---

test.describe('app desktop: sharing a task updates the drawer Shared Items section live', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

  test('drawer goes from no Shared Items section to one, without a reload', async ({ page, request, context }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const existing = await pickExistingOpenTask(request, s);
    const fakeEmail = `o7-fake-${Date.now()}@example.invalid`;

    const share = await installSharedItemsIntercepts(context, s);

    await signIn(page);
    await page.goto(`${BASE}/app?view=${existing.projectId}`);

    // Before: the fake accumulator starts empty, so the section must not exist yet.
    await expect(sharedItemsHeading(page)).toHaveCount(0);

    const pane = await openAppTaskDesktop(page, existing.taskTitle);
    const hitsBefore = share.getHits;
    await shareFromDialog(page, pane, fakeEmail);
    expect(share.getHits, 'the focusos_shared_items GET must have re-fired after the share').toBeGreaterThan(hitsBefore);

    // Close the docked pane so it cannot itself satisfy the drawer locator.
    await page.locator('[data-side-panel] > div:first-child > button').click();
    await expect(pane).toBeHidden({ timeout: 5000 });

    // After, live, no reload: the section appears with this share's card.
    await expect(sharedItemsHeading(page)).toBeVisible({ timeout: 5000 });
    await expect(sharedItemsCard(page, fakeEmail)).toBeVisible({ timeout: 5000 });
  });
});

// ---- Test B: /app desktop, direction (b): Cancel updates the pill live ----

test.describe('app desktop: cancelling a shared item removes the pill live', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

  test('drawer row disappears and the task pill disappears, without a reload', async ({ page, request, context }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const existing = await pickExistingOpenTask(request, s);
    const fakeEmail = `o7-fake-${Date.now()}@example.invalid`;

    const seedRow: FakeSharedRow = {
      id: 'o7-fake-preseed-1',
      item_id: existing.taskId,
      item_type: 'task',
      item_title: existing.taskTitle,
      project_name: existing.projectName,
      recipient_email: fakeEmail,
      recipient_user_id: null,
      recipient_task_id: null,
      sender_email: null,
      sender_user_id: s.userId,
      sender_name: null,
      status: 'pending',
      sender_acknowledged: false,
      completion_acknowledged: false,
      completed_at: null,
      change_request_message: null,
      created_at: new Date().toISOString(),
    };
    const share = await installSharedItemsIntercepts(context, s, [seedRow]);

    await signIn(page);
    await page.goto(`${BASE}/app?view=${existing.projectId}`);

    // Pre-seeded: the pill and the drawer card are both already there.
    await expect(sharedBadge(page, fakeEmail)).toBeVisible({ timeout: 10000 });
    await expect(sharedItemsHeading(page)).toBeVisible({ timeout: 5000 });
    await expect(sharedItemsCard(page, fakeEmail)).toBeVisible();
    const cancelBtn = cancelSharedItemButton(page);
    await expect(cancelBtn).toBeVisible();

    const hitsBefore = share.getHits;
    await cancelBtn.click();
    expect(share.patchHits, 'the cancel action must PATCH focusos_shared_items').toBeGreaterThan(0);
    // fetchSharedItems({fresh:true}) inside handleCancelSharedItem is
    // fire-and-forget (not awaited), so poll rather than assert synchronously
    // right after the click.
    await expect.poll(() => share.getHits, {
      message: 'the drawer must refetch focusos_shared_items after cancelling',
      timeout: 5000,
    }).toBeGreaterThan(hitsBefore);

    // The drawer's own row is gone (already worked pre-fix)...
    await expect(sharedItemsHeading(page)).toHaveCount(0, { timeout: 5000 });
    // ...AND, live, no reload: the pill on the task is gone too (the O7 fix).
    await expect(sharedBadge(page, fakeEmail)).toHaveCount(0, { timeout: 5000 });
  });
});

// ---- Test C: /app mobile (393x852): both journeys, one pass -------------

test.describe('app mobile (393x852): sharing a task updates the drawer live', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('drawer goes from no Shared Items section to one, without a reload', async ({ page, request, context }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const existing = await pickExistingOpenTask(request, s);
    const fakeEmail = `o7-fake-${Date.now()}@example.invalid`;

    const share = await installSharedItemsIntercepts(context, s);

    await signIn(page);
    await page.goto(`${BASE}/app?view=${existing.projectId}`);

    const sheet = await openAppTaskMobile(page, existing.taskTitle);
    const hitsBefore = share.getHits;
    await shareFromDialog(page, sheet, fakeEmail);
    expect(share.getHits, 'the focusos_shared_items GET must have re-fired after the share').toBeGreaterThan(hitsBefore);

    // Close the sheet (stock Radix Dialog Escape-to-close, no override in
    // touch-dialog.tsx or EditTaskDialog.tsx), then open the drawer (portal
    // branch on mobile).
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden({ timeout: 5000 });

    await openDrawer(page);
    await expect(sharedItemsHeading(page)).toBeVisible({ timeout: 5000 });
    await expect(sharedItemsCard(page, fakeEmail)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('app mobile (393x852): cancelling a shared item removes the pill live', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('drawer row disappears and the sheet chip disappears, without a reload', async ({ page, request, context }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const existing = await pickExistingOpenTask(request, s);
    const fakeEmail = `o7-fake-${Date.now()}@example.invalid`;

    const seedRow: FakeSharedRow = {
      id: 'o7-fake-preseed-2',
      item_id: existing.taskId,
      item_type: 'task',
      item_title: existing.taskTitle,
      project_name: existing.projectName,
      recipient_email: fakeEmail,
      recipient_user_id: null,
      recipient_task_id: null,
      sender_email: null,
      sender_user_id: s.userId,
      sender_name: null,
      status: 'pending',
      sender_acknowledged: false,
      completion_acknowledged: false,
      completed_at: null,
      change_request_message: null,
      created_at: new Date().toISOString(),
    };
    const share = await installSharedItemsIntercepts(context, s, [seedRow]);

    await signIn(page);
    await page.goto(`${BASE}/app?view=${existing.projectId}`);

    await openDrawer(page);
    await expect(sharedItemsHeading(page)).toBeVisible({ timeout: 10000 });
    await expect(sharedItemsCard(page, fakeEmail)).toBeVisible();
    const cancelBtn = cancelSharedItemButton(page);
    await expect(cancelBtn).toBeVisible();

    const hitsBefore = share.getHits;
    await cancelBtn.click();
    expect(share.patchHits, 'the cancel action must PATCH focusos_shared_items').toBeGreaterThan(0);
    // fetchSharedItems({fresh:true}) inside handleCancelSharedItem is
    // fire-and-forget (not awaited), so poll rather than assert synchronously
    // right after the click.
    await expect.poll(() => share.getHits, {
      message: 'the drawer must refetch focusos_shared_items after cancelling',
      timeout: 5000,
    }).toBeGreaterThan(hitsBefore);
    await expect(sharedItemsHeading(page)).toHaveCount(0, { timeout: 5000 });

    // Reopen the same task's sheet: the chip must be gone, live, no reload.
    await closeDrawer(page);
    const sheet = await openAppTaskMobile(page, existing.taskTitle);
    await expect(sheet.locator('span.break-words:visible').filter({ hasText: fakeEmail })).toHaveCount(0, { timeout: 5000 });
  });
});

// ---- Test D + E: /home: the same two journeys via ProjectsDrawerHost ------
//
// Mobile viewport is not optional here: EditTaskDialog's own share chip only
// renders `isMobile && chipRecipients...` (useIsMobile, a real viewport
// hook, distinct from ProjectSidebar's overlay-mode isMobile alias), so on
// Home at a desktop width there is nowhere on screen the pill would ever
// show, since Home's Today's Focus rows do not render a ShareStatusPopover
// themselves (only the sheet header does). 393x852 matches the /app mobile
// pass above.

test.describe('home mobile (393x852): sharing a task updates the drawer live', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('drawer goes from no Shared Items section to one, without a reload', async ({ page, request, context }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const existing = await pickExistingOpenTask(request, s);
    const fakeEmail = `o7-fake-${Date.now()}@example.invalid`;

    const share = await installSharedItemsIntercepts(context, s);

    await signIn(page);
    await page.goto(`${BASE}/home`);

    const sheet = await openHomeTask(page, existing.taskTitle);
    const hitsBefore = share.getHits;
    await shareFromDialog(page, sheet, fakeEmail);
    expect(share.getHits, 'the focusos_shared_items GET must have re-fired after the share').toBeGreaterThan(hitsBefore);
    // The sheet's own chip, live, no close/reopen (already O2/O3-proven; a
    // quick confirmation the pre-seed/share plumbing on this page is sound).
    await expect(sheet.locator('span.break-words:visible').filter({ hasText: fakeEmail })).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden({ timeout: 5000 });

    await openDrawer(page);
    await expect(sharedItemsHeading(page)).toBeVisible({ timeout: 5000 });
    await expect(sharedItemsCard(page, fakeEmail)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('home mobile (393x852): cancelling a shared item removes the pill live', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('drawer row disappears and the sheet chip disappears, without a reload', async ({ page, request, context }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const existing = await pickExistingOpenTask(request, s);
    const fakeEmail = `o7-fake-${Date.now()}@example.invalid`;

    const seedRow: FakeSharedRow = {
      id: 'o7-fake-preseed-3',
      item_id: existing.taskId,
      item_type: 'task',
      item_title: existing.taskTitle,
      project_name: existing.projectName,
      recipient_email: fakeEmail,
      recipient_user_id: null,
      recipient_task_id: null,
      sender_email: null,
      sender_user_id: s.userId,
      sender_name: null,
      status: 'pending',
      sender_acknowledged: false,
      completion_acknowledged: false,
      completed_at: null,
      change_request_message: null,
      created_at: new Date().toISOString(),
    };
    const share = await installSharedItemsIntercepts(context, s, [seedRow]);

    await signIn(page);
    await page.goto(`${BASE}/home`);

    // Pre-seeded: the sheet's chip is already there on first open.
    const sheet1 = await openHomeTask(page, existing.taskTitle);
    await expect(sheet1.locator('span.break-words:visible').filter({ hasText: fakeEmail })).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(sheet1).toBeHidden({ timeout: 5000 });

    await openDrawer(page);
    await expect(sharedItemsHeading(page)).toBeVisible({ timeout: 10000 });
    await expect(sharedItemsCard(page, fakeEmail)).toBeVisible();
    const cancelBtn = cancelSharedItemButton(page);
    await expect(cancelBtn).toBeVisible();

    const hitsBefore = share.getHits;
    await cancelBtn.click();
    expect(share.patchHits, 'the cancel action must PATCH focusos_shared_items').toBeGreaterThan(0);
    // fetchSharedItems({fresh:true}) inside handleCancelSharedItem is
    // fire-and-forget (not awaited), so poll rather than assert synchronously
    // right after the click.
    await expect.poll(() => share.getHits, {
      message: 'the drawer must refetch focusos_shared_items after cancelling',
      timeout: 5000,
    }).toBeGreaterThan(hitsBefore);
    await expect(sharedItemsHeading(page)).toHaveCount(0, { timeout: 5000 });

    // Close the drawer, reopen the same task's sheet: the chip must be gone,
    // live, no reload (the O7 fix under test).
    await closeDrawer(page);
    const sheet2 = await openHomeTask(page, existing.taskTitle);
    await expect(sheet2.locator('span.break-words:visible').filter({ hasText: fakeEmail })).toHaveCount(0, { timeout: 5000 });
  });
});

// ---- Test F: the warm-cache SPA journey (skeptic refutation, 2026-08-26) ----
//
// The first cut of the O7 fix used a skip-first-run guard, and the Fable
// skeptic refuted it live on exactly this journey: visit /app first (the
// non-overlay sidebar is armed from mount and warms appDataKeys.sharedItems),
// SPA-navigate to /home (no reload, so the warm cache and all module state
// survive), share while the /home drawer is still closed (unarmed), then open
// the drawer. The unarmed trigger bump was swallowed by the guard and the
// arming mount fetch served the 5-minute stale cache, so the session's FIRST
// share never appeared without a reload - Igor's literal repro. The fix
// replaces the boolean with a last-handled-trigger ref: arming onto a trigger
// value this instance has never handled (and that is not the pristine 0)
// fetches fresh. The four journeys above keep passing either way (their /home
// tests land with a COLD cache, which is why they missed this); this test
// pins the warm-cache path.

test.describe('home mobile (393x852): warm cache from /app, first share still reaches the drawer', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000 });

  test('share with the drawer closed after an /app visit, then open it: the row is there, fresh-fetched, no reload', async ({ page, request, context }) => {
    test.setTimeout(120_000);
    const s = await restSignIn(request);
    const existing = await pickExistingOpenTask(request, s);
    const fakeEmail = `o7-fake-${Date.now()}@example.invalid`;

    const share = await installSharedItemsIntercepts(context, s);

    await signIn(page);

    // Full load on /app: the always-armed non-overlay sidebar warms the
    // sharedItems cache (wait for its GET), and a 5s dwell lets /app's own
    // RSVP sync fire, closing syncRsvpThenRefresh's 60-second window so that
    // side path cannot mask a stale drawer later (the skeptic proved the
    // defect only reproduces once that rescue path is spent).
    await page.goto(`${BASE}/app?view=${existing.projectId}`);
    await expect.poll(() => share.getHits, {
      message: 'the /app visit must warm the sharedItems cache',
      timeout: 15000,
    }).toBeGreaterThan(0);
    await page.waitForTimeout(5000);

    // SPA-navigate to /home: double-tap the record FAB (its documented
    // double-tap gesture navigates /home through the router). The marker
    // proves no full reload happened anywhere in the rest of the test.
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__o7SpaMarker = true; });
    const fab = page.locator('.lg-fab-main');
    await fab.click();
    await fab.click();
    await page.waitForURL('**/home', { timeout: 10000 });

    // Share while the /home drawer is closed and unarmed.
    const sheet = await openHomeTask(page, existing.taskTitle);
    await shareFromDialog(page, sheet, fakeEmail);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden({ timeout: 5000 });

    // Open the drawer: arming must fetch FRESH (a never-handled trigger),
    // not serve the warm cache from the /app visit.
    const hitsAtOpen = share.getHits;
    await openDrawer(page);
    await expect.poll(() => share.getHits, {
      message: 'arming the drawer onto a missed share bump must fetch focusos_shared_items fresh',
      timeout: 5000,
    }).toBeGreaterThan(hitsAtOpen);
    await expect(sharedItemsHeading(page)).toBeVisible({ timeout: 5000 });
    await expect(sharedItemsCard(page, fakeEmail)).toBeVisible({ timeout: 5000 });

    const spaMarker = await page.evaluate(() => (window as unknown as Record<string, unknown>).__o7SpaMarker);
    expect(spaMarker, 'the journey must be reload-free end to end').toBe(true);
  });
});
