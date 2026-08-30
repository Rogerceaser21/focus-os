// Manual project ORDER and PINNING (O8).
//
// Igor's ask: reorder projects and sub-projects by dragging, and pin the few he
// lives in to the top of the drawer. U2 made a drop CHANGE PARENTS; this adds a
// position inside the sibling group, plus a Pinned group with a hard cap of five.
//
// HERMETIC ON PURPOSE. The two columns this feature is built on (sort_order,
// pinned_at) ship in supabase/migrations/20260826141431_add_project_sort_pin.sql
// and do not exist on the live database until that migration is applied, so every
// PostgREST read and write here is intercepted (same strategy as
// tests/helpers/braindumpEnv.ts): a session is seeded into localStorage and an
// in-memory project table answers the GETs and echoes the FULL row on every PATCH.
// The full-row echo is the law, not a detail: an `{}` echo wipes fields out of the
// React Query cache and relaunches the tours over the UI.
//
// The live half ("does sort_order actually survive a reload against Supabase")
// lives in its own describe block at the bottom, guarded by a probe select that
// SKIPS it while the column is missing. Run it once the migration has landed.
//
// What this proves:
//   (1) dragging a top-level row into the seam above another one renders the new
//       order AND writes a renormalised sort_order for every row that moved;
//   (2) the same gesture inside a parent reorders its sub-projects only;
//   (3) Pin floats a project into the Pinned group above "My Projects", and
//       unpinning drops it straight back into its manual slot;
//   (4) the sixth pin is refused with the cap toast and writes NOTHING;
//   (5) a pinned SUB shows up in the Pinned group and still renders under its
//       parent in the tree;
//   (6) the "Move to..." sheet offers exactly the order the drawer renders;
//   (7) the long-press path reorders on a 393x852 phone (CDP touch events, the
//       only pipeline that reaches dnd-kit's TouchSensor).
//
// Run: WAVE_BASE_URL=http://localhost:8091 npx playwright test tests/project-order.spec.ts
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

// actionTimeout bounds every bare locator action in THIS file only. The shared
// playwright.config.ts leaves it unset (0 = unbounded), which lets a zero-match
// locator hang for the whole test timeout instead of failing fast.
test.use({ actionTimeout: 15000 });

const BASE = process.env.WAVE_BASE_URL ?? '';

const PROJECT_REF = 'mshlbsgsyzzfxyxramjj';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'project.order.probe@example.test';

// ---- the in-memory project table --------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  is_shared: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  parent_project_id: string | null;
  sort_order: number | null;
  pinned_at: string | null;
}

interface Write {
  method: string;
  url: string;
  body: any;
}

/** Stable, readable ids: project n is 2222222n-…-2222222222n. */
const pid = (n: number) => `2222222${n}-2222-4222-8222-22222222222${n}`;

const projectRow = (n: number, over: Partial<ProjectRow> = {}): ProjectRow => ({
  id: pid(n),
  name: `Order P${n}`,
  color: '#3b82f6',
  is_shared: false,
  user_id: USER_ID,
  // DESCENDING created_at against ASCENDING sort_order: the loader hands rows over
  // newest first, so a list that renders P1, P2, P3 can only have got there through
  // the new comparator.
  created_at: new Date(Date.UTC(2026, 0, 20 - n)).toISOString(),
  updated_at: new Date(Date.UTC(2026, 0, 20 - n)).toISOString(),
  archived_at: null,
  parent_project_id: null,
  sort_order: n - 1,
  pinned_at: null,
  ...over,
});

const prefRow = () => ({
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
});

// Seed a valid-looking Supabase session before any app code runs, so getSession()
// resolves offline and useAuth has a user at first render.
async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
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
 * Intercept every PostgREST call. `rows` IS the table: PATCHes mutate it and echo
 * the FULL updated rows back, so the app's own cache never loses a column
 * (hermetic-harness law, see tests/helpers/braindumpEnv.ts).
 */
async function installIntercepts(context: BrowserContext, rows: ProjectRow[], writes: Write[]): Promise<void> {
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
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (method !== 'GET' && method !== 'HEAD') {
      const payload = req.postDataJSON();
      writes.push({ method, url, body: payload });
      if (url.includes('focusos_projects') && method === 'POST') {
        // The create path: append the row so the next read renders it, and echo it
        // back in full the way PostgREST's `.select()` on an insert does.
        const inserted: ProjectRow = {
          id: `33333333-3333-4333-8333-${String(rows.length).padStart(12, '0')}`,
          color: '#3b82f6',
          is_shared: false,
          user_id: USER_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          archived_at: null,
          parent_project_id: null,
          sort_order: null,
          pinned_at: null,
          ...(Array.isArray(payload) ? payload[0] : payload),
        };
        rows.push(inserted);
        return reply(wantsObject ? inserted : [inserted]);
      }
      if (url.includes('focusos_projects')) {
        // `id=eq.<uuid>` and `or=(id.eq.<uuid>,parent_project_id.eq.<uuid>)` are the
        // only two shapes the app writes projects with.
        const idMatch = /id=eq\.([0-9a-f-]+)/.exec(url);
        const orMatch = /or=\(id\.eq\.([0-9a-f-]+),parent_project_id\.eq\.([0-9a-f-]+)\)/.exec(url);
        const touched = rows.filter((r) =>
          orMatch
            ? r.id === orMatch[1] || r.parent_project_id === orMatch[2]
            : idMatch
              ? r.id === idMatch[1]
              : false,
        );
        for (const target of touched) Object.assign(target, payload);
        // FULL rows, never {}.
        return reply(wantsObject ? (touched[0] ?? null) : touched.map((r) => ({ ...r })));
      }
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
      return reply(wantsObject ? {} : []);
    }

    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_projects')) return reply(rows.map((r) => ({ ...r })));
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

// ---- reading the drawer ------------------------------------------------------

/** The names of the TOP-LEVEL rows under "My Projects", in rendered order. */
const myProjectsOrder = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const list = document.querySelector('[data-testid="my-projects-list"]');
    if (!list) return [];
    return Array.from(list.children).map((entry) => {
      const projectRowEl = entry.querySelector('[data-testid^="select-project-"]');
      return (projectRowEl?.textContent ?? '').trim();
    });
  });

