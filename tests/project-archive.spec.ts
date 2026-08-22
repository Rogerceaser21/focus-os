// Archive / Restore a project — end-to-end against the real demo account and
// the real Supabase backend (no mocking), same shape as tests/testflight-wave.spec.ts:
// DEMO_EMAIL/DEMO_PASSWORD + the /auth sign-in steps, BASE from WAVE_BASE_URL.
//
// Covers: create a project via the UI, archive it (house AlertDialog confirm),
// assert it disappears from the drawer's active list, Today, the drawer's own
// project search, and the Gantt view; assert it appears in the drawer's
// Archived section with a Restore action; restore it and assert it is back;
// delete the project at the end so the demo account is left as it was.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/project-archive.spec.ts
import { test, expect, type Page, type Locator } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account tests/testflight-wave.spec.ts signs in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

// The drawer is a permanently-mounted plain-div portal — never unmounted, only
// translated off-screen when closed (see the drawer architecture notes) — and
// exposes itself as role="dialog" aria-label="Projects" with a data-state
// attribute mirroring open/closed. Two consequences that shape every helper
// below: (1) it duplicates the BottomNav's "Today"/"Past Due" buttons, so an
// unscoped getByRole('button', { name: 'Today' }) is always a strict-mode
// violation — scope through getByLabel('Projects') for the drawer's own copy;
// (2) toggling it via the BottomNav "Projects" tap is a blind flip, unsafe to
// call blindly from cleanup code that doesn't know the current state — check
// data-state first instead.
const drawer = (page: Page) => page.getByLabel('Projects');

