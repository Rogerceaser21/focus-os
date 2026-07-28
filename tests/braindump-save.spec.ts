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
import { test, expect } from '@playwright/test';
import {
  BASE_TASK_TITLES,
  USER_ID,
  createCounts,
  installIntercepts,
  resetCounts,
  seedSession,
} from './helpers/braindumpEnv';

const NEW_TASK_TITLES = ['Repro dumped task today', 'Repro dumped task in new project'];

// Seeded rows, intercepts and the request counters all live in
// ./helpers/braindumpEnv.ts — shared verbatim with braindump-direct-save.spec.ts.
const counts = createCounts();

test('brain dump save lands in the /app caches (no refetch, no skeleton)', async ({ browser }) => {
  test.setTimeout(90_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
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
