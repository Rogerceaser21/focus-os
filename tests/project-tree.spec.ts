// Sub-projects (P3) — end-to-end against the real demo account and the real
// Supabase backend (no mocking), modelled on tests/project-archive.spec.ts:
// DEMO_EMAIL/DEMO_PASSWORD + the /auth sign-in steps, BASE from WAVE_BASE_URL,
// timestamped project names, try/finally cleanup that deletes everything the
// test created (subs first, then parents) so the demo account ends up unchanged.
//
// Covers: create-under, move-to (both directions), the one-level-deep refusal,
// cascade archive/restore, and that a sub-project is an ordinary project row for
// routing and task CRUD.
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/project-tree.spec.ts
import { test, expect, type Page, type Locator } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account tests/project-archive.spec.ts signs in with.
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

// The drawer is a permanently-mounted plain-div portal (never unmounted, only
// translated off-screen when closed) exposed as role="dialog" aria-label="Projects"
// with a data-state attribute. Copied verbatim from tests/project-archive.spec.ts:
// an unscoped getByRole('button', { name: 'Today' }) is a strict-mode violation
// because the BottomNav carries the same labels, and toggling the drawer blindly
// from cleanup code is unsafe — check data-state first.
const drawer = (page: Page) => page.getByLabel('Projects');

const openDrawer = async (page: Page) => {
  const state = await drawer(page).getAttribute('data-state').catch(() => null);
  if (state === 'open') return;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer(page)).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

// A real POLL (waitFor), not a single isVisible() snapshot — the drawer runs its
// OWN project fetch, which can lag a couple of seconds behind Index's optimistic
// state, so a snapshot read in that window false-negatives and silently skips
// cleanup. Same helper the archive spec uses.
const waitVisible = (locator: Locator, timeout: number) =>
  locator.first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

// ---- Helpers that know about the P3 markup -----------------------------------

// Every project row (top level or sub) carries data-testid="select-project-<id>",
// which is how a test recovers the id of a project it created through the UI.
const projectIdByName = async (page: Page, name: string): Promise<string> => {
  const row = page.locator('[data-testid^="select-project-"]').filter({ hasText: name }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  const testId = await row.getAttribute('data-testid');
  const id = (testId ?? '').replace('select-project-', '');
  expect(id, `could not resolve a project id for "${name}"`).not.toBe('');
  return id;
};

// Create a project through the drawer's own dialog. `parentName` (optional) picks
// a parent in the new "Parent project" select — the create-inside-parent entry
// point. Returns the new project's id.
const createProject = async (page: Page, name: string, parentName?: string): Promise<string> => {
  await openDrawer(page);
  await page.getByRole('button', { name: 'New Project' }).click();
  // Named, not bare getByRole('dialog') — the drawer itself is also an ARIA dialog.
  const createDialog = page.getByRole('dialog', { name: 'Create New Project' });
  await createDialog.getByPlaceholder('e.g., Website Redesign').fill(name);
  if (parentName) {
    await createDialog.getByTestId('create-project-parent').click();
    await page.getByRole('option', { name: parentName, exact: true }).click();
  }
  await createDialog.getByRole('button', { name: 'Create Project' }).click();
  await expect(createDialog).toHaveCount(0);
  return projectIdByName(page, name);
};

// Select a project and open its context sheet (the onebar's action menu).
const openProjectActions = async (page: Page, projectId: string, projectName: string) => {
  await page.goto(`${BASE}/app?view=${projectId}`);
  await expect(page.getByTestId('onebar-title')).toContainText(projectName, { timeout: 20000 });
  await page.getByTestId('onebar-title').click();
  await expect(page.getByTestId('onebar-context-sheet')).toBeVisible({ timeout: 5000 });
};

// Expand a parent row's sub-list if it is not already expanded. Creating a sub
// auto-expands its parent, so this must never assume a starting state.
const expandTree = async (page: Page, parentId: string) => {
  await openDrawer(page);
  const toggle = page.getByTestId(`tree-toggle-${parentId}`);
  await expect(toggle).toBeVisible({ timeout: 15000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 });
  }
};

// Cleanup primitive: delete one project by id through the app's own Delete flow.
// Deep-links to it first, so it works whether or not the row is reachable in the
// drawer (collapsed under a parent, or sitting in the Archived section).
const deleteProjectById = async (page: Page, projectId: string) => {
  await page.goto(`${BASE}/app?view=${projectId}`);
  await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 }).catch(() => {});
  await page.getByTestId('onebar-title').click({ timeout: 8000 }).catch(() => {});
  await page.getByTestId('onebar-delete').click({ timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: 'Yes, Delete' }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.getByText('Project and all its tasks deleted')).toBeVisible({ timeout: 10000 }).catch(() => {});
};