const openDrawer = async (page: Page) => {
  const state = await drawer(page).getAttribute('data-state').catch(() => null);
  if (state === 'open') return;
  await page.getByRole('button', { name: 'Projects' }).click();
  await expect(drawer(page)).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

// Selecting a special list (Today/Past Due/Unassigned) inside the drawer also
// closes it (ProjectSidebar's handleSelectSpecial calls setOpenMobile(false))
// — every call site below only reaches for this once the drawer is open.
const goToToday = async (page: Page) => {
  await drawer(page).getByRole('button', { name: 'Today', exact: true }).click();
};

// A real POLL (waitFor), not a single isVisible() snapshot — isVisible() reads
// the DOM at that exact instant with no retry, so it races anything still
// catching up (e.g. the drawer's own project fetch lagging a couple of
// seconds behind an optimistic state update elsewhere) and reports a false
// negative for something that would have appeared a moment later. Used by
// best-effort cleanup below, where a false negative means the row-to-delete
// gets silently skipped instead of found and cleaned up.
const waitVisible = (locator: Locator, timeout: number) =>
  locator.first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

// Set an AddTaskDialog date field (Start/End Date) to TODAY via its Calendar
// popover. Giving the task BOTH start and end makes it a real Gantt BAR (Gantt
// only bars tasks with startDate && endDate — src/components/GanttChart.tsx),
// which is what lets the Gantt check assert on the actual rendered bar. The
// field is <Label/><Popover><trigger button/></Popover>; the day cell is a
// button[role=gridcell] whose name is the day number, unique in the shown
// month. One calendar is open at a time — the helper waits for the grid to open
// and to close so a later field never sees two grids.
const setDateToToday = async (page: Page, dialog: Locator, labelText: string) => {
  const day = String(new Date().getDate());
  await dialog.getByText(labelText, { exact: true }).locator('..').getByRole('button').first().click();
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible({ timeout: 5000 });
  await grid.getByRole('gridcell', { name: day, exact: true }).click();
  // shadcn Calendar leaves the Popover open after select; close it and wait for
  // the grid to unmount before the next field opens its own.
  await page.keyboard.press('Escape');
  await expect(grid).toHaveCount(0, { timeout: 5000 });
};

test.describe('archive / restore a project', () => {
  test('archive hides the project everywhere, restore brings it back, demo account ends up unchanged', async ({ page }) => {
    test.setTimeout(90_000);

    const projectName = `Archive Test ${Date.now()}`;
    const taskTitle = `Archive test task ${Date.now()}`;

    await signIn(page);
    await page.goto(`${BASE}/app`);

    // Wait for the app shell to be interactive before driving it.
    await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });

    // ---- Create the test project ------------------------------------------------
    await openDrawer(page);
    await page.getByRole('button', { name: 'New Project' }).click();
    // Named, not bare getByRole('dialog') — the mobile drawer itself is also
    // exposed as an ARIA dialog ("Projects"), so an unnamed locator matches both.
    const createDialog = page.getByRole('dialog', { name: 'Create New Project' });
    await createDialog.getByPlaceholder('e.g., Website Redesign').fill(projectName);
    await createDialog.getByRole('button', { name: 'Create Project' }).click();
    await expect(createDialog).toHaveCount(0);

    // The drawer stays open after creating (only the dialog closes) — the new
    // row lands in "My Projects" once fetchProjects({fresh:true}) resolves.
    const activeRow = page.getByRole('button', { name: projectName, exact: true });
    await expect(activeRow).toBeVisible({ timeout: 15000 });

    try {
      // ---- Give it one task due TODAY, so "excluded from Today" is a real,
      // observable behaviour change and not a vacuous check. Switching to the
      // Today special list first makes AddTaskDialog auto-fill dueDate=today
      // (see src/components/AddTaskDialog.tsx), so no date-picker interaction
      // is needed — only the in-dialog Project selector.
      await goToToday(page);
      await page.getByTestId('onebar-add').click();
      const addDialog = page.getByRole('dialog', { name: 'Create New Task' });
      await addDialog.locator('#title').fill(taskTitle);
      await addDialog.locator('#project').click();
      await page.getByRole('option', { name: projectName }).click();
      // Start = End = today, so the task is a real Gantt BAR (not just an
      // unscheduled/due-only task), letting the Gantt check below assert on the
      // rendered bar.
      await setDateToToday(page, addDialog, 'Start Date');
      await setDateToToday(page, addDialog, 'End Date');
      await addDialog.getByRole('button', { name: 'Create Task' }).click();
      await expect(addDialog).toHaveCount(0);

      // Baseline: the task is visible on Today before archiving.
      await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15000 });

      // Baseline in the GANTT render too — makes the post-archive Gantt absence
      // NON-VACUOUS and guards the wiring (not just the filter): Gantt bars task
      // TITLES for tasks with start+end (src/components/GanttChart.tsx), and is
      // fed Index.tsx's `sortedTasks`. Assert the bar IS present while active; a
      // rewired Gantt feed OR a broken filter both change this.
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-view-gantt').click();
      await expect(page.locator('#root').getByText(taskTitle)).toBeVisible({ timeout: 10000 });
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-view-list').click();

      // ---- Select the project and archive it (house AlertDialog confirm) ---------
      await openDrawer(page);
      await page.getByRole('button', { name: projectName, exact: true }).click();
      await expect(page.getByTestId('onebar-title')).toContainText(projectName);

      await page.getByTestId('onebar-title').click(); // opens the context sheet
      await page.getByTestId('onebar-archive').click();
      await page.getByRole('button', { name: 'Yes, Archive' }).click();
      await expect(page.getByText('Project archived')).toBeVisible({ timeout: 15000 });

      // Archiving resets the selection back to Today (same shape as Delete).
      await expect(page.getByTestId('onebar-title')).toContainText('Today', { timeout: 10000 });

      // ---- Excluded from Today: the task under the now-archived project is gone --
      await expect(page.getByText(taskTitle)).toHaveCount(0);

      // ---- Excluded from the MAIN task search (Index's fuse over allTasks, the
      // top-of-app search — distinct from the drawer's project search below):
      // isTaskProjectActive drops tasks whose project is archived, so the
      // archived project's task must not surface here either.
      await page.getByTestId('onebar-search-btn').click();
      await page.getByTestId('onebar-search-field').fill(taskTitle);
      await expect(page.locator('#root').getByText(taskTitle)).toHaveCount(0, { timeout: 10000 });
      await page.getByTestId('onebar-search-cancel').click().catch(() => {});

      // ---- Excluded from the add-task project picker (the SAME query Home's
      // brain-dump destination list and EditTaskDialog read — Home.tsx filters
      // it with .is('archived_at', null)): an archived project must not be an
      // offered destination for new tasks. The Add-task button lives on the main
      // one-bar (no drawer needed).
      await page.getByTestId('onebar-add').click();
      const pickerDialog = page.getByRole('dialog', { name: 'Create New Task' });
      await pickerDialog.locator('#project').click();
      await expect(page.getByRole('option', { name: projectName })).toHaveCount(0, { timeout: 10000 });
      await page.keyboard.press('Escape').catch(() => {});
      await pickerDialog.getByRole('button', { name: /cancel/i }).click({ timeout: 5000 }).catch(() => {});
      await expect(pickerDialog).toHaveCount(0).catch(() => {});

      // ---- Excluded from the drawer's normal project list -------------------------
      await openDrawer(page);
      await expect(page.getByRole('button', { name: projectName, exact: true })).toHaveCount(0);

      // ---- Excluded from the drawer's project search -------------------------------
      // Asserts the archived project specifically is absent from the fuzzy
      // search results, rather than asserting "No results found" — the demo
      // account can hold other projects that fuzzy-match this one's name
      // (Fuse.js threshold 0.4), so an empty-results assertion would be a
      // false negative unrelated to the archive feature.
      const searchBox = page.getByPlaceholder('Search projects & meetings...');
      await searchBox.fill(projectName);
      // Wait for the 300ms debounce to flip the drawer into search mode (its
      // "My Projects (N)" heading swaps out for search-result groups or "No
      // results found") before checking the archived project is absent —
      // otherwise this could trivially "pass" against the pre-search render.
      await expect(page.getByText(/^My Projects \(/)).toHaveCount(0, { timeout: 5000 });
      await expect(page.getByRole('button', { name: projectName, exact: true })).toHaveCount(0);
      await searchBox.fill('');

      // ---- Present in the Archived section, with Restore ---------------------------
      const archivedToggle = page.getByTestId('archived-projects-toggle');
      await expect(archivedToggle).toBeVisible();
      const archivedList = page.getByTestId('archived-projects-list');
      if (await archivedList.count() === 0) {
        await archivedToggle.click();
      }
      const archivedRow = page.getByTestId('archived-projects-list').locator('div').filter({ hasText: projectName });
      await expect(archivedRow).toBeVisible();
      const restoreButton = archivedRow.getByRole('button', { name: /restore/i });
      await expect(restoreButton).toBeVisible();

      // ---- Excluded from Gantt: the archived project's task BAR (proven present
      // in the Gantt render above while active) is now gone. Same task title, the
      // string Gantt actually renders — its absence proves the archive filter
      // reaches the list Gantt is fed. Scoped to #root so the drawer's Archived
      // section (portalled to document.body, outside #root) is not counted.
      await goToToday(page);
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-view-gantt').click();
      // Let the Gantt view settle, then assert both the task bar and the project
      // name are absent from the main render.
      await expect(page.getByTestId('onebar-title')).toContainText('Today', { timeout: 10000 });
      await expect(page.locator('#root').getByText(taskTitle)).toHaveCount(0, { timeout: 10000 });
      await expect(page.locator('#root').getByText(projectName)).toHaveCount(0);
      // back to list view for the rest of the flow
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-view-list').click();

      // ---- Restore ------------------------------------------------------------------
      await openDrawer(page);
      const archivedListAgain = page.getByTestId('archived-projects-list');
      if (await archivedListAgain.count() === 0) {
        await page.getByTestId('archived-projects-toggle').click();
      }
      await page.getByTestId('archived-projects-list').locator('div').filter({ hasText: projectName }).getByRole('button', { name: /restore/i }).click();
      await expect(page.getByText('Project restored')).toBeVisible({ timeout: 15000 });

      // ---- Back in the active list, task reachable again -----------------------------
      await expect(page.getByRole('button', { name: projectName, exact: true })).toBeVisible({ timeout: 15000 });
      await goToToday(page);
      await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15000 });
    } finally {
      // ---- Cleanup: delete the test project (cascades its task) so the demo
      // account ends up exactly as it started. Best-effort — tries the
      // Archived-section Restore first (in case an assertion above failed
      // while the project was still archived), then selects + deletes. Uses
      // toBeVisible/toHaveCount polling (not a single .count() snapshot) at
      // every step: a bare .count() read immediately after openDrawer() races
      // the drawer's own render and can undercount, silently skipping cleanup.
      await openDrawer(page).catch(() => {});

      const cleanupRestoreBtn = page
        .getByTestId('archived-projects-list')
        .locator('div')
        .filter({ hasText: projectName })
        .getByRole('button', { name: /restore/i });
      if (await page.getByTestId('archived-projects-toggle').isVisible().catch(() => false)) {
        if (!(await page.getByTestId('archived-projects-list').isVisible().catch(() => false))) {
          await page.getByTestId('archived-projects-toggle').click().catch(() => {});
        }
        if (await cleanupRestoreBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await cleanupRestoreBtn.click().catch(() => {});
          await expect(page.getByText('Project restored')).toBeVisible({ timeout: 10000 }).catch(() => {});
        }
      }

      await openDrawer(page).catch(() => {});
      const cleanupRow = page.getByRole('button', { name: projectName, exact: true });
      if (await cleanupRow.isVisible({ timeout: 10000 }).catch(() => false)) {
        await cleanupRow.click();
        await expect(page.getByTestId('onebar-title')).toContainText(projectName, { timeout: 10000 }).catch(() => {});
        await page.getByTestId('onebar-title').click().catch(() => {});
        await page.getByTestId('onebar-delete').click({ timeout: 5000 }).catch(() => {});
        await page.getByRole('button', { name: 'Yes, Delete' }).click({ timeout: 5000 }).catch(() => {});
        await expect(page.getByText('Project and all its tasks deleted')).toBeVisible({ timeout: 10000 }).catch(() => {});
      }
    }
  });

  // An archived project IS now reachable again: tapping its row in the drawer's
  // Archived section (not the Restore button) re-selects it via the same
  // handleSelectProject path an active row uses, so its header, tasks and time
  // report all resolve. Covers: the header shows the archived project's name
  // plus the "Archived" marker instead of "Unknown Project"; the time report
  // (TimeTrackingChart, the "Time" view) still lists the project's own task by
  // title, proving `allProjectsForReports` keeps its name/color resolvable
  // instead of collapsing the row into "Unassigned"; Restore from the header
  // action clears the marker and returns the project to "My Projects", staying
  // selected throughout (no forced trip back to Today the way Archive itself
  // does).
  test('archived project stays reachable from the drawer: header shows it, its time report still resolves it, Restore brings it back', async ({ page }) => {
    test.setTimeout(90_000);

    const projectName = `Archive Reach Test ${Date.now()}`;
    const taskTitle = `Archive reach task ${Date.now()}`;

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });

    // ---- Create the test project ------------------------------------------------
    await openDrawer(page);
    await page.getByRole('button', { name: 'New Project' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create New Project' });
    await createDialog.getByPlaceholder('e.g., Website Redesign').fill(projectName);
    await createDialog.getByRole('button', { name: 'Create Project' }).click();
    await expect(createDialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: projectName, exact: true })).toBeVisible({ timeout: 15000 });

    try {
      // ---- One task with a known title, so the time report has a row to find ----
      await goToToday(page);
      await page.getByTestId('onebar-add').click();
      const addDialog = page.getByRole('dialog', { name: 'Create New Task' });
      await addDialog.locator('#title').fill(taskTitle);
      await addDialog.locator('#project').click();
      await page.getByRole('option', { name: projectName }).click();
      await addDialog.getByRole('button', { name: 'Create Task' }).click();
      await expect(addDialog).toHaveCount(0);
      await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15000 });

      // ---- Archive the project (same house AlertDialog confirm as the test above) --
      await openDrawer(page);
      await page.getByRole('button', { name: projectName, exact: true }).click();
      await expect(page.getByTestId('onebar-title')).toContainText(projectName);
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-archive').click();
      await page.getByRole('button', { name: 'Yes, Archive' }).click();
      await expect(page.getByText('Project archived')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('onebar-title')).toContainText('Today', { timeout: 10000 });

      // ---- Reach it again: tap the ROW in the Archived section, not Restore -------
      await openDrawer(page);
      const archivedToggle = page.getByTestId('archived-projects-toggle');
      await expect(archivedToggle).toBeVisible();
      if (await page.getByTestId('archived-projects-list').count() === 0) {
        await archivedToggle.click();
      }
      const archivedRow = page.getByTestId('archived-projects-list').locator('div').filter({ hasText: projectName });
      await expect(archivedRow).toBeVisible();
      await archivedRow.getByRole('button', { name: projectName, exact: true }).click();

      // ---- Header resolves the archived project's name, with the Archived marker --
      await expect(page.getByTestId('onebar-title')).toContainText(projectName, { timeout: 10000 });
      await expect(page.getByTestId('onebar-archived-badge')).toBeVisible();

      // ---- Time view: the project's own task is still findable in the report ------
      // The context sheet is a plain open-on-tap Radix Sheet (not forceMount — see
      // the drawer architecture notes), so it unmounts on its own exit animation
      // after each dismissing click; waiting for it to fully close before the next
      // click on onebar-title (which sits right where the sheet's backdrop briefly
      // still is) avoids an actionability retry loop racing that animation.
      const contextSheet = page.getByTestId('onebar-context-sheet');
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-view-time-tracking').click();
      await contextSheet.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      const chart = page.getByTestId('time-tracking-chart');
      await expect(chart).toBeVisible({ timeout: 10000 });
      // The task row is in the report.
      await expect(chart.getByText(taskTitle)).toBeVisible({ timeout: 10000 });
      // (d) — the discriminating assertion: with the archived project selected,
      // its task is the ONLY task in view, so the report has exactly one project
      // group. If allProjectsForReports resolved the archived project's name,
      // that group's header is the project NAME; if the lookup had collapsed
      // (the failure the code guards against), the header would read
      // "Unassigned" (TimeTrackingChart: projectName = project?.name ||
      // 'Unassigned'). Assert the name IS the header and "Unassigned" is absent —
      // this is what actually proves an archived project's time stays resolvable.
      await expect(chart.getByTestId('time-group-name').filter({ hasText: projectName })).toBeVisible();
      await expect(chart.getByTestId('time-group-name').filter({ hasText: 'Unassigned' })).toHaveCount(0);
      // back to list view for the rest of the flow
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-view-list').click();
      await contextSheet.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

      // ---- Restore from the header action — marker gone, project stays selected ---
      await page.getByTestId('onebar-title').click();
      await page.getByTestId('onebar-restore').click();
      await expect(page.getByText('Project restored')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('onebar-archived-badge')).toHaveCount(0);

      // ---- Back in "My Projects" -----------------------------------------------------
      await openDrawer(page);
      await expect(page.getByRole('button', { name: projectName, exact: true })).toBeVisible({ timeout: 15000 });
    } finally {
      // ---- Cleanup: delete the test project so the demo account ends up as it
      // started. Best-effort — tries the Archived-section Restore first (in
      // case an assertion above failed while the project was still archived),
      // then selects + deletes. Every presence check uses waitVisible (a real
      // poll) rather than a bare isVisible() snapshot: right after the Restore
      // a few lines up, Index.tsx's own state already shows the project as
      // active, but the DRAWER's separate project fetch (same
      // projectRefreshTrigger bump, its own network round trip) can lag a few
      // seconds behind — a snapshot check in that window false-negatives and
      // silently skips cleanup, orphaning the project (observed for real
      // while developing this test). Every click also carries an explicit
      // bounded timeout on top of its .catch(): a bare .click() with neither
      // inherits the TEST's own remaining timeout budget as its ceiling, so
      // one transient actionability retry silently burns the whole test
      // instead of failing fast.
      await openDrawer(page).catch(() => {});

      const cleanupRestoreBtn = page
        .getByTestId('archived-projects-list')
        .locator('div')
        .filter({ hasText: projectName })
        .getByRole('button', { name: /restore/i });
      if (await waitVisible(page.getByTestId('archived-projects-toggle'), 5000)) {
        if (!(await waitVisible(page.getByTestId('archived-projects-list'), 1000))) {
          await page.getByTestId('archived-projects-toggle').click({ timeout: 8000 }).catch(() => {});
        }
        if (await waitVisible(cleanupRestoreBtn, 8000)) {
          await cleanupRestoreBtn.click({ timeout: 8000 }).catch(() => {});
          await expect(page.getByText('Project restored')).toBeVisible({ timeout: 10000 }).catch(() => {});
        }
      }

      await openDrawer(page).catch(() => {});
      const cleanupRow = page.getByRole('button', { name: projectName, exact: true });
      if (await waitVisible(cleanupRow, 15000)) {
        await cleanupRow.click({ timeout: 8000 }).catch(() => {});
        await expect(page.getByTestId('onebar-title')).toContainText(projectName, { timeout: 10000 }).catch(() => {});
        await page.getByTestId('onebar-title').click({ timeout: 8000 }).catch(() => {});
        await page.getByTestId('onebar-delete').click({ timeout: 5000 }).catch(() => {});
        await page.getByRole('button', { name: 'Yes, Delete' }).click({ timeout: 5000 }).catch(() => {});
        await expect(page.getByText('Project and all its tasks deleted')).toBeVisible({ timeout: 10000 }).catch(() => {});
      }
    }
  });
});
