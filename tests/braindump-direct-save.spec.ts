/**
 * Brain Dump DIRECT-exit regression (Deploy 1, 2026-07-28).
 *
 * What it guards: the recording stage on /home now offers three exits —
 * Save All (N) writes straight through src/lib/brainDumpSave.ts and lands on
 * /app with no review dialog; Edit Tasks keeps the old stop -> dialog route
 * (and stays the orb's behaviour); Discard is a two-step, in-place confirm that
 * writes NOTHING. The direct save must be as warm as the dialog save: the same
 * shared-cache patches, so /app paints the new rows on its first frame with
 * zero task-list refetches.
 *
 * HERMETIC — no Gemini, no microphone, no real Supabase. Auth is a seeded
 * localStorage session + intercepted /auth/v1, every PostgREST call is
 * intercepted (tests/helpers/braindumpEnv.ts, shared with braindump-save.spec.ts),
 * and the live session is the DEV-only transport shim in useBrainDumpLive.ts
 * (window.__mockLiveSession, gated on import.meta.env.DEV so it is dropped from
 * production builds). Unlike braindump-save.spec.ts this drives HOME itself —
 * the real orb, the real stream, the real button row.
 *
 * WHAT THIS RIG CANNOT PROVE (stated, not buried): it is desktop Chromium at a
 * 393x852 mobile viewport, not iOS Safari and not a standalone icon-app. It says
 * nothing about backdrop-filter behaviour, the standalone viewport shortfall
 * (100lvh - 100svh evaluates to 0 here), or real touch. The measured
 * button-row-to-dock clearance it reports is the browser-tab case only.
 *
 * BISECT PROOF (house law): src/pages/Home.tsx BISECT_DISABLE_DIRECT_SAVE = true
 * -> "Save All (N)" falls back to the review dialog, the run never leaves /home,
 * and the first test FAILS in the /app block — at the waitForURL guard that
 * fronts the title assertions ("page.waitForURL: Timeout 20000ms exceeded").
 * Restore to false -> green.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  BASE_TASK_TITLES,
  USER_ID,
  createCounts,
  installIntercepts,
  resetCounts,
  seedSession,
} from './helpers/braindumpEnv';

const TODAY_TITLE = 'Buy milk this evening';
const PROJECT_TITLE = 'Sketch the kitchen layout';
const NEW_PROJECT_NAME = 'Kitchen Reno Direct';
const NEW_TASK_TITLES = [TODAY_TITLE, PROJECT_TITLE];

const counts = createCounts();

// Igor's reference phone. The Playwright default (390x844) is close but the
// bottom budget is measured against 393x852 in src/index.css, so measure there.
test.use({ viewport: { width: 393, height: 852 } });

/** Push a wire message into the DEV transport shim. */
function emit(page: Page, message: Record<string, unknown>) {
  return page.evaluate((m) => (window as any).__brainDumpLiveMock.emit(m), message);
}

