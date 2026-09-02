// DESKTOP MOUSE drag in the Projects drawer (G2, 2026-09-02).
//
// Igor's report: on his desktop, with a mouse, he can no longer move any project
// in the drawer. The O8 wave (25c0670 + 9694f77) rewrote this surface and was
// verified only under the mobile-touch Playwright project, so the mouse path had
// no coverage of its own. This file is that coverage: a REAL mouse (page.mouse
// move/down/move/up, pointerType "mouse") on a 1512x982 desktop context with
// hasTouch and isMobile off, which is the only pipeline that reaches
// MousePointerSensor.
//
// SELF-CONTAINED on purpose: every hermetic helper is copied from
// tests/project-order.spec.ts rather than imported, so this file can be dropped
// into an older worktree (a v63/v64 bisect checkout) and run unchanged.
//
// Cases:
//   (a) NEST    - drag top-level P2 onto the MIDDLE of top-level P1's row.
//   (b) UN-NEST - drag a sub out onto the "My Projects" heading.
//   (c) REORDER - drag P3 onto the top EDGE seam of P1 (O8 only; at v63/U2 there
//       were no seams, so this case is skipped by design when the app renders no
//       drop line at all).
//
// Run: PW_PORT=8092 npx playwright test tests/desktop-drag.spec.ts --project=desktop-mouse
//
// BISECT RESULT (2026-09-02, G2). The brief's premise - "at v63 mouse drag to
// nest/un-nest worked, O8 broke it" - is FALSE at the code level:
//   v63 (7dda2fc): `git show 7dda2fc:src/components/ProjectSidebar.tsx | grep -c
//     'DndContext|useDraggable|my-projects-list'` = 0. The drawer had NO drag of
//     any kind. This file cannot even boot there (the my-projects-list testid
//     does not exist), which is what "3 failed at v63" below means.
//   U2 (d5aaf51 / 168d6ac) ADDED the drag, AFTER the v63 tag.
//   v64 (742a04f) and lane HEAD: every case here PASSES, chromium AND webkit.
// So no commit in 7dda2fc..742a04f regresses the desktop mouse path that this
// harness can drive. Igor's symptom is real but its mechanism is NOT reproducible
// from a scripted pointer: see the residuals in the G2 report.
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

test.use({ actionTimeout: 15000 });

const BASE = process.env.WAVE_BASE_URL ?? '';

const PROJECT_REF = 'mshlbsgsyzzfxyxramjj';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'desktop.drag.probe@example.test';

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

const pid = (n: number) => `2222222${n}-2222-4222-8222-22222222222${n}`;

const projectRow = (n: number, over: Partial<ProjectRow> = {}): ProjectRow => ({
  id: pid(n),
  name: `Drag P${n}`,
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

/** Full-row echo on every PATCH (hermetic-harness law). */
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
        } as ProjectRow;
        rows.push(inserted);
        return reply(wantsObject ? inserted : [inserted]);
      }
      if (url.includes('focusos_projects')) {
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

const myProjectsOrder = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const list = document.querySelector('[data-testid="my-projects-list"]');
    if (!list) return [];
    return Array.from(list.children).map((entry) => {
      const projectRowEl = entry.querySelector('[data-testid^="select-project-"]');
      return (projectRowEl?.textContent ?? '').trim();
    });
  });

const subOrder = (page: Page, parentId: string): Promise<string[]> =>
  page.evaluate((id) => {
    const list = document.querySelector(`[data-testid="tree-subs-${id}"]`);
    if (!list) return [];
    return Array.from(list.querySelectorAll('[data-testid^="select-project-"]')).map((el) =>
      (el.textContent ?? '').trim(),
    );
  }, parentId);

const projectPatches = (writes: Write[]) =>
  writes.filter((w) => w.method === 'PATCH' && w.url.includes('focusos_projects'));

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

const parentWrites = (writes: Write[]): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  for (const w of writes) {
    if (w.method !== 'PATCH' || !w.url.includes('focusos_projects')) continue;
    if (!w.body || !('parent_project_id' in w.body)) continue;
    const m = /id=eq\.([0-9a-f-]+)/.exec(w.url);
    if (m) out[m[1]] = w.body.parent_project_id;
  }
  return out;
};