// Cleanup: SUBS FIRST (the FK is ON DELETE SET NULL, so deleting a parent would
// orphan its subs into top-level rows on the demo account instead of removing
// them), then the parents. Ids are collected as the test creates them, so a test
// that fails half way still deletes whatever did get created.
const cleanupProjects = async (page: Page, subIds: string[], parentIds: string[]) => {
  for (const id of subIds) await deleteProjectById(page, id).catch(() => {});
  for (const id of parentIds) await deleteProjectById(page, id).catch(() => {});
};

test.describe('sub-projects: tree, move, cascade', () => {
  test('create-under: a project created with a parent renders as an indented sub under a chevron row', async ({ page }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const parentName = `Tree Test ${stamp}`;
    const subName = `Tree Sub ${stamp}`;
    let parentId = '';
    let subId = '';

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });

    try {
      parentId = await createProject(page, parentName);

      // Before the sub exists, the parent is an ordinary flat row: no chevron.
      // This is what makes the chevron assertion below non-vacuous.
      await openDrawer(page);
      await expect(page.getByTestId(`tree-toggle-${parentId}`)).toHaveCount(0);

      subId = await createProject(page, subName, parentName);

      // The parent now owns a chevron toggle, and the sub is NOT a top-level row.
      await openDrawer(page);
      const toggle = page.getByTestId(`tree-toggle-${parentId}`);
      await expect(toggle).toBeVisible({ timeout: 15000 });

      // Collapse, then expand: proves the toggle actually drives the sub's
      // presence rather than the sub happening to be rendered anyway.
      await expandTree(page, parentId);
      await expect(page.getByTestId(`tree-sub-${subId}`)).toBeVisible({ timeout: 10000 });
      await toggle.click();
      await expect(page.getByTestId(`tree-sub-${subId}`)).toHaveCount(0, { timeout: 5000 });
      await toggle.click();
      await expect(page.getByTestId(`tree-sub-${subId}`)).toBeVisible({ timeout: 5000 });

      // INDENT: the sub's own row button starts further right than the parent's.
      // Measured against the rendered geometry (not just a class name), so a
      // stylesheet that dropped the indent would fail this.
      const parentBox = await page.getByTestId(`select-project-${parentId}`).boundingBox();
      const subBox = await page.getByTestId(`select-project-${subId}`).boundingBox();
      expect(parentBox, 'parent row must be rendered').not.toBeNull();
      expect(subBox, 'sub row must be rendered').not.toBeNull();
      expect(subBox!.x).toBeGreaterThan(parentBox!.x);
      await expect(page.getByTestId(`tree-sub-${subId}`)).toHaveClass(/pl-10/);
    } finally {
      await cleanupProjects(page, [subId].filter(Boolean), [parentId].filter(Boolean));
    }
  });

  test('move-to: a top-level project moves under a parent and back out again', async ({ page }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const parentName = `Tree Test ${stamp}`;
    const moverName = `Tree Sub ${stamp}`;
    let parentId = '';
    let moverId = '';

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });

    try {
      parentId = await createProject(page, parentName);
      moverId = await createProject(page, moverName);

      // Baseline: both are top-level rows and neither is a sub of anything.
      await openDrawer(page);
      await expect(page.getByTestId(`select-project-${moverId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`tree-sub-${moverId}`)).toHaveCount(0);

      // ---- Move it UNDER the parent ------------------------------------------
      await openProjectActions(page, moverId, moverName);
      await page.getByTestId('onebar-move').click();
      await expect(page.getByTestId('onebar-move-sheet')).toBeVisible({ timeout: 5000 });
      await page.getByTestId(`onebar-move-to-${parentId}`).click();
      await expect(page.getByText(`Moved under ${parentName}`)).toBeVisible({ timeout: 15000 });

      await expandTree(page, parentId);
      await expect(page.getByTestId(`tree-sub-${moverId}`)).toBeVisible({ timeout: 15000 });

      // ---- Move it back to TOP LEVEL -----------------------------------------
      await openProjectActions(page, moverId, moverName);
      await page.getByTestId('onebar-move').click();
      await expect(page.getByTestId('onebar-move-sheet')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('onebar-move-top').click();
      await expect(page.getByText('Moved to top level')).toBeVisible({ timeout: 15000 });

      await openDrawer(page);
      await expect(page.getByTestId(`select-project-${moverId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`tree-sub-${moverId}`)).toHaveCount(0, { timeout: 10000 });
      // The parent has no subs left, so its chevron is gone too.
      await expect(page.getByTestId(`tree-toggle-${parentId}`)).toHaveCount(0);
    } finally {
      await cleanupProjects(page, [], [moverId, parentId].filter(Boolean));
    }
  });

  test('one level deep: a project that has sub-projects is refused as a sub, and a sub is never offered as a target', async ({ page }) => {
    test.setTimeout(150_000);

    const stamp = Date.now();
    const parentName = `Tree Test ${stamp}`;
    const subName = `Tree Sub ${stamp}`;
    const otherName = `Tree Test other ${stamp}`;
    let parentId = '';
    let subId = '';
    let otherId = '';

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });

    try {
      parentId = await createProject(page, parentName);
      subId = await createProject(page, subName, parentName);
      otherId = await createProject(page, otherName);

      await openProjectActions(page, parentId, parentName);
      await page.getByTestId('onebar-move').click();
      await expect(page.getByTestId('onebar-move-sheet')).toBeVisible({ timeout: 5000 });

      // A SUB is never a move target (half of the one-level rule), while an
      // eligible top-level project IS — the pair makes this non-vacuous.
      await expect(page.getByTestId(`onebar-move-to-${otherId}`)).toBeVisible();
      await expect(page.getByTestId(`onebar-move-to-${subId}`)).toHaveCount(0);

      // The other half: moving a project that HAS subs under another project is
      // refused, with no database write.
      await page.getByTestId(`onebar-move-to-${otherId}`).click();
      await expect(page.getByText('Move its sub-projects first')).toBeVisible({ timeout: 10000 });

      // Still top level, still holding its own sub.
      await openDrawer(page);
      await expect(page.getByTestId(`select-project-${parentId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`tree-sub-${parentId}`)).toHaveCount(0);
      await expect(page.getByTestId(`tree-toggle-${parentId}`)).toBeVisible();
      await expect(page.getByTestId(`tree-toggle-${otherId}`)).toHaveCount(0);

      // And the refusal survives a reload — proof nothing was written.
      await page.goto(`${BASE}/app`);
      await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });
      await openDrawer(page);
      await expect(page.getByTestId(`select-project-${parentId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`tree-sub-${parentId}`)).toHaveCount(0);
    } finally {
      await cleanupProjects(page, [subId].filter(Boolean), [parentId, otherId].filter(Boolean));
    }
  });

  test('cascade: archiving a parent archives its subs, and restoring the parent brings both back', async ({ page }) => {
    test.setTimeout(150_000);

    const stamp = Date.now();
    const parentName = `Tree Test ${stamp}`;
    const subName = `Tree Sub ${stamp}`;
    let parentId = '';
    let subId = '';

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });

    try {
      parentId = await createProject(page, parentName);
      subId = await createProject(page, subName, parentName);

      // Baseline: both rows exist in the active drawer list.
      await expandTree(page, parentId);
      await expect(page.getByTestId(`select-project-${parentId}`)).toBeVisible();
      await expect(page.getByTestId(`select-project-${subId}`)).toBeVisible();

      // ---- Archive the PARENT (house AlertDialog confirm) ---------------------
      await openProjectActions(page, parentId, parentName);
      await page.getByTestId('onebar-archive').click();
      await page.getByRole('button', { name: 'Yes, Archive' }).click();
      await expect(page.getByText('Project archived')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('onebar-title')).toContainText('Today', { timeout: 10000 });

      // ---- Both gone from the active drawer list ------------------------------
      await openDrawer(page);
      await expect(page.getByTestId(`select-project-${parentId}`)).toHaveCount(0, { timeout: 10000 });
      await expect(page.getByTestId(`select-project-${subId}`)).toHaveCount(0);
      await expect(page.getByTestId(`tree-toggle-${parentId}`)).toHaveCount(0);

      // ---- Gone from the drawer's project search too --------------------------
      // Asserts the two test projects specifically are absent rather than "no
      // results", because the demo account can hold other fuzzy matches.
      const searchBox = page.getByPlaceholder('Search projects & meetings...');
      await searchBox.fill(subName);
      await expect(page.getByText(/^My Projects \(/)).toHaveCount(0, { timeout: 5000 });
      await expect(page.getByTestId(`select-project-${subId}`)).toHaveCount(0);
      await expect(page.getByTestId(`select-project-${parentId}`)).toHaveCount(0);
      await searchBox.fill('');

      // ---- Archived section: ONE row for the parent, carrying the sub count ----
      const archivedToggle = page.getByTestId('archived-projects-toggle');
      await expect(archivedToggle).toBeVisible({ timeout: 10000 });
      if (await page.getByTestId('archived-projects-list').count() === 0) {
        await archivedToggle.click();
      }
      await expect(page.getByTestId(`restore-project-${parentId}`)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`archived-sub-count-${parentId}`)).toHaveText('(1 sub-project)');
      // The cascaded sub is folded INTO the parent's row, not listed separately.
      await expect(page.getByTestId(`restore-project-${subId}`)).toHaveCount(0);

      // ---- Restore the parent: both come back, sub still under the parent -----
      await page.getByTestId(`restore-project-${parentId}`).click();
      await expect(page.getByText('Project restored')).toBeVisible({ timeout: 15000 });

      await openDrawer(page);
      await expect(page.getByTestId(`select-project-${parentId}`)).toBeVisible({ timeout: 15000 });
      await expandTree(page, parentId);
      await expect(page.getByTestId(`tree-sub-${subId}`)).toBeVisible({ timeout: 10000 });

      // ---- Archiving a SUB on its own never touches its parent ---------------
      await openProjectActions(page, subId, subName);
      await page.getByTestId('onebar-archive').click();
      await page.getByRole('button', { name: 'Yes, Archive' }).click();
      await expect(page.getByText('Project archived')).toBeVisible({ timeout: 15000 });

      await openDrawer(page);
      // Parent still active, and it no longer shows a chevron (its only active
      // sub just left) — while the sub gets its OWN archived row with its own
      // Restore, not a count suffix on the parent.
      await expect(page.getByTestId(`select-project-${parentId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`select-project-${subId}`)).toHaveCount(0);
      if (await page.getByTestId('archived-projects-list').count() === 0) {
        await page.getByTestId('archived-projects-toggle').click();
      }
      await expect(page.getByTestId(`restore-project-${subId}`)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`restore-project-${parentId}`)).toHaveCount(0);
      await expect(page.getByTestId(`archived-sub-count-${subId}`)).toHaveCount(0);

      // Restore the sub on its own: back under its parent, parent untouched.
      await page.getByTestId(`restore-project-${subId}`).click();
      await expect(page.getByText('Project restored')).toBeVisible({ timeout: 15000 });
      await openDrawer(page);
      await expandTree(page, parentId);
      await expect(page.getByTestId(`tree-sub-${subId}`)).toBeVisible({ timeout: 15000 });
    } finally {
      // Restore first in case an assertion failed while the pair was archived —
      // deleteProjectById works either way, but restoring keeps the archived
      // section clean for the next run if the delete itself fails.
      await openDrawer(page).catch(() => {});
      if (parentId && await waitVisible(page.getByTestId('archived-projects-toggle'), 4000)) {
        if (!(await waitVisible(page.getByTestId('archived-projects-list'), 1000))) {
          await page.getByTestId('archived-projects-toggle').click({ timeout: 8000 }).catch(() => {});
        }
        for (const id of [parentId, subId].filter(Boolean)) {
          if (await waitVisible(page.getByTestId(`restore-project-${id}`), 4000)) {
            await page.getByTestId(`restore-project-${id}`).click({ timeout: 8000 }).catch(() => {});
            await expect(page.getByText('Project restored')).toBeVisible({ timeout: 10000 }).catch(() => {});
          }
        }
      }
      await cleanupProjects(page, [subId].filter(Boolean), [parentId].filter(Boolean));
    }
  });

  test('a sub-project is an ordinary project: it routes by id, shows its parent as a breadcrumb, and takes tasks', async ({ page }) => {
    test.setTimeout(150_000);

    const stamp = Date.now();
    const parentName = `Tree Test ${stamp}`;
    const subName = `Tree Sub ${stamp}`;
    const taskTitle = `Tree sub task ${stamp}`;
    let parentId = '';
    let subId = '';

    await signIn(page);
    await page.goto(`${BASE}/app`);
    await expect(page.getByTestId('onebar-title')).toBeVisible({ timeout: 20000 });

    try {
      parentId = await createProject(page, parentName);
      subId = await createProject(page, subName, parentName);

      // ---- Routing: a plain deep link by the SUB's own id ---------------------
      await page.goto(`${BASE}/app?view=${subId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(subName, { timeout: 20000 });
      await expect(page.getByTestId('onebar-parent-name')).toHaveText(parentName);

      // ---- Task CRUD unchanged: adding a task lands it in the sub ------------
      await page.getByTestId('onebar-add').click();
      const addDialog = page.getByRole('dialog', { name: 'Create New Task' });
      await addDialog.locator('#title').fill(taskTitle);
      await addDialog.getByRole('button', { name: 'Create Task' }).click();
      await expect(addDialog).toHaveCount(0);
      await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15000 });

      // Survives a reload on the same deep link — it really is on the sub, not
      // just in the optimistic local list.
      await page.goto(`${BASE}/app?view=${subId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(subName, { timeout: 20000 });
      await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15000 });

      // ---- The PARENT is not a sub, so it shows no breadcrumb ----------------
      // Non-vacuous counterpart to the breadcrumb assertion above.
      await page.goto(`${BASE}/app?view=${parentId}`);
      await expect(page.getByTestId('onebar-title')).toContainText(parentName, { timeout: 20000 });
      await expect(page.getByTestId('onebar-parent-name')).toHaveCount(0);
    } finally {
      // Deleting the sub removes its task with it (handleDeleteProject deletes
      // the project's tasks first).
      await cleanupProjects(page, [subId].filter(Boolean), [parentId].filter(Boolean));
    }
  });
});