/** Home, signed in, warm caches, live session open, two tasks captured. */
async function bootHomeWithTwoTasks(page: Page) {
  await seedSession(page);
  await page.addInitScript(() => {
    (window as any).__mockLiveSession = true;
  });

  await page.goto('/home');
  await expect(page.getByRole('button', { name: 'Brain dump' })).toBeVisible({ timeout: 20_000 });

  // The shared /app caches must hold a baseline set before the save — the exact
  // precondition a warm navigation needs (usePrefetchAppData does this on Home).
  await expect.poll(() => counts.taskListGets, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate((uid) => {
          const qc = (window as any).__qc;
          const t = qc?.getQueryData(['focusos-all-tasks', uid]);
          const p = qc?.getQueryData(['focusos-projects', uid]);
          return Array.isArray(t) && t.length > 0 && Array.isArray(p);
        }, USER_ID),
      { timeout: 20_000 },
    )
    .toBe(true);

  // Tap the orb — the real start path, with the mock transport underneath.
  await page.getByRole('button', { name: 'Brain dump' }).click();
  await expect(page.getByText('Listening… speak freely')).toBeVisible({ timeout: 15_000 });

  // Read "today" from the PAGE (its context is pinned to UTC), so both rows land
  // in Index's default Today view whatever the host machine's timezone is. Only
  // the 'today' destination gets a due-date fallback in the saver, so the
  // new-project row must carry an explicit one — exactly like a real extraction.
  const todayIso = await page.evaluate(() => new Date().toISOString().split('T')[0]);

  await emit(page, {
    toolCall: {
      functionCalls: [
        { id: 'call-today', name: 'add_task_to_today', args: { title: TODAY_TITLE, priority: 'high' } },
      ],
    },
  });
  await emit(page, {
    toolCall: {
      functionCalls: [
        {
          id: 'call-new-project',
          name: 'create_project_and_add_task',
          args: {
            title: PROJECT_TITLE,
            priority: 'medium',
            project_name: NEW_PROJECT_NAME,
            due_date: todayIso,
          },
        },
      ],
    },
  });
  await expect(page.locator('.lg-stask')).toHaveCount(2, { timeout: 15_000 });
}