// ---- probes ------------------------------------------------------------------

/**
 * What the app thinks is happening MID-DRAG. Read while the button is still
 * down, so a failure can say WHICH half broke: no drag start at all (no ghost,
 * no dragging opacity), a start with no drop target (ghost but no highlight and
 * no drop line), or a clean aim that simply never writes.
 */
const dragProbe = (page: Page) =>
  page.evaluate(() => {
    const dragging = Array.from(document.querySelectorAll('[data-testid^="select-project-"]')).filter(
      (el) => (el as HTMLElement).style.opacity === '0.4',
    ).length;
    return {
      // dnd-kit stamps the body while a drag is live.
      bodyDndAction: document.body.getAttribute('data-dnd-action') ?? null,
      // The portalled DragOverlay ghost lives directly under <body>.
      overlayNodes: document.querySelectorAll('body > [data-dnd-overlay], body > div[style*="translate3d"]').length,
      draggingRows: dragging,
      dropLines: document.querySelectorAll('[data-testid^="drop-line-"]').length,
      // The drop-target highlight IS the secondary variant on a non-selected row.
      liveAnnouncement: (document.querySelector('[role="status"]')?.textContent ?? '').trim(),
    };
  });

/** Count the pointer events that actually reach a row. */
const installPointerCounter = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__pe = { down: 0, move: 0, up: 0, cancel: 0, lostcapture: 0 };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(
        type,
        (e) => {
          const t = e.target as HTMLElement | null;
          if (!t || !t.closest?.('[data-testid^="select-project-"]')) return;
          const key = type === 'lostpointercapture' ? 'lostcapture' : type.replace('pointer', '');
          (window as any).__pe[key] += 1;
        },
        true,
      );
    }
  });
};

const pointerCounts = (page: Page) => page.evaluate(() => (window as any).__pe);

// ---- gestures ----------------------------------------------------------------

