// Desktop project bar: the Pin action must always be REACHABLE (G1, 2026-09-02).
//
// Igor's report: on his DESKTOP, with a mouse, he selected the SUB-project
// "AIS / Term 1 Plan" and the project action bar showed Invite, Move Tasks,
// Meetings, Share, Move to..., Archive, Delete — no Pin button and no ⋯ More
// menu to hold it. A smoke run on a TOP-LEVEL project at 1512px showed
// desktop-pin visible, so the defect is sub-project / width / state specific.
//
// The invariant this file guards is deliberately weaker than "Pin is visible":
// O9 folds actions into a More menu as width runs out, and that is correct
// behaviour. What is NEVER correct is Pin being reachable through NEITHER tier.
// So every case asserts: desktop-pin is in the row, OR desktop-more exists and
// its menu lists desktop-more-pin.
//
// SELF-CONTAINED ON PURPOSE: the hermetic helpers (seedSession,
// installIntercepts, openApp, the project-row factory) are copied from
// tests/project-order.spec.ts rather than imported, so this one file can be
// dropped unchanged into an older worktree during a bisect.
//
// Run: PW_PORT=8091 npx playwright test tests/desktop-pin.spec.ts --project=desktop-mouse
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

test.use({ actionTimeout: 15000 });

const BASE = process.env.WAVE_BASE_URL ?? '';

const PROJECT_REF = 'mshlbsgsyzzfxyxramjj';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'desktop.pin.probe@example.test';

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

interface Write { method: string; url: string; body: any }

const pid = (n: number) => `2222222${n}-2222-4222-8222-22222222222${n}`;