test('Save All writes direct and lands warm on /app', async ({ browser }) => {
  test.setTimeout(90_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
  const page = await context.newPage();
  await bootHomeWithTwoTasks(page);

  // --- Geometry: three pills, ONE row, clear of the dock at 393x852 ---
  const geometry = await page.evaluate(() => {
    const row = document.querySelector('.lg-recbtns') as HTMLElement;
    const dock = document.querySelector('.lg-dock') as HTMLElement;
    const r = row.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const btns = Array.from(row.querySelectorAll('button')).map((b) => ({
      label: (b.textContent || '').trim(),
      top: Math.round(b.getBoundingClientRect().top),
      width: Math.round(b.getBoundingClientRect().width),
    }));
    return {
      rowHeight: Math.round(r.height),
      rowBottom: Math.round(r.bottom),
      dockTop: Math.round(d.top),
      clearance: Math.round(d.top - r.bottom),
      viewport: window.innerHeight,
      btns,
      rows: new Set(btns.map((b) => b.top)).size,
    };
  });
  console.log('[geometry 393x852]', JSON.stringify(geometry));
  expect(geometry.btns.length, 'three exits').toBe(3);
  expect(geometry.rows, 'all three pills on ONE row (no wrap)').toBe(1);
  expect(geometry.clearance, 'button row clears the dock').toBeGreaterThan(0);

  const getsBeforeSave = counts.taskListGets;

  // rAF frame logger — records any frame that paints the task-list skeleton while
  // on /app. A warm navigation must never show it.
  await page.evaluate(() => {
    const w = window as any;
    w.__skeletonFrames = [];
    const tick = () => {
      if (location.pathname.endsWith('/app') && document.querySelector('[aria-label="Loading tasks"]')) {
        w.__skeletonFrames.push({ t: Math.round(performance.now()), search: location.search });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // --- The direct exit ---
  await page.getByRole('button', { name: 'Save All (2)' }).click();
  await page.waitForURL(/\/app/, { timeout: 20_000 });

  // The inserts really happened, and the review dialog never appeared.
  expect(counts.insertedProjects.length, 'one new project inserted').toBe(1);
  expect(counts.insertedProjects[0].name, 'the captured new-project name').toBe(NEW_PROJECT_NAME);
  expect(counts.insertedTasks.length, 'two tasks inserted').toBe(2);
  await expect(page.getByRole('button', { name: 'Save All Tasks' })).toHaveCount(0);

  // Both new titles AND the baseline set are on screen.
  for (const title of [...NEW_TASK_TITLES, ...BASE_TASK_TITLES]) {
    await expect(page.getByText(title).first(), `${title} visible on /app`).toBeVisible({ timeout: 15_000 });
  }

  // No task-list refetch was needed to get there (Home's own Up Next card IS
  // invalidated on purpose — counted separately, see the helper).
  expect(counts.taskListGets - getsBeforeSave, 'zero task-list refetches after the save').toBe(0);

  const skeletonFrames = await page.evaluate(() => (window as any).__skeletonFrames);
  expect(skeletonFrames, 'no skeleton frame painted on the warm /app nav').toEqual([]);

  // The caches themselves: new rows first (created_at desc), id-deduped, slimmed.
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
    NEW_PROJECT_NAME,
    'Baseline project',
  ]);

  await context.close();
});

test('the ?fakedump demo stage keeps all three exits inert and network-free', async ({ browser }) => {
  test.setTimeout(60_000);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  // Count EVERY Supabase call, not just writes: signed out, the demo must not so
  // much as read.
  const calls: string[] = [];
  await context.route('**/*.supabase.co/**', (route) => {
    calls.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Deliberately NO seeded session — ?fakedump is reachable signed out.
  const page = await context.newPage();
  await page.goto('/home?fakedump=3');
  await expect(page.locator('.lg-stask')).toHaveCount(3, { timeout: 20_000 });
  const before = calls.length;

  // Save All and Edit Tasks are wired but inert: no insert, no navigation, and
  // above all no review dialog (there is no user to save as).
  await page.getByRole('button', { name: 'Save All (3)' }).click();
  await page.getByRole('button', { name: 'Edit Tasks' }).click();
  await page.waitForTimeout(700);
  expect(page.url(), 'still on the demo stage').toContain('fakedump=3');
  // No OPEN dialog. /home permanently mounts the overlay Projects drawer
  // (ProjectsDrawerHost — white-flash law: the layer is born once, never on
  // open), and that panel carries role="dialog" with aria-hidden while closed,
  // so the raw attribute selector alone would now always match it.
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toHaveCount(0);
  await expect(page.locator('.lg-stask')).toHaveCount(3);

  // Discard is the one demo-safe action: it resets the synthetic stream.
  await page.getByRole('button', { name: 'Discard captured tasks' }).click();
  await expect(page.locator('.lg-stask')).toHaveCount(0);

  expect(calls.slice(before), 'the demo stage issued no Supabase traffic').toEqual([]);

  await context.close();
});

/**
 * Discard, 2026-07-28 redesign: ONE tap, wrongness is free.
 *
 * The two-step "Sure? (N)" latch was mechanically sound and humanly wrong — on
 * a real phone the silent red pill read as a dead button, twice, in two
 * separate device sessions. The redesign follows the preview-not-commit
 * philosophy the rest of the capture already uses: the tap discards
 * IMMEDIATELY, and a toast offers Undo. restoreStagedCapture puts the capture
 * back on the paused stage (the idle-staged surface), where every exit —
 * including the orb resuming the session with the list intact — still works.
 *
 * These tests prove the one-tap wipe writes nothing, and that Undo restores
 * the capture all the way back into a live resumed session.
 */
test('Discard is ONE tap, writes nothing, and offers Undo', async ({ browser }) => {
  test.setTimeout(90_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
  const page = await context.newPage();
  await bootHomeWithTwoTasks(page);

  const discard = page.getByRole('button', { name: 'Discard captured tasks' });

  // ONE tap: the capture is gone and the stage collapses. No arming state, no
  // second tap, no label the user has to decode.
  await discard.click();
  await expect(page.getByRole('button', { name: 'Record Meeting' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.lg-stask')).toHaveCount(0);
  await expect(page.locator('.lg-hero-col.rec')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save All/ })).toHaveCount(0);

  // The escape hatch is offered, visibly.
  await expect(page.getByText('Discarded 2 tasks')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  // Nothing was written, and nothing navigated.
  expect(counts.insertedTasks, 'zero task inserts').toEqual([]);
  expect(counts.insertedProjects, 'zero project inserts').toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/home');

  await context.close();
});

test('Undo restores the capture and the orb resumes it into a live session', async ({ browser }) => {
  test.setTimeout(90_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
  const page = await context.newPage();
  await bootHomeWithTwoTasks(page);

  await page.getByRole('button', { name: 'Discard captured tasks' }).click();
  await expect(page.getByRole('button', { name: 'Record Meeting' })).toBeVisible({ timeout: 10_000 });

  // Undo: the capture returns on the PAUSED stage — the same idle-staged
  // surface a quiet-session auto-stop uses, so every exit is reachable again.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.lg-stask')).toHaveCount(2);
  await expect(page.getByText('Paused — you went quiet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save All (2)' })).toBeVisible();

  // And the orb resumes the capture into a fresh live session: the list rides
  // in (preserveTasks), nothing is wiped by the restart.
  await page.getByRole('button', { name: 'Brain dump' }).click();
  await expect(page.getByText('Listening… speak freely')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.lg-stask'), 'capture survived the resume').toHaveCount(2);

  expect(counts.insertedTasks, 'zero task inserts').toEqual([]);
  expect(counts.insertedProjects, 'zero project inserts').toEqual([]);

  await context.close();
});

test('starting a new dump closes the Undo window (no stale restore)', async ({ browser }) => {
  test.setTimeout(90_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
  const page = await context.newPage();
  await bootHomeWithTwoTasks(page);

  await page.getByRole('button', { name: 'Discard captured tasks' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  // Audit 2026-07-29, rig-proven: the toast used to outlive the new session
  // and its Undo overwrote the fresh capture while the socket stayed hot. The
  // orb tap now dismisses it (and the hook-level guard refuses stale restores
  // that dodge the dismissal race).
  await page.getByRole('button', { name: 'Brain dump' }).click();
  await expect(page.getByText('Listening… speak freely')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

  await context.close();
});

test('ids stay unique and session projects survive remove + Discard + Undo + resume', async ({ browser }) => {
  test.setTimeout(90_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
  const page = await context.newPage();
  await bootHomeWithTwoTasks(page); // brain-dump-1 (Today) + brain-dump-2 (new project)

  // The model removes task 1 — the list is now shorter than its highest id,
  // which is exactly the shape that made the length-rebase mint duplicates.
  await emit(page, { toolCall: { functionCalls: [{ id: 'rm-1', name: 'remove_task', args: { task_id: 'brain-dump-1' } }] } });
  await expect(page.locator('.lg-stask')).toHaveCount(1);

  await page.getByRole('button', { name: 'Discard captured tasks' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.lg-stask')).toHaveCount(1);
  await expect(page.getByText('Paused — you went quiet')).toBeVisible();

  // Resume, then route a task to the SESSION project by name — the rebuilt
  // new-project map must still resolve it (it used to be wiped, silently
  // splitting the capture into Today).
  await page.getByRole('button', { name: 'Brain dump' }).click();
  await expect(page.getByText('Listening… speak freely')).toBeVisible({ timeout: 15_000 });
  await emit(page, { toolCall: { functionCalls: [{ id: 'add-2', name: 'add_task_to_project', args: { title: 'After resume', project_name: NEW_PROJECT_NAME, priority: 'low' } }] } });
  await expect(page.locator('.lg-stask')).toHaveCount(2);
  await expect(page.getByText(`NEW PROJECT: ${NEW_PROJECT_NAME.toUpperCase()}`), 'session project resolved after resume').toBeVisible();

  // The new task must have a FRESH id: updating it by id renames exactly one
  // row (the length-rebase used to hand out brain-dump-2 again, and one
  // update then mutated two rows).
  await emit(page, { toolCall: { functionCalls: [{ id: 'up-3', name: 'update_task', args: { task_id: 'brain-dump-3', title: 'RENAMED AFTER RESUME' } }] } });
  await expect(page.locator('.lg-stask', { hasText: 'RENAMED AFTER RESUME' })).toHaveCount(1);
  await expect(page.locator('.lg-stask')).toHaveCount(2);

  expect(counts.insertedTasks, 'zero task inserts').toEqual([]);
  await context.close();
});