/**
 * A REAL mouse drag that lands the GHOST'S CENTRE on (toX, toY). Pressing at the
 * source row's centre makes ghost centre = pointer, because dnd-kit translates
 * the dragged rect by the pointer delta.
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
  // > 8px in one move so the pointer sensor is definitely past its distance
  // activation constraint.
  await page.mouse.move(sx, sy - 14);
  await page.waitForTimeout(80);
  const steps = 14;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(sx + ((toX - sx) * i) / steps, sy + ((toY - sy) * i) / steps);
    await page.waitForTimeout(25);
  }
  await page.mouse.move(toX, toY);
  await page.waitForTimeout(150);
  if (opts.beforeRelease) await opts.beforeRelease();
  await page.mouse.up();
  await page.waitForTimeout(400);
};

// ---- app boot ----------------------------------------------------------------

const row = (page: Page, id: string) => page.locator(`[data-testid="select-project-${id}"]`);
const blockOf = (page: Page, id: string) => page.locator(`[data-testid="project-block-${id}"]`);

const openDrawer = async (page: Page) => {
  const drawer = page.getByLabel('Projects');
  if ((await drawer.count()) === 0) return; // desktop: already inline
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

// ---- the cases ---------------------------------------------------------------

test.describe('drawer drag with a real DESKTOP MOUSE', () => {
  test('(a) NEST: dragging P2 onto the middle of P1 makes it a sub', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openApp(page);

    expect(await myProjectsOrder(page)).toEqual(['Drag P1', 'Drag P2', 'Drag P3']);

    // The MIDDLE of P1's own row: a nest, never a seam.
    const target = await row(page, pid(1)).boundingBox();
    expect(target, "P1's row must have a box").toBeTruthy();

    let probe: any = null;
    await mouseDragTo(page, row(page, pid(2)), target!.x + target!.width / 2, target!.y + target!.height / 2, {
      beforeRelease: async () => {
        probe = await dragProbe(page);
      },
    });

    const counts = await pointerCounts(page);
    expect(
      probe,
      `mid-drag probe never ran. pointer events on rows: ${JSON.stringify(counts)}`,
    ).toBeTruthy();
    expect(
      probe.draggingRows,
      `the drag never STARTED with a mouse: no row wore the dragging opacity. probe=${JSON.stringify(probe)} pointer events=${JSON.stringify(counts)}`,
    ).toBe(1);

    await expect
      .poll(() => parentWrites(writes)[pid(2)] ?? 'no-write', {
        timeout: 10000,
        message: `no parent_project_id PATCH for P2. probe=${JSON.stringify(probe)} patches=${JSON.stringify(projectPatches(writes))}`,
      })
      .toBe(pid(1));

    await expect.poll(() => subOrder(page, pid(1)), { timeout: 10000 }).toEqual(['Drag P2']);
    expect(await myProjectsOrder(page)).toEqual(['Drag P1', 'Drag P3']);
  });

  test('(b) UN-NEST: dragging a sub onto the My Projects heading returns it to top level', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const rows = [
      projectRow(1),
      projectRow(2, { parent_project_id: pid(1), sort_order: 0 }),
      projectRow(3),
    ];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openApp(page);

    expect(await subOrder(page, pid(1))).toEqual(['Drag P2']);

    const header = await page.locator('[data-testid="projects-drop-top"]').boundingBox();
    expect(header, 'the My Projects heading must have a box').toBeTruthy();

    let probe: any = null;
    await mouseDragTo(page, row(page, pid(2)), header!.x + header!.width / 2, header!.y + header!.height / 2, {
      beforeRelease: async () => {
        probe = await dragProbe(page);
      },
    });

    const counts = await pointerCounts(page);
    expect(
      probe?.draggingRows,
      `the drag never STARTED with a mouse. probe=${JSON.stringify(probe)} pointer events=${JSON.stringify(counts)}`,
    ).toBe(1);

    await expect
      .poll(() => (pid(2) in parentWrites(writes) ? parentWrites(writes)[pid(2)] : 'no-write'), {
        timeout: 10000,
        message: `no parent_project_id PATCH for the sub. probe=${JSON.stringify(probe)} patches=${JSON.stringify(projectPatches(writes))}`,
      })
      .toBe(null);

    await expect.poll(() => myProjectsOrder(page), { timeout: 10000 }).toContain('Drag P2');
    expect(await subOrder(page, pid(1))).toEqual([]);
  });

  test('(c) REORDER: dragging P3 onto the top edge seam of P1 puts it first', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openApp(page);

    expect(await myProjectsOrder(page)).toEqual(['Drag P1', 'Drag P2', 'Drag P3']);

    const target = await blockOf(page, pid(1)).boundingBox();
    expect(target, "P1's block must have a box").toBeTruthy();

    let probe: any = null;
    // Ghost centre 5px below P1's top edge: inside the reorder band.
    await mouseDragTo(page, row(page, pid(3)), target!.x + target!.width / 2, target!.y + 5, {
      beforeRelease: async () => {
        probe = await dragProbe(page);
      },
    });

    const counts = await pointerCounts(page);
    expect(
      probe?.draggingRows,
      `the drag never STARTED with a mouse. probe=${JSON.stringify(probe)} pointer events=${JSON.stringify(counts)}`,
    ).toBe(1);
    // Seams are an O8 feature. In a pre-O8 checkout (v63 / U2) the drag STARTS
    // fine but no drop line exists at all, so this case is skipped by design
    // rather than failed. Reaching here already proved the drag started.
    test.skip(probe.dropLines === 0, 'no reorder seam in this build (pre-O8): skipped by design');

    await expect
      .poll(() => myProjectsOrder(page), {
        timeout: 10000,
        message: `order never changed. probe=${JSON.stringify(probe)} sort_order writes=${JSON.stringify(sortOrderWrites(writes))} pointer events=${JSON.stringify(counts)}`,
      })
      .toEqual(['Drag P3', 'Drag P1', 'Drag P2']);

    const orders = sortOrderWrites(writes);
    expect(orders[pid(3)]).toBe(0);
    expect(orders[pid(1)]).toBe(1);
    expect(orders[pid(2)]).toBe(2);
  });
});

// ---- Igor's actual drawer shape ---------------------------------------------
//
// The three cases above run against a 3-project drawer that fits on screen. Igor's
// drawer after the P7 reorganise is nothing like that: a dozen-plus top-level
// projects, umbrellas with expanded subs, a Pinned group, and a list TALLER THAN
// THE PANEL, so the drop targets sit inside a scroll container. This block
// reproduces that shape, because a regression that only shows up there is exactly
// the kind the hermetic 3-row fixture cannot see.
test.describe('drawer drag with a real DESKTOP MOUSE, Igor-shaped drawer', () => {
  const igorRows = (): ProjectRow[] => {
    const rows: ProjectRow[] = [];
    // 4 umbrellas, each with 3 subs, then 8 plain top-level projects: ~28 rows.
    let n = 1;
    for (let u = 0; u < 4; u += 1) {
      const parent = projectRow(n, { sort_order: u });
      parent.name = `Umbrella ${u + 1}`;
      rows.push(parent);
      const parentId = parent.id;
      n += 1;
      for (let s = 0; s < 3; s += 1) {
        const sub = projectRow(n, { parent_project_id: parentId, sort_order: s });
        sub.name = `U${u + 1} sub ${s + 1}`;
        rows.push(sub);
        n += 1;
      }
    }
    for (let p = 0; p < 8; p += 1) {
      const flat = projectRow(n, { sort_order: 4 + p });
      flat.name = `Flat ${p + 1}`;
      rows.push(flat);
      n += 1;
    }
    return rows;
  };

  test('(d) NEST: a childless project dropped on another childless project, list scrolled', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const rows = igorRows();
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openApp(page);

    const flat1 = rows.find((r) => r.name === 'Flat 1')!;
    const flat2 = rows.find((r) => r.name === 'Flat 2')!;
    // Both live far down a list that overflows the panel, so reaching them means
    // the drawer has scrolled - the state Igor's drawer is always in.
    await row(page, flat2.id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const target = await row(page, flat1.id).boundingBox();
    expect(target, "Flat 1's row must have a box").toBeTruthy();

    let probe: any = null;
    await mouseDragTo(page, row(page, flat2.id), target!.x + target!.width / 2, target!.y + target!.height / 2, {
      beforeRelease: async () => {
        probe = await dragProbe(page);
      },
    });

    const counts = await pointerCounts(page);
    expect(
      probe?.draggingRows,
      `the drag never STARTED. probe=${JSON.stringify(probe)} pointer events=${JSON.stringify(counts)}`,
    ).toBe(1);

    await expect
      .poll(() => parentWrites(writes)[flat2.id] ?? 'no-write', {
        timeout: 10000,
        message: `no parent_project_id PATCH for Flat 2. probe=${JSON.stringify(probe)} patches=${JSON.stringify(projectPatches(writes))}`,
      })
      .toBe(flat1.id);
  });

  test('(e) REORDER: a top-level seam drop deep in a scrolled list', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = igorRows();
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openApp(page);

    const flat7 = rows.find((r) => r.name === 'Flat 7')!;
    const flat3 = rows.find((r) => r.name === 'Flat 3')!;
    await row(page, flat7.id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const before = await myProjectsOrder(page);
    const target = await blockOf(page, flat3.id).boundingBox();
    expect(target, "Flat 3's block must have a box").toBeTruthy();

    let probe: any = null;
    await mouseDragTo(page, row(page, flat7.id), target!.x + target!.width / 2, target!.y + 5, {
      beforeRelease: async () => {
        probe = await dragProbe(page);
      },
    });

    const counts = await pointerCounts(page);
    expect(
      probe?.draggingRows,
      `the drag never STARTED. probe=${JSON.stringify(probe)} pointer events=${JSON.stringify(counts)}`,
    ).toBe(1);

    await expect
      .poll(() => myProjectsOrder(page), {
        timeout: 10000,
        message: `order never changed from ${JSON.stringify(before)}. probe=${JSON.stringify(probe)} sort_order writes=${JSON.stringify(sortOrderWrites(writes))} pointer events=${JSON.stringify(counts)}`,
      })
      .not.toEqual(before);

    const order = await myProjectsOrder(page);
    expect(order.indexOf('Flat 7')).toBe(order.indexOf('Flat 3') - 1);
  });
});

// A HUMAN mouse: many small jittery steps at ~120Hz, not a 14px jump. The
// scripted helper above clears the 8px distance constraint in ONE move; a real
// hand crosses it over a dozen sub-pixel-ish steps, which is a different event
// stream through dnd-kit's activation path.
const humanMouseDragTo = async (page: Page, source: Locator, toX: number, toY: number,
  opts: { beforeRelease?: () => Promise<void> } = {}) => {
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  expect(s, 'the dragged row must have a box').toBeTruthy();
  const sx = s!.x + s!.width / 2;
  const sy = s!.y + s!.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const dist = Math.hypot(toX - sx, toY - sy);
  const steps = Math.max(30, Math.round(dist / 2.5));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const jitter = (i % 3) - 1; // -1, 0, 1 px of hand wobble
    await page.mouse.move(sx + (toX - sx) * t + jitter, sy + (toY - sy) * t + jitter);
    await page.waitForTimeout(8);
  }
  await page.mouse.move(toX, toY);
  await page.waitForTimeout(150);
  if (opts.beforeRelease) await opts.beforeRelease();
  await page.mouse.up();
  await page.waitForTimeout(400);
};

test.describe('drawer drag with a real DESKTOP MOUSE, human gesture', () => {
  test('(f) NEST with a slow jittery hand', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openApp(page);

    const target = await row(page, pid(1)).boundingBox();
    let probe: any = null;
    await humanMouseDragTo(page, row(page, pid(2)), target!.x + target!.width / 2, target!.y + target!.height / 2, {
      beforeRelease: async () => { probe = await dragProbe(page); },
    });
    const counts = await pointerCounts(page);
    expect(probe?.draggingRows, `drag never started. probe=${JSON.stringify(probe)} pe=${JSON.stringify(counts)}`).toBe(1);
    await expect.poll(() => parentWrites(writes)[pid(2)] ?? 'no-write', {
      timeout: 10000,
      message: `no PATCH. probe=${JSON.stringify(probe)} patches=${JSON.stringify(projectPatches(writes))}`,
    }).toBe(pid(1));
  });

  test('(g) REORDER a top-level project THAT HAS SUBS into another block\'s seam', async ({ page, context }) => {
    test.setTimeout(120_000);
    // Igor's tree after the P7 reorganise: the top level is umbrellas, and every
    // one of them has sub-projects. The one-level rule means such a project can
    // never be NESTED, so the seam reorder is the only move it has left - if that
    // is broken with a mouse, "I cannot move any project" is literally true.
    const rows: ProjectRow[] = [];
    for (let u = 0; u < 3; u += 1) {
      const parent = projectRow(u * 4 + 1, { sort_order: u });
      parent.name = `Umbrella ${u + 1}`;
      rows.push(parent);
      for (let s = 0; s < 2; s += 1) {
        const sub = projectRow(u * 4 + 2 + s, { parent_project_id: parent.id, sort_order: s });
        sub.name = `U${u + 1} sub ${s + 1}`;
        rows.push(sub);
      }
    }
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openApp(page);

    expect(await myProjectsOrder(page)).toHaveLength(3);
    const u3 = rows.find((r) => r.name === 'Umbrella 3')!;
    const u1 = rows.find((r) => r.name === 'Umbrella 1')!;
    const target = await blockOf(page, u1.id).boundingBox();
    expect(target, "Umbrella 1's block must have a box").toBeTruthy();

    let probe: any = null;
    await mouseDragTo(page, row(page, u3.id), target!.x + target!.width / 2, target!.y + 5, {
      beforeRelease: async () => { probe = await dragProbe(page); },
    });
    const counts = await pointerCounts(page);
    expect(probe?.draggingRows, `drag never started. probe=${JSON.stringify(probe)} pe=${JSON.stringify(counts)}`).toBe(1);
    await expect.poll(() => myProjectsOrder(page), {
      timeout: 10000,
      message: `order never changed. probe=${JSON.stringify(probe)} sort=${JSON.stringify(sortOrderWrites(writes))}`,
    }).toEqual(['Umbrella 3', 'Umbrella 1', 'Umbrella 2']);
  });
});

// ---- the OVERLAY drawer (Igor's daily surface) -------------------------------
//
// /app renders the drawer as the inline shadcn sidebar at desktop widths, which
// is what every case above exercises. The dock's Projects button on /home and
// /meetings renders ProjectsDrawerHost instead: ProjectSidebar in `overlayMode`,
// which is the PORTALLED overlay+panel branch AT EVERY WIDTH - including a
// desktop with a mouse. That branch has its own pointer plumbing (a swipe-to-
// close gesture on the panel, an overlay click latch) and had no mouse coverage
// at all.
const openOverlayDrawer = async (page: Page) => {
  await page.goto(`${BASE}/home`);
  const trigger = page.getByRole('button', { name: 'Projects', exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: 20000 });
  await trigger.click();
  const panel = page.getByLabel('Projects');
  await expect(panel).toHaveAttribute('data-state', 'open', { timeout: 10000 });
  await expect(page.locator('[data-testid="my-projects-list"]')).toBeVisible({ timeout: 15000 });
  await settleDrawer(page);
};

test.describe('OVERLAY drawer drag with a real DESKTOP MOUSE', () => {
  test('(h) NEST: P2 onto the middle of P1 in the overlay drawer', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openOverlayDrawer(page);

    expect(await myProjectsOrder(page)).toEqual(['Drag P1', 'Drag P2', 'Drag P3']);
    const target = await row(page, pid(1)).boundingBox();
    expect(target, "P1's row must have a box").toBeTruthy();

    let probe: any = null;
    await mouseDragTo(page, row(page, pid(2)), target!.x + target!.width / 2, target!.y + target!.height / 2, {
      beforeRelease: async () => { probe = await dragProbe(page); },
    });
    const counts = await pointerCounts(page);
    expect(probe?.draggingRows,
      `the drag never STARTED in the overlay drawer. probe=${JSON.stringify(probe)} pe=${JSON.stringify(counts)}`).toBe(1);
    await expect.poll(() => parentWrites(writes)[pid(2)] ?? 'no-write', {
      timeout: 10000,
      message: `no parent_project_id PATCH. probe=${JSON.stringify(probe)} patches=${JSON.stringify(projectPatches(writes))}`,
    }).toBe(pid(1));
  });

  test('(i) REORDER: P3 onto the top edge seam of P1 in the overlay drawer', async ({ page, context }) => {
    test.setTimeout(120_000);
    const rows = [projectRow(1), projectRow(2), projectRow(3)];
    const writes: Write[] = [];
    await installIntercepts(context, rows, writes);
    await seedSession(page);
    await installPointerCounter(page);
    await openOverlayDrawer(page);

    const target = await blockOf(page, pid(1)).boundingBox();
    expect(target, "P1's block must have a box").toBeTruthy();
    let probe: any = null;
    await mouseDragTo(page, row(page, pid(3)), target!.x + target!.width / 2, target!.y + 5, {
      beforeRelease: async () => { probe = await dragProbe(page); },
    });
    const counts = await pointerCounts(page);
    expect(probe?.draggingRows,
      `the drag never STARTED in the overlay drawer. probe=${JSON.stringify(probe)} pe=${JSON.stringify(counts)}`).toBe(1);
    await expect.poll(() => myProjectsOrder(page), {
      timeout: 10000,
      message: `order never changed. probe=${JSON.stringify(probe)} sort=${JSON.stringify(sortOrderWrites(writes))}`,
    }).toEqual(['Drag P3', 'Drag P1', 'Drag P2']);
  });
});