const projectRow = (n: number, over: Partial<ProjectRow> = {}): ProjectRow => ({
  id: pid(n),
  name: `Pin P${n}`,
  color: '#3b82f6',
  is_shared: false,
  user_id: USER_ID,
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

async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ ref, userId, email }) => {
      const b64 = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
        sub: userId, email, aud: 'authenticated', role: 'authenticated', exp: expiresAt,
      })}.probe-signature`;
      const user = {
        id: userId, aud: 'authenticated', role: 'authenticated', email,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {}, created_at: new Date(0).toISOString(),
      };
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        access_token: jwt, refresh_token: 'probe-refresh-token', token_type: 'bearer',
        expires_in: 3600, expires_at: expiresAt, user,
      }));
    },
    { ref: PROJECT_REF, userId: USER_ID, email: USER_EMAIL },
  );
}

/** Every PostgREST call answered from `rows`; PATCHes echo the FULL row. */
async function installIntercepts(
  context: BrowserContext,
  rows: ProjectRow[],
  writes: Write[],
  memberRows: any[] = [],
): Promise<void> {
  await context.route('**/auth/v1/**', (route) => {
    const user = {
      id: USER_ID, aud: 'authenticated', role: 'authenticated', email: USER_EMAIL,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}, created_at: new Date(0).toISOString(),
    };
    if (route.request().url().includes('/auth/v1/user')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'probe-refreshed', refresh_token: 'probe-refresh-token', token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
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
        const inserted: ProjectRow = {
          id: `33333333-3333-4333-8333-${String(rows.length).padStart(12, '0')}`,
          color: '#3b82f6', is_shared: false, user_id: USER_ID,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          archived_at: null, parent_project_id: null, sort_order: null, pinned_at: null,
          ...(Array.isArray(payload) ? payload[0] : payload),
        } as ProjectRow;
        rows.push(inserted);
        return reply(wantsObject ? inserted : [inserted]);
      }
      if (url.includes('focusos_projects')) {
        const idMatch = /id=eq\.([0-9a-f-]+)/.exec(url);
        const orMatch = /or=\(id\.eq\.([0-9a-f-]+),parent_project_id\.eq\.([0-9a-f-]+)\)/.exec(url);
        const touched = rows.filter((r) =>
          orMatch ? r.id === orMatch[1] || r.parent_project_id === orMatch[2]
            : idMatch ? r.id === idMatch[1] : false);
        for (const target of touched) Object.assign(target, payload);
        return reply(wantsObject ? (touched[0] ?? null) : touched.map((r) => ({ ...r })));
      }
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
      return reply(wantsObject ? {} : []);
    }

    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_projects')) return reply(rows.map((r) => ({ ...r })));
    if (url.includes('focusos_project_members')) return reply(memberRows.map((r) => ({ ...r })));
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

// ---- app boot ----------------------------------------------------------------

const row = (page: Page, id: string) => page.locator(`[data-testid="select-project-${id}"]`);

const openDrawer = async (page: Page) => {
  const drawer = page.getByLabel('Projects');
  if ((await drawer.count()) === 0) return;
  if ((await drawer.getAttribute('data-state').catch(() => null)) === 'open') return;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(drawer).toHaveAttribute('data-state', 'open', { timeout: 5000 });
};

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

/** Select a project row, expanding its parent's subtree first when needed. */
const selectProject = async (page: Page, id: string, parentId?: string) => {
  if (parentId && !(await row(page, id).isVisible().catch(() => false))) {
    const toggle = page.locator(`[data-testid="tree-toggle-${parentId}"]`);
    if (await toggle.isVisible().catch(() => false)) {
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    }
  }
  await expect(row(page, id)).toBeVisible({ timeout: 10000 });
  await row(page, id).click();
  await expect(page.locator('.lg-projbar')).toBeVisible({ timeout: 10000 });
};

/** Labels of the ACTION buttons currently in the row (never the hidden measurer). */
const rowActionLabels = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const cluster = document.querySelector('.lg-projbar > div > div:last-child');
    if (!cluster) return [];
    return Array.from(cluster.querySelectorAll('button'))
      .filter((b) => !b.closest('[aria-hidden="true"]'))
      .map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim())
      .filter(Boolean);
  });

/** Labels the More menu is currently offering (empty when there is no trigger). */
const moreMenuLabels = async (page: Page): Promise<string[]> => {
  const trigger = page.locator('[data-testid="desktop-more"]');
  if (!(await trigger.isVisible().catch(() => false))) return [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await trigger.click();
    const items = page.locator('[data-testid^="desktop-more-"]');
    if (await items.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      const labels = await items.allTextContents();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(150);
      return labels.map((l) => l.trim()).filter(Boolean);
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(250);
  }
  throw new Error('the More trigger is up but its menu never rendered any item');
};

/**
 * THE INVARIANT, and it is deliberately wider than "Pin is visible".
 *
 * O9 folds actions into the More menu as width runs out, and that is correct.
 * What is never correct is an action being reachable through NEITHER tier — the
 * exact shape of Igor's report (Pin in no row and no menu, while its siblings
 * Move to... and Archive were both still in the row). So every case asserts the
 * whole action set, not just Pin: row ∪ menu must cover everything the project's
 * shape offers.
 */
const expectEveryActionReachable = async (
  page: Page,
  where: string,
  opts: { topLevel: boolean },
) => {
  await page.waitForTimeout(400); // let the fold layout effect settle
  const expected = [
    'Move Tasks',
    'Meetings',
    'Share',
    ...(opts.topLevel ? ['New sub-project'] : []),
    'Pin',
    'Move to...',
    'Archive',
    'Delete',
  ];
  const rowLabels = await rowActionLabels(page);
  const menuLabels = await moreMenuLabels(page);
  const reachable = [...rowLabels, ...menuLabels];
  const missing = expected.filter((label) => !reachable.some((r) => r === label || r.startsWith(label)));
  expect(
    missing,
    `${where}: these actions are reachable through NEITHER the row nor the More menu. Row: [${rowLabels.join(' | ')}] Menu: [${menuLabels.join(' | ')}]`,
  ).toEqual([]);
  return (await page.locator('[data-testid="desktop-pin"]').isVisible().catch(() => false)) ? 'row' : 'menu';
};

/** Pin-focused wrapper, kept so every case reads as the lane-A guard it is. */
const expectPinReachable = async (page: Page, where: string, topLevel = false) => {
  const tier = await expectEveryActionReachable(page, where, { topLevel });
  if (tier === 'menu') {
    await expect(page.locator('[data-testid="desktop-more"]'), `${where}: no More menu to hold Pin`)
      .toBeVisible({ timeout: 5000 });
  }
  return tier;
};

// ---- the fixture: one top-level project with one sub ------------------------

const seedTree = (): ProjectRow[] => [
  projectRow(1, { name: 'AIS' }),
  projectRow(2, { name: 'Term 1 Plan', parent_project_id: pid(1), sort_order: 0 }),
  projectRow(3, { name: 'Trading' }),
];

const memberSeed = [
  {
    id: '44444444-4444-4444-8444-444444444441',
    user_id: '00000000-0000-0000-0000-000000000000',
    invited_email: 'colleague@example.test',
    role: 'editor',
    status: 'pending',
    project_id: pid(2),
  },
];

test.describe('desktop project bar: Pin is always reachable', () => {
  test('(a) top-level project at 1512x982', async ({ page, context }) => {
    const rows = seedTree();
    await installIntercepts(context, rows, []);
    await seedSession(page);
    await page.setViewportSize({ width: 1512, height: 982 });
    await openApp(page);
    await selectProject(page, pid(1));
    const tier = await expectPinReachable(page, 'top-level @1512', true);
    console.log(`[desktop-pin] top-level @1512 -> ${tier}`);
  });

  test('(b) SUB-project at 1512x982', async ({ page, context }) => {
    const rows = seedTree();
    await installIntercepts(context, rows, []);
    await seedSession(page);
    await page.setViewportSize({ width: 1512, height: 982 });
    await openApp(page);
    await selectProject(page, pid(2), pid(1));
    await expect(page.locator('[data-testid="desktop-parent-name"]')).toBeVisible({ timeout: 5000 });
    const tier = await expectPinReachable(page, 'sub-project @1512');
    console.log(`[desktop-pin] sub-project @1512 -> ${tier}`);
  });

  test('(b2) SUB-project with a pending member (Invite chrome present) at 1512x982', async ({ page, context }) => {
    const rows = seedTree();
    await installIntercepts(context, rows, [], memberSeed);
    await seedSession(page);
    await page.setViewportSize({ width: 1512, height: 982 });
    await openApp(page);
    await selectProject(page, pid(2), pid(1));
    const tier = await expectPinReachable(page, 'sub-project + members @1512');
    console.log(`[desktop-pin] sub-project + members @1512 -> ${tier}`);
  });

  for (const width of [1180, 1024]) {
    test(`(c) top-level at ${width}x900`, async ({ page, context }) => {
      const rows = seedTree();
      await installIntercepts(context, rows, []);
      await seedSession(page);
      await page.setViewportSize({ width: 1512, height: 982 });
      await openApp(page);
      await selectProject(page, pid(1));
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(600);
      const tier = await expectPinReachable(page, `top-level @${width}`, true);
      console.log(`[desktop-pin] top-level @${width} -> ${tier}`);
    });

    test(`(c) SUB-project at ${width}x900`, async ({ page, context }) => {
      const rows = seedTree();
      await installIntercepts(context, rows, []);
      await seedSession(page);
      await page.setViewportSize({ width: 1512, height: 982 });
      await openApp(page);
      await selectProject(page, pid(2), pid(1));
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(600);
      const tier = await expectPinReachable(page, `sub-project @${width}`);
      console.log(`[desktop-pin] sub-project @${width} -> ${tier}`);
    });
  }

  // ---- Igor's own shape: a SWITCH into the sub, a wide name group, resizes ----
  //
  // Igor did not land on the sub-project from a cold load: he was already in the
  // app and CLICKED it. That is the path where `foldCount` (state) carries over
  // from the previous project and the layout effect has to re-derive it, so it
  // gets its own cases in both directions.

  test('(d) switch top-level -> SUB keeps Pin reachable', async ({ page, context }) => {
    const rows = seedTree();
    await installIntercepts(context, rows, []);
    await seedSession(page);
    await page.setViewportSize({ width: 1512, height: 982 });
    await openApp(page);
    await selectProject(page, pid(1));
    await expectPinReachable(page, 'switch: top-level first', true);
    await selectProject(page, pid(2), pid(1));
    const tier = await expectPinReachable(page, 'switch: top-level -> sub @1512');
    console.log(`[desktop-pin] switch top-level -> sub @1512 -> ${tier}`);
  });

  test('(e) switch SUB -> top-level keeps Pin reachable', async ({ page, context }) => {
    const rows = seedTree();
    await installIntercepts(context, rows, []);
    await seedSession(page);
    await page.setViewportSize({ width: 1512, height: 982 });
    await openApp(page);
    await selectProject(page, pid(2), pid(1));
    await expectPinReachable(page, 'switch: sub first');
    await selectProject(page, pid(3));
    const tier = await expectPinReachable(page, 'switch: sub -> top-level @1512', true);
    console.log(`[desktop-pin] switch sub -> top-level @1512 -> ${tier}`);
  });

  // A name group as fat as Igor's real one: long breadcrumb + long name + a
  // members bar with real avatars. Every one of those is shrink-0 inside the
  // flex-1 name group, so they eat the width the action cluster needs.
  const wideTree = (): ProjectRow[] => [
    projectRow(1, { name: 'AIS Whole School Improvement Programme' }),
    projectRow(2, {
      name: 'Term 1 Plan for Teaching, Learning and Assessment',
      parent_project_id: pid(1),
      sort_order: 0,
    }),
  ];
  const fatMembers = [1, 2, 3, 4].map((n) => ({
    id: `44444444-4444-4444-8444-44444444444${n}`,
    user_id: `66666666-6666-4666-8666-66666666666${n}`,
    invited_email: `teacher${n}@ais.ae`,
    role: 'editor',
    status: 'accepted',
    project_id: pid(2),
  }));

  for (const width of [1512, 1400, 1280, 1180, 1100, 1024]) {
    test(`(f) fat sub-project name group @${width}`, async ({ page, context }) => {
      await installIntercepts(context, wideTree(), [], fatMembers);
      await seedSession(page);
      await page.setViewportSize({ width: 1512, height: 982 });
      await openApp(page);
      await selectProject(page, pid(2), pid(1));
      if (width !== 1512) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(600);
      }
      const tier = await expectPinReachable(page, `fat sub @${width}`);
      console.log(`[desktop-pin] fat sub @${width} -> ${tier}`);
    });
  }

  test('(g) resize down then back up keeps Pin reachable', async ({ page, context }) => {
    await installIntercepts(context, wideTree(), [], fatMembers);
    await seedSession(page);
    await page.setViewportSize({ width: 1512, height: 982 });
    await openApp(page);
    await selectProject(page, pid(2), pid(1));
    for (const w of [1024, 1512, 1180, 1512]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(500);
      await expectPinReachable(page, `resize walk @${w}`);
    }
    console.log('[desktop-pin] resize walk clean');
  });
});