/** The sub rows under one parent, in rendered order. */
const subOrder = (page: Page, parentId: string): Promise<string[]> =>
  page.evaluate((id) => {
    const list = document.querySelector(`[data-testid="tree-subs-${id}"]`);
    if (!list) return [];
    return Array.from(list.querySelectorAll('[data-testid^="select-project-"]')).map((el) =>
      (el.textContent ?? '').trim(),
    );
  }, parentId);

/** The Pinned group's entries, in rendered order (one name per entry). */
const pinnedOrder = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const list = document.querySelector('[data-testid="pinned-projects-list"]');
    if (!list) return [];
    return Array.from(list.children).map((entry) => {
      const el = entry.matches('[data-testid^="pinned-row-"]')
        ? entry
        : entry.querySelector('[data-testid^="select-project-"]');
      return (el?.textContent ?? '').trim();
    });
  });

/** id -> sort_order across every project PATCH seen so far. */
const sortOrderWrites = (writes: Write[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const w of writes) {
    if (w.method !== 'PATCH' || !w.url.includes('focusos_projects')) continue;
    if (!w.body || typeof w.body.sort_order !== 'number') continue;
    const m = /id=eq\.([0-9a-f-]+)/.exec(w.url);
    if (m) out[m[1]] = w.body.sort_order;
  }
  return out;
};

const projectPatches = (writes: Write[]) =>
  writes.filter((w) => w.method === 'PATCH' && w.url.includes('focusos_projects'));

// ---- gestures ----------------------------------------------------------------

/**
 * A mouse drag that lands the GHOST'S CENTRE on (toX, toY).
 *
 * Pressing at the source row's centre makes the two coincide: dnd-kit translates
 * the dragged rect by the pointer delta, so ghost centre = source centre + delta =
 * wherever the pointer is. That is what lets a test aim at the 14px reorder band
 * at a block's top edge with any confidence.
 */
const mouseDragTo = async (
  page: Page,
  source: Locator,
  toX: number,
  toY: number,
  opts: { beforeRelease?: () => Promise<void> } = {},
) => {
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  expect(s, 'the dragged row must have a box').toBeTruthy();
  const sx = s!.x + s!.width / 2;
  const sy = s!.y + s!.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // > 8px in one move so the pointer sensor is definitely activated.
  await page.mouse.move(sx, sy - 14);
  await page.waitForTimeout(60);
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(sx + ((toX - sx) * i) / steps, sy + ((toY - sy) * i) / steps);
    await page.waitForTimeout(30);
  }
  await page.mouse.move(toX, toY);
  await page.waitForTimeout(150);
  if (opts.beforeRelease) await opts.beforeRelease();
  await page.mouse.up();
  await page.waitForTimeout(300);
};

/**
 * The touch half of the same gesture: touchStart, a STILL hold past the
 * TouchSensor's 250ms delay, then the walk. Dispatched through CDP because
 * Playwright's touchscreen API only taps and dnd-kit needs genuine touchmoves.
 */
const touchDragTo = async (page: Page, source: Locator, toX: number, toY: number) => {
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  expect(s, 'the dragged row must have a box').toBeTruthy();
  const x0 = s!.x + s!.width / 2;
  const y0 = s!.y + s!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await page.waitForTimeout(450);
    const steps = 16;
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x0 + ((toX - x0) * i) / steps, y: y0 + ((toY - y0) * i) / steps }],
      });
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  } finally {
    await cdp.detach();
  }
};

// ---- app boot ----------------------------------------------------------------

const row = (page: Page, id: string) => page.locator(`[data-testid="select-project-${id}"]`);
const blockOf = (page: Page, id: string) => page.locator(`[data-testid="project-block-${id}"]`);

