/**
 * Brain Dump save-path regression (Fix B, 2026-07-27).
 *
 * The bug: BrainDumpLiveDialog.handleSave inserted projects + tasks straight into
 * Postgres and then called onTasksCreated, which on Home is just navigate('/app').
 * Nothing wrote the new rows into the shared React-Query caches, and /app seeds
 * DURING RENDER from queryClient.getQueryData(appDataKeys.tasks/projects) — so the
 * just-dumped tasks were invisible for up to the 60-min gcTime. Realtime cannot
 * cover it either: its channel lives in Index, which is unmounted while on /home.
 *
 * This spec is HERMETIC — no Gemini, no microphone, no real Supabase. Auth is a
 * seeded localStorage session plus intercepted /auth/v1, and every PostgREST read
 * and write is intercepted (same strategy as tests/investigate-4bugs.spec.ts, minus
 * the throwaway signup). The dialog is driven through the DEV-only harness route
 * /dev/braindump-repro (src/pages/BrainDumpRepro.tsx), which mirrors Home's
 * brain-dump wiring and pre-loads two captured tasks via the initialTasks prop.
 *
 * Bisect proof (house law): stub out the two queryClient.setQueryData patches in
 * BrainDumpLiveDialog.handleSave and this spec FAILS on the "new task visible on
 * /app" assertion; restore them and it passes.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const PROJECT_REF = 'mshlbsgsyzzfxyxramjj';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'braindump.probe@example.test';

const BASE_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const BASE_TASK_A = '33333333-3333-4333-8333-333333333333';
const BASE_TASK_B = '44444444-4444-4444-8444-444444444444';

const NEW_TASK_TITLES = ['Repro dumped task today', 'Repro dumped task in new project'];
const BASE_TASK_TITLES = ['Baseline task alpha', 'Baseline task beta'];

// Noon UTC: the browser context below is pinned to UTC, so this always lands on
// "today" for Index's Today-view filter regardless of the host machine's timezone.
function todayNoonIso(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

// A full slim task-list row (every column in TASK_LIST_COLUMNS) plus the heavy
// `images` column the real .select() on an insert also returns — present here on
// purpose, so the spec can prove slimTaskRow strips it before the cache write.
const baseTaskRow = (id: string, title: string, createdAtMsAgo: number) => ({
  id,
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
  project_id: BASE_PROJECT_ID,
  sort_order: 0,
  completed_by_email: null,
  assigned_to_email: null,
  change_request_message: null,
  google_calendar_event_id: null,
  created_at: new Date(Date.now() - createdAtMsAgo).toISOString(),
  images: [],
});

const baseProjectRow = () => ({
  id: BASE_PROJECT_ID,
  name: 'Baseline project',
  color: '#B8572E',
  is_shared: false,
  user_id: USER_ID,
  created_at: new Date(Date.now() - 600_000).toISOString(),
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

interface Counts {
  taskListGets: number;
  insertedProjects: any[];
  insertedTasks: any[];
}

const counts: Counts = { taskListGets: 0, insertedProjects: [], insertedTasks: [] };

// Seed a valid-looking Supabase session in localStorage before any app code runs, so
// getSession() resolves offline and useAuth has a user at first render.
async function seedSession(page: Page) {
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

async function installIntercepts(context: BrowserContext) {
  // /auth/v1 — getUser() (called by handleSave) and any token refresh.
  await context.route('**/auth/v1/**', (route) => {
    const url = route.request().url();
    const user = {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: USER_EMAIL,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    };
    if (url.includes('/auth/v1/user')) {
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
    const url = req.url();
    const method = req.method();
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (method !== 'GET' && method !== 'HEAD') {
      const payload = req.postDataJSON();
      if (url.includes('focusos_projects')) {
        const row = {
          id: `99999999-0000-4000-8000-${String(counts.insertedProjects.length).padStart(12, '0')}`,
          color: '#3b82f6',
          is_shared: false,
          created_at: new Date().toISOString(),
          ...(Array.isArray(payload) ? payload[0] : payload),
        };
        counts.insertedProjects.push(row);
        return reply(wantsObject ? row : [row]);
      }
      if (url.includes('focusos_tasks')) {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((p: any, i: number) => ({
          ...baseTaskRow(`88888888-0000-4000-8000-${String(counts.insertedTasks.length + i).padStart(12, '0')}`, p.title, 0),
          ...p,
          // The real PostgREST insert echo carries the heavy `images` column; the fix
          // must strip it via slimTaskRow before the row reaches the hot cache.
          images: ['data:image/png;base64,PROBE-HEAVY-PAYLOAD'],
        }));
        counts.insertedTasks.push(...rows);
        return reply(wantsObject ? rows[0] : rows);
      }
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
      return reply(wantsObject ? {} : []);
    }

    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_tasks')) {
      if (url.includes('status=neq.completed')) {
        counts.taskListGets += 1;
        // The real list read selects TASK_LIST_COLUMNS, which excludes `images` —
        // mirror that projection so a stray `images` key can only have come from
        // the insert echo (i.e. from a missing slimTaskRow).
        return reply(
          [
            baseTaskRow(BASE_TASK_A, BASE_TASK_TITLES[0], 120_000),
            baseTaskRow(BASE_TASK_B, BASE_TASK_TITLES[1], 240_000),
          ].map(({ images, ...slim }) => slim),
        );
      }
      return reply([]); // completed hydration + image hydration
    }
    if (url.includes('focusos_projects')) {
      return reply([baseProjectRow(), ...counts.insertedProjects]);
    }
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

test('brain dump save lands in the /app caches (no refetch, no skeleton)', async ({ browser }) => {
  test.setTimeout(90_000);
  counts.taskListGets = 0;
  counts.insertedProjects = [];
  counts.insertedTasks = [];

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context);
  const page = await context.newPage();
  await seedSession(page);

  // --- 1. Warm the shared caches the way Home does (usePrefetchAppData) ---
  await page.goto('/dev/braindump-repro');
  await expect(page.getByTestId('repro-ready')).toHaveText('signed-in');
  await expect.poll(() => counts.taskListGets, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const qc = (window as any).__qc;
          const t = qc?.getQueryData(['focusos-all-tasks', '11111111-1111-4111-8111-111111111111']);
          const p = qc?.getQueryData(['focusos-projects', '11111111-1111-4111-8111-111111111111']);
          return Array.isArray(t) && t.length > 0 && Array.isArray(p);
        }),
      { timeout: 20_000 },
    )
    .toBe(true);

  const getsBeforeSave = counts.taskListGets;

  // rAF frame logger — records any frame that paints the task-list skeleton while on
  // /app. A warm navigation must never show it (flicker fault A).
  await page.evaluate(() => {
    const w = window as any;
    w.__skeletonFrames = [];
    const tick = () => {
      if (
        location.pathname.endsWith('/app') &&
        document.querySelector('[aria-label="Loading tasks"]')
      ) {
        w.__skeletonFrames.push({ t: Math.round(performance.now()), search: location.search });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // --- 2. Save All Tasks against the intercepted inserts ---
  await expect(page.getByText(NEW_TASK_TITLES[0]).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Save All Tasks' }).click();

  // --- 3. SPA navigation to /app is done by the dialog's onTasksCreated ---
  await page.waitForURL(/\/app/, { timeout: 20_000 });

  // The inserts really happened: one new project (the 'new-project' destination) and
  // two tasks.
  expect(counts.insertedProjects.length, 'one new project inserted').toBe(1);
  expect(counts.insertedTasks.length, 'two tasks inserted').toBe(2);

  // --- 4a. Both new titles AND the baseline set are on screen ---
  for (const title of [...NEW_TASK_TITLES, ...BASE_TASK_TITLES]) {
    await expect(page.getByText(title).first(), `${title} visible on /app`).toBeVisible({ timeout: 15_000 });
  }

  // --- 4b. No task-list refetch was needed to get there ---
  expect(counts.taskListGets - getsBeforeSave, 'zero task-list refetches after the save').toBe(0);

  // --- 4c. No skeleton frame during the warm navigation ---
  const skeletonFrames = await page.evaluate(() => (window as any).__skeletonFrames);
  expect(skeletonFrames, 'no skeleton frame painted on the warm /app nav').toEqual([]);

  // --- 4d. The cache itself is correct: new rows first (created_at desc), id-deduped,
  //         and slimmed — the heavy `images` column never enters the hot cache ---
  const cacheState = await page.evaluate((uid) => {
    const qc = (window as any).__qc;
    const tasks = qc.getQueryData(['focusos-all-tasks', uid]) as any[];
    const projects = qc.getQueryData(['focusos-projects', uid]) as any[];
    return {
      taskTitles: tasks.map((t) => t.title),
      taskIds: tasks.map((t) => t.id),
      anyImagesKey: tasks.some((t) => 'images' in t),
      projectNames: projects.map((p) => p.name),
    };
  }, USER_ID);

  expect(cacheState.taskTitles.slice(0, 2), 'new rows prepended (created_at desc)').toEqual(NEW_TASK_TITLES);
  expect(cacheState.taskTitles, 'baseline rows retained').toEqual([...NEW_TASK_TITLES, ...BASE_TASK_TITLES]);
  expect(new Set(cacheState.taskIds).size, 'no duplicate ids in the cache').toBe(cacheState.taskIds.length);
  expect(cacheState.anyImagesKey, 'heavy images column never enters the hot task cache').toBe(false);
  expect(cacheState.projectNames, 'new project prepended to the projects cache').toEqual([
    'Repro New Project',
    'Baseline project',
  ]);

  await context.close();
});