/** The drawer is inline at desktop widths and a portalled panel on a phone. */
const openDrawer = async (page: Page) => {
  const drawer = page.getByLabel('Projects');
  if ((await drawer.count()) === 0) return; // desktop: already inline
  if ((await drawer.getAttribute('data-state').catch(() => null)) === 'open') return;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

/**
 * Wait for the drawer to finish SLIDING IN. `data-state="open"` flips at the
 * start of the transition, not the end, so a gesture aimed straight after it
 * lands on a panel that is still off-screen (its rows report a negative x) and
 * hits nothing at all. Poll until the list has settled at a stable, on-screen x.
 */
const settleDrawer = async (page: Page) => {
  const list = page.locator('[data-testid="my-projects-list"]');
  const deadline = Date.now() + 10000;
  let last = Number.NaN;
  while (Date.now() < deadline) {
    const x = (await list.boundingBox())?.x ?? -1;
    if (x >= 0 && Math.abs(x - last) < 0.5) return;
    last = x;
    await page.waitForTimeout(120);
  }
  throw new Error('the drawer never settled at a stable on-screen position');
};

const openApp = async (page: Page) => {
  await page.goto(`${BASE}/app`);
  await page.locator('[data-testid="my-projects-list"]').waitFor({ state: 'attached', timeout: 20000 });
  await openDrawer(page);
  await expect(page.locator('[data-testid="my-projects-list"]')).toBeVisible({ timeout: 10000 });
  await settleDrawer(page);
};

/**
 * Pin / unpin through whichever tier of the project bar this width renders.
 *
 * The More menu is retried: the pin write refetches the project list, and a
 * trigger click that lands inside that re-render opens a menu whose content is
 * unmounted again a frame later. Retrying is a TEST timing concession, not a
 * product behaviour: nothing here waits for the app to correct itself on screen.
 */
const clickPin = async (page: Page) => {
  const full = page.locator('[data-testid="desktop-pin"]');
  if (await full.isVisible().catch(() => false)) {
    await full.click();
    return;
  }
  const trigger = page.locator('[data-testid="desktop-more"]');
  const item = page.locator('[data-testid="desktop-more-pin"]');
  await expect(trigger).toBeVisible({ timeout: 10000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await trigger.click();
    if (await item.isVisible({ timeout: 2000 }).catch(() => false)) {
      await item.click();
      return;
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(250);
  }
  throw new Error('the Pin action never appeared in the project bar More menu');
};

/** Select a project so the project bar's actions apply to it. */
const selectProject = async (page: Page, id: string, name: string) => {
  await row(page, id).click();
  await expect(page.locator('.lg-projbar').getByText(name, { exact: true }).first()).toBeVisible({
    timeout: 10000,
  });
};

// ---- desktop -----------------------------------------------------------------

test.describe('projects: manual order and pinning (hermetic)', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test('dragging a top-level row into the seam above another reorders it and writes sort_order', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3), projectRow(4)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    expect(await myProjectsOrder(page)).toEqual(['Order P1', 'Order P2', 'Order P3', 'Order P4']);

    // Aim at the top band of P1's block: the ghost's centre 5px below its top edge
    // is inside the 14px reorder band, so the drop is a seam, not a nest.
    const target = await blockOf(page, pid(1)).boundingBox();
    expect(target, "P1's block must have a box").toBeTruthy();
    await mouseDragTo(page, row(page, pid(3)), target!.x + target!.width / 2, target!.y + 5, {
      // The affordance the user actually reads: a 2px line in the seam the row
      // will land in, shown BEFORE the release, not after.
      beforeRelease: async () => {
        await expect(page.locator(`[data-testid="drop-line-before-${pid(1)}"]`)).toBeVisible();
        expect(await page.locator('[data-testid^="drop-line-"]').count()).toBe(1);
      },
    });

    await expect
      .poll(() => myProjectsOrder(page), { timeout: 10000 })
      .toEqual(['Order P3', 'Order P1', 'Order P2', 'Order P4']);

    // Renormalised, and ONLY the rows whose position actually changed are written.
    expect(sortOrderWrites(writes)).toEqual({ [pid(3)]: 0, [pid(1)]: 1, [pid(2)]: 2 });
    expect(projectPatches(writes)).toHaveLength(3);
    // The table itself now holds the new order, so a reload renders it.
    expect(rows.find((r) => r.id === pid(3))!.sort_order).toBe(0);

    await page.reload();
    await openDrawer(page);
    await settleDrawer(page);
    await expect
      .poll(() => myProjectsOrder(page), { timeout: 15000 })
      .toEqual(['Order P3', 'Order P1', 'Order P2', 'Order P4']);
  });

  test('a pinned block is not a seam target: no drop line, no reorder writes (skeptic fix)', async ({
    page,
    context,
  }) => {
    // O8 skeptic refutation 2 (2026-08-28): with P2 pinned, dragging P4 to the
    // edge band of the pinned block used to SHOW the drop line at the top of
    // the drawer while the drop landed mid-list and rewrote the pinned row's
    // own sort_order (reorderSiblings received sort-order space, not rendered
    // order). Now: pinned blocks are seam-ineligible - no line, and the edge
    // falls back to U2's whole-block NEST, exactly the pre-O8 gesture meaning.
    test.setTimeout(120_000);
    const rows = [
      projectRow(1, { sort_order: 0 }),
      projectRow(2, { sort_order: 1, pinned_at: new Date().toISOString() }),
      projectRow(3, { sort_order: 2 }),
      projectRow(4, { sort_order: 3 }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    expect(await pinnedOrder(page)).toEqual(['Order P2']);
    expect(await myProjectsOrder(page)).toEqual(['Order P1', 'Order P3', 'Order P4']);

    const target = await blockOf(page, pid(2)).boundingBox();
    expect(target, "the pinned P2 block must have a box").toBeTruthy();
    await mouseDragTo(page, row(page, pid(4)), target!.x + target!.width / 2, target!.y + 5, {
      beforeRelease: async () => {
        // The honest affordance: no drop line anywhere on a pinned block's edge.
        expect(await page.locator('[data-testid^="drop-line-"]').count()).toBe(0);
      },
    });

    // The edge of a pinned block means NEST (U2 semantics), never a reorder:
    // zero sort_order writes, the pinned row untouched, P4 now a sub of P2.
    await expect
      .poll(() => myProjectsOrder(page), { timeout: 10000 })
      .toEqual(['Order P1', 'Order P3']);
    expect(sortOrderWrites(writes)).toEqual({});
    expect(rows.find((r) => r.id === pid(2))!.sort_order).toBe(1);
    expect(rows.find((r) => r.id === pid(4))!.parent_project_id).toBe(pid(2));
  });

  test('the same gesture inside a parent reorders its sub-projects only', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [
      projectRow(1),
      projectRow(2),
      projectRow(5, { name: 'Order S1', parent_project_id: pid(1), sort_order: 0 }),
      projectRow(6, { name: 'Order S2', parent_project_id: pid(1), sort_order: 1 }),
      projectRow(7, { name: 'Order S3', parent_project_id: pid(1), sort_order: 2 }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    expect(await subOrder(page, pid(1))).toEqual(['Order S1', 'Order S2', 'Order S3']);

    // A sub row has no nest zone (nesting under a sub is illegal), so it splits in
    // half: anything above S1's midline means "before S1".
    const target = await page.locator(`[data-testid="tree-sub-${pid(5)}"]`).boundingBox();
    expect(target, "S1's row must have a box").toBeTruthy();
    await mouseDragTo(page, row(page, pid(7)), target!.x + target!.width / 2, target!.y + 6);

    await expect
      .poll(() => subOrder(page, pid(1)), { timeout: 10000 })
      .toEqual(['Order S3', 'Order S1', 'Order S2']);
    expect(sortOrderWrites(writes)).toEqual({ [pid(7)]: 0, [pid(5)]: 1, [pid(6)]: 2 });
    // The top level is untouched: reordering is per sibling group.
    expect(await myProjectsOrder(page)).toEqual(['Order P1', 'Order P2']);
    expect(rows.find((r) => r.id === pid(7))!.parent_project_id).toBe(pid(1));
  });

  test('Pin floats a project to the top, unpin returns it to its manual slot', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    expect(await page.locator('[data-testid="pinned-projects"]').count()).toBe(0);

    await selectProject(page, pid(2), 'Order P2');
    await clickPin(page);

    await expect.poll(() => pinnedOrder(page), { timeout: 10000 }).toEqual(['Order P2']);
    // It LEFT "My Projects": the block floated up whole rather than being copied.
    await expect.poll(() => myProjectsOrder(page)).toEqual(['Order P1', 'Order P3']);
    expect(rows.find((r) => r.id === pid(2))!.pinned_at).toBeTruthy();
    // The pin never touches the manual order.
    expect(sortOrderWrites(writes)).toEqual({});

    await clickPin(page);
    await expect.poll(() => pinnedOrder(page), { timeout: 10000 }).toEqual([]);
    // Back in its own slot, between P1 and P3, not appended at the end.
    await expect.poll(() => myProjectsOrder(page)).toEqual(['Order P1', 'Order P2', 'Order P3']);
    expect(rows.find((r) => r.id === pid(2))!.pinned_at).toBeNull();
  });

  test('the sixth pin is refused with the cap toast and writes nothing', async ({ page, context }) => {
    test.setTimeout(120_000);
    const pinnedAt = (n: number) => new Date(Date.UTC(2026, 1, n)).toISOString();
    const rows = [
      projectRow(1, { pinned_at: pinnedAt(1) }),
      projectRow(2, { pinned_at: pinnedAt(2) }),
      projectRow(3, { pinned_at: pinnedAt(3) }),
      projectRow(4, { pinned_at: pinnedAt(4) }),
      projectRow(5, { name: 'Order P5', pinned_at: pinnedAt(5) }),
      projectRow(6, { name: 'Order P6' }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    // Five pinned, in the order they were pinned; the sixth is all that is left.
    await expect
      .poll(() => pinnedOrder(page), { timeout: 10000 })
      .toEqual(['Order P1', 'Order P2', 'Order P3', 'Order P4', 'Order P5']);
    expect(await myProjectsOrder(page)).toEqual(['Order P6']);

    await selectProject(page, pid(6), 'Order P6');
    await clickPin(page);

    await expect(page.getByText('You can pin up to 5 projects')).toBeVisible({ timeout: 10000 });
    expect(projectPatches(writes)).toHaveLength(0);
    expect(rows.find((r) => r.id === pid(6))!.pinned_at).toBeNull();
    expect(await pinnedOrder(page)).toHaveLength(5);
  });

  // O11: the cap above is enforced before a WRITE (the click that would add a
  // 6th pin), but a row can still arrive already breached — the MCP
  // archive_project cascade used to leave pinned_at set on an archived row, so
  // pinning a 6th while it sat archived, then restoring it, landed 6 pinned
  // rows in the database at once. This seeds that breached STATE directly
  // (six rows, all pinned_at already set — the harness has no cheaper way to
  // land the app on an already-broken state than starting the GET there) and
  // proves the render-side clamp (splitPinnedTree in src/lib/projectTree.ts)
  // never shows more than PIN_LIMIT, whatever the data says.
  test('six already-pinned rows (a breached cap) still render as exactly 5 pinned, never "Pinned (6)"', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const pinnedAt = (n: number) => new Date(Date.UTC(2026, 1, n)).toISOString();
    const rows = [
      projectRow(1, { pinned_at: pinnedAt(1) }),
      projectRow(2, { pinned_at: pinnedAt(2) }),
      projectRow(3, { pinned_at: pinnedAt(3) }),
      projectRow(4, { pinned_at: pinnedAt(4) }),
      projectRow(5, { name: 'Order P5', pinned_at: pinnedAt(5) }),
      // The 6th pin — as if archive_project had left pinned_at set on an
      // archived row and a later restore brought it back still pinned.
      projectRow(6, { name: 'Order P6', pinned_at: pinnedAt(6) }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    // Exactly 5, the 5 OLDEST pins (P6 is the newest pinned_at, so it is the
    // one clamped out) — the heading (Pinned ({pinnedEntries.length})) renders
    // off this SAME array, so proving the array's length is 5 proves the
    // heading never reads "Pinned (6)".
    await expect
      .poll(() => pinnedOrder(page), { timeout: 10000 })
      .toEqual(['Order P1', 'Order P2', 'Order P3', 'Order P4', 'Order P5']);
    expect(await pinnedOrder(page)).toHaveLength(5);

    // The clamped-out 6th falls back to "My Projects" as if it had never been
    // pinned — not dropped, not stuck in limbo.
    expect(await myProjectsOrder(page)).toEqual(['Order P6']);

    // Nothing was written: this is a pure render-time clamp, not a "fix" that
    // silently rewrites pinned_at out from under the account.
    expect(projectPatches(writes)).toHaveLength(0);
    expect(rows.find((r) => r.id === pid(6))!.pinned_at).toBe(pinnedAt(6));
  });

  // O11 skeptic regression: a pinned SUB under a pinned PARENT must render as
  // ONE pinned entry (the parent block, sub nested inside it) - never as the
  // block PLUS a duplicate flat shortcut row, and the heading must count 1.
  // The first clamp rewrite scanned subs unconditionally and rendered
  // "Pinned (2)" with the sub twice; splitPinnedTree now skips the sub-scan
  // for a pinned parent, per its own docstring.
  test('a pinned sub under a pinned parent renders once, heading counts one', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const pinnedAt = (n: number) => new Date(Date.UTC(2026, 1, n)).toISOString();
    const rows = [
      projectRow(1, { pinned_at: pinnedAt(1) }),
      projectRow(2),
      projectRow(5, { name: 'Order S1', parent_project_id: pid(1), sort_order: 0, pinned_at: pinnedAt(2) }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    // Exactly ONE pinned entry: the parent block. The heading
    // (Pinned ({pinnedEntries.length})) renders off this same array.
    await expect.poll(() => pinnedOrder(page), { timeout: 10000 }).toEqual(['Order P1']);

    // The pinned sub gets NO flat shortcut row anywhere...
    expect(await page.locator(`[data-testid="pinned-row-${pid(5)}"]`).count()).toBe(0);
    // ...it rides nested inside its parent's block, exactly once.
    expect(await subOrder(page, pid(1))).toEqual(['Order S1']);
    expect(await page.locator(`[data-testid="select-project-${pid(5)}"]`).count()).toBe(1);

    expect(await myProjectsOrder(page)).toEqual(['Order P2']);
    // Pure render behaviour - nothing written.
    expect(projectPatches(writes)).toHaveLength(0);
  });

  test('a pinned sub-project shows in the Pinned group and stays in its parent tree', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const rows = [
      projectRow(1),
      projectRow(2),
      projectRow(5, { name: 'Order S1', parent_project_id: pid(1), sort_order: 0 }),
      projectRow(6, { name: 'Order S2', parent_project_id: pid(1), sort_order: 1 }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    await selectProject(page, pid(6), 'Order S2');
    await clickPin(page);

    // In the Pinned group as a flat shortcut row...
    await expect.poll(() => pinnedOrder(page), { timeout: 10000 }).toEqual(['Order S2']);
    await expect(page.locator(`[data-testid="pinned-row-${pid(6)}"]`)).toBeVisible();
    // ...AND still in its parent's tree, in its own slot.
    expect(await subOrder(page, pid(1))).toEqual(['Order S1', 'Order S2']);
    expect(await myProjectsOrder(page)).toEqual(['Order P1', 'Order P2']);
    expect(rows.find((r) => r.id === pid(6))!.parent_project_id).toBe(pid(1));
  });

  test('U2 still owns the middle of a block: nest, un-nest and the one-level refusal', async ({
    page,
    context,
  }) => {
    // The reorder bands are 14px at each edge; everything between them must behave
    // exactly as it did before O8, or this task broke the feature it builds on.
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    const middleOf = async (id: string) => {
      const box = await blockOf(page, id).boundingBox();
      expect(box, `block ${id} must have a box`).toBeTruthy();
      return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    };

    // (a) drop P2 on the MIDDLE of P1's block -> nested, exactly as in U2.
    let aim = await middleOf(pid(1));
    await mouseDragTo(page, row(page, pid(2)), aim.x, aim.y);
    await expect.poll(() => subOrder(page, pid(1)), { timeout: 10000 }).toEqual(['Order P2']);
    expect(rows.find((r) => r.id === pid(2))!.parent_project_id).toBe(pid(1));

    // (b) drag the sub onto the "My Projects" heading -> top level again.
    const header = await page.locator('[data-testid="projects-drop-top"]').boundingBox();
    expect(header, 'the My Projects heading must have a box').toBeTruthy();
    await mouseDragTo(page, row(page, pid(2)), header!.x + header!.width / 2, header!.y + header!.height / 2);
    await expect
      .poll(() => rows.find((r) => r.id === pid(2))!.parent_project_id, { timeout: 10000 })
      .toBeNull();

    // (c) a project that HAS sub-projects can never become one: re-nest P2 under
    // P1, then try to drop P1 onto P3.
    aim = await middleOf(pid(1));
    await mouseDragTo(page, row(page, pid(2)), aim.x, aim.y);
    await expect
      .poll(() => rows.find((r) => r.id === pid(2))!.parent_project_id, { timeout: 10000 })
      .toBe(pid(1));

    const before = projectPatches(writes).length;
    aim = await middleOf(pid(3));
    await mouseDragTo(page, row(page, pid(1)), aim.x, aim.y);
    await expect(page.getByText('Move its sub-projects first')).toBeVisible({ timeout: 10000 });
    expect(projectPatches(writes)).toHaveLength(before);
    expect(rows.find((r) => r.id === pid(1))!.parent_project_id).toBeNull();
  });

  test('an account that has never reordered renders exactly as it did before O8', async ({
    page,
    context,
  }) => {
    // sort_order null everywhere is what every existing account looks like the
    // moment the migration lands: the drawer must keep the loader's own
    // newest-first order, and a new project must NOT be stamped.
    test.setTimeout(120_000);
    const legacy = (n: number, ageDays: number, name: string): ProjectRow =>
      projectRow(n, {
        name,
        sort_order: null,
        created_at: new Date(Date.UTC(2026, 0, 30 - ageDays)).toISOString(),
      });
    const rows = [legacy(1, 3, 'Order Oldest'), legacy(2, 2, 'Order Middle'), legacy(3, 1, 'Order Newest')];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    expect(await myProjectsOrder(page)).toEqual(['Order Newest', 'Order Middle', 'Order Oldest']);

    await page.getByRole('button', { name: 'New Project' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New Project' });
    await dialog.getByPlaceholder('e.g., Website Redesign').fill('Order Fresh');
    await dialog.getByRole('button', { name: 'Create Project' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    const insert = writes.find((w) => w.method === 'POST' && w.url.includes('focusos_projects'));
    expect(insert, 'the create must have gone through').toBeTruthy();
    expect(Object.keys(insert!.body)).not.toContain('sort_order');
    // Newest first, exactly as before: the unordered group is untouched.
    await expect
      .poll(() => myProjectsOrder(page), { timeout: 10000 })
      .toEqual(['Order Fresh', 'Order Newest', 'Order Middle', 'Order Oldest']);
  });

  test('a new project appends to the END of a group that HAS been ordered by hand', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    await page.getByRole('button', { name: 'New Project' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New Project' });
    await dialog.getByPlaceholder('e.g., Website Redesign').fill('Order Fresh');
    await dialog.getByRole('button', { name: 'Create Project' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    const insert = writes.find((w) => w.method === 'POST' && w.url.includes('focusos_projects'));
    expect(insert!.body.sort_order).toBe(3);
    await expect
      .poll(() => myProjectsOrder(page), { timeout: 10000 })
      .toEqual(['Order P1', 'Order P2', 'Order P3', 'Order Fresh']);
  });

  test('Move to... offers the same order the drawer renders, and still moves', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [
      projectRow(1),
      projectRow(2, { pinned_at: new Date(Date.UTC(2026, 1, 2)).toISOString() }),
      projectRow(3),
      projectRow(4),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    await selectProject(page, pid(4), 'Order P4');
    const moveButton = page.locator('[data-testid="desktop-move"]');
    if (await moveButton.isVisible().catch(() => false)) {
      await moveButton.click();
    } else {
      await page.locator('[data-testid="desktop-more"]').click();
      await page.locator('[data-testid="desktop-more-move"]').click();
    }
    const sheet = page.locator('[data-testid="onebar-move-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 10000 });

    // Pinned first, then the manual order: the drawer's own sequence, minus the
    // project being moved.
    const targets = await sheet
      .locator('[data-testid^="onebar-move-to-"]')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
    expect(targets).toEqual(['Order P2', 'Order P1', 'Order P3']);

    // U2's move still works from here, untouched by O8.
    await sheet.locator(`[data-testid="onebar-move-to-${pid(1)}"]`).click();
    await expect
      .poll(() => rows.find((r) => r.id === pid(4))!.parent_project_id, { timeout: 10000 })
      .toBe(pid(1));
  });

  // O11: AddTaskDialog, EditTaskDialog and SettingsDialog used to receive the
  // raw, unordered `projects` state straight off the fetch, while the drawer
  // (and Move to..., proven above) rendered off `orderedProjects`
  // (sortProjectsForDisplay). This proves the Add Task project picker now
  // reads the SAME order the drawer does — pinned first, then manual
  // sort_order — instead of whatever order the rows arrived in.
  test('Add Task project picker follows the drawer order (pinned first, then manual sort_order)', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const rows = [
      projectRow(1, { sort_order: 2 }),
      projectRow(2, { sort_order: 0 }),
      projectRow(3, { sort_order: 1, pinned_at: new Date(Date.UTC(2026, 1, 1)).toISOString() }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    // Sanity: the drawer itself renders pinned-first, then the manual order.
    await expect.poll(() => pinnedOrder(page), { timeout: 10000 }).toEqual(['Order P3']);
    expect(await myProjectsOrder(page)).toEqual(['Order P2', 'Order P1']);

    // At this viewport (1280x900, isMobile false) the mobile one-bar's
    // "onebar-add" button is `lg:hidden` (a separate desktop "Add Task"
    // button lives in lg-row1, sharing the same "Add task" accessible name) —
    // getByRole only sees the one the accessibility tree exposes. AddTaskDialog
    // itself renders desktopDocked as a SidePanel, not a Radix Dialog, so scope
    // on the panel's own data attribute instead of role="dialog".
    await page.getByRole('button', { name: 'Add task' }).click();
    const panel = page.locator('[data-side-panel="true"]');
    await expect(panel.getByText('Create New Task')).toBeVisible({ timeout: 10000 });
    await panel.locator('#project').click();
    const options = await page.getByRole('listbox').getByRole('option').allTextContents();
    expect(options.map((t) => t.trim())).toEqual(['None', 'Order P3', 'Order P2', 'Order P1']);
  });

  // Same fixture, the Settings "Default Project/List View" picker (fed by
  // BottomNav -> SettingsDialog). Cheap to add alongside the Add Task case
  // above: same rows, same expected order, one more Select opened.
  test("Settings' default-view project picker follows the drawer order too", async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [
      projectRow(1, { sort_order: 2 }),
      projectRow(2, { sort_order: 0 }),
      projectRow(3, { sort_order: 1, pinned_at: new Date(Date.UTC(2026, 1, 1)).toISOString() }),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    await page.locator('[data-home-tour-step="settings"]').click();
    const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(settingsDialog).toBeVisible({ timeout: 10000 });
    await settingsDialog.locator('#default-view').click();
    const options = await page.getByRole('listbox').getByRole('option').allTextContents();
    // The first three options are the fixed Home / Today's To-Do / Unassigned
    // entries, not projects — only the tail is under test here.
    expect(options.slice(3).map((t) => t.trim())).toEqual(['Order P3', 'Order P2', 'Order P1']);
  });
});

// ---- phone -------------------------------------------------------------------

test.describe('projects: manual order on a phone (hermetic)', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('a long-press drag reorders the drawer at 393x852', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await openApp(page);

    expect(await myProjectsOrder(page)).toEqual(['Order P1', 'Order P2', 'Order P3']);

    const target = await blockOf(page, pid(1)).boundingBox();
    expect(target, "P1's block must have a box").toBeTruthy();
    await touchDragTo(page, row(page, pid(3)), target!.x + target!.width / 2, target!.y + 5);

    await expect
      .poll(() => myProjectsOrder(page), { timeout: 10000 })
      .toEqual(['Order P3', 'Order P1', 'Order P2']);
    expect(sortOrderWrites(writes)).toEqual({ [pid(3)]: 0, [pid(1)]: 1, [pid(2)]: 2 });
    // The drawer is still open: the long-press drag must not be read as the
    // panel's own grab-and-throw gesture.
    await expect(page.getByLabel('Projects')).toHaveAttribute('data-state', 'open');
  });
});

// ---- live persistence (post-migration) --------------------------------------
//
// SKIPPED until supabase/migrations/20260826141431_add_project_sort_pin.sql is
// applied: a select naming sort_order answers 400 while the column is missing.
// Once it is live this is the half the hermetic tests above cannot prove: that
// the value really lands in Postgres and survives a reload.

// Same demo account and publishable key the other project specs use
// (src/integrations/supabase/client.ts). Only the live block below touches them.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

const restHeaders = (token: string, extra: Record<string, string> = {}) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...extra,
});

test.describe('live persistence (post-migration)', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test('sort_order written by a drag survives a reload against the real backend', async ({ page, request }) => {
    test.setTimeout(240_000);

    const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
    expect(auth.ok(), 'REST sign-in as the demo account must succeed').toBeTruthy();
    const body = await auth.json();
    const token: string = body.access_token;
    const userId: string = body.user.id;

    const probe = await request.get(`${SUPABASE_URL}/rest/v1/focusos_projects?select=sort_order&limit=1`, {
      headers: restHeaders(token),
    });
    test.skip(
      probe.status() === 400,
      'focusos_projects.sort_order does not exist yet: apply 20260826141431_add_project_sort_pin.sql first',
    );
    expect(probe.ok(), `probe select must succeed (${probe.status()})`).toBeTruthy();

    const stamp = Date.now();
    const names = [`zz-o8-A ${stamp}`, `zz-o8-B ${stamp}`];
    const created: string[] = [];
    const problems: string[] = [];

    try {
      for (let i = 0; i < names.length; i += 1) {
        const res = await request.post(`${SUPABASE_URL}/rest/v1/focusos_projects`, {
          headers: restHeaders(token, { Prefer: 'return=representation' }),
          data: { name: names[i], color: '#3b82f6', user_id: userId, sort_order: i },
        });
        expect(res.ok(), `creating ${names[i]} must succeed (${res.status()})`).toBeTruthy();
        const rowsCreated = await res.json();
        created.push(rowsCreated[0].id);
      }

      await page.goto(`${BASE}/auth`);
      const panel = page.getByRole('tabpanel');
      await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
      await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
      await panel.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL('**/home', { timeout: 20000 });
      await page.goto(`${BASE}/app`);
      await openDrawer(page);
      await expect(row(page, created[0])).toBeVisible({ timeout: 20000 });

      // Drag B above A, then read the DATABASE, not the DOM.
      const target = await blockOf(page, created[0]).boundingBox();
      expect(target, 'the first project block must have a box').toBeTruthy();
      await mouseDragTo(page, row(page, created[1]), target!.x + target!.width / 2, target!.y + 5);

      await expect
        .poll(
          async () => {
            const res = await request.get(
              `${SUPABASE_URL}/rest/v1/focusos_projects?id=eq.${created[1]}&select=sort_order`,
              { headers: restHeaders(token) },
            );
            const readBack = await res.json();
            return readBack[0]?.sort_order ?? null;
          },
          { timeout: 20000 },
        )
        .toBe(0);

      await page.reload();
      await openDrawer(page);
      await expect
        .poll(
          async () => {
            const order = await myProjectsOrder(page);
            return order.filter((n) => n.startsWith('zz-o8-'));
          },
          { timeout: 20000 },
        )
        .toEqual([names[1], names[0]]);
    } finally {
      for (const id of created) {
        const res = await request.delete(`${SUPABASE_URL}/rest/v1/focusos_projects?id=eq.${id}`, {
          headers: restHeaders(token, { Prefer: 'return=representation' }),
        });
        if (!res.ok()) {
          problems.push(`focusos_projects ${id}: HTTP ${res.status()}`);
          continue;
        }
        const deleted = await res.json();
        if (deleted.length !== 1) problems.push(`focusos_projects ${id}: delete removed ${deleted.length} rows`);
      }
      const left = await request.get(
        `${SUPABASE_URL}/rest/v1/focusos_projects?select=id,name&name=like.*${encodeURIComponent(String(stamp))}*`,
        { headers: restHeaders(token) },
      );
      const leftRows = await left.json();
      if (Array.isArray(leftRows) && leftRows.length) {
        problems.push(`projects left behind: ${leftRows.map((p: any) => p.name).join(', ')}`);
      }

      // O8 skeptic fix (2026-08-28): the drag above renormalised the WHOLE
      // top-level sibling group, stamping sort_order onto the demo account's
      // REAL projects - deleting the zz rows alone leaves the shared fixture
      // permanently "hand-ordered" (and, with two real rows sharing a
      // created_at, freezes their tie-break nondeterministically). Restore
      // every remaining row to the pristine null/null baseline and ASSERT it.
      const restore = await request.patch(
        `${SUPABASE_URL}/rest/v1/focusos_projects?or=(sort_order.not.is.null,pinned_at.not.is.null)`,
        {
          headers: restHeaders(token, { Prefer: 'return=representation' }),
          data: { sort_order: null, pinned_at: null },
        },
      );
      if (!restore.ok()) problems.push(`restore PATCH failed: HTTP ${restore.status()}`);
      const finalState = await request.get(
        `${SUPABASE_URL}/rest/v1/focusos_projects?select=id,name,sort_order,pinned_at`,
        { headers: restHeaders(token) },
      );
      const finalRows = await finalState.json();
      const dirty = (Array.isArray(finalRows) ? finalRows : []).filter(
        (p: any) => p.sort_order !== null || p.pinned_at !== null,
      );
      if (dirty.length) {
        problems.push(`rows still ordered/pinned after restore: ${dirty.map((p: any) => p.name).join(', ')}`);
      }
    }

    expect(problems, 'the demo account must end exactly as it started, all sort_order/pinned_at null').toEqual([]);
  });
});
