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
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.locator('.lg-stask')).toHaveCount(3);

  // Discard is the one demo-safe action: it resets the synthetic stream.
  await page.getByRole('button', { name: 'Discard captured tasks' }).click();
  await expect(page.locator('.lg-stask')).toHaveCount(0);

  expect(calls.slice(before), 'the demo stage issued no Supabase traffic').toEqual([]);

  await context.close();
});

/**
 * F1 — the Discard repair.
 *
 * The two-step Discard used to hold a 3s arm window that, when it expired, made
 * the next tap re-ARM instead of confirming. On a phone, read-and-decide
 * routinely takes longer than 3s, so every tap landed in the gap and Discard
 * could never be reached however many times it was pressed — the S5 dead-loop.
 * The repair removes the timer entirely: the "Sure? (N)" label IS the latch,
 * so what the button says is always what a tap does — armed persists until the
 * discard executes or another action (orb, save, finish) disarms it. A relaxing
 * label over a live latch was rejected: it turns a later absent-minded tap into
 * a silent one-tap wipe.
 *
 * These tests prove the two-tap confirm, the late tap the old code ate, and
 * that the label never silently disagrees with the latch.
 */
test('Discard needs two taps and writes nothing', async ({ browser }) => {
  test.setTimeout(90_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
  const page = await context.newPage();
  await bootHomeWithTwoTasks(page);

  const discard = page.getByRole('button', { name: /Discard captured tasks|Confirm discarding/ });

  // First tap ARMS it — nothing is thrown away yet.
  await discard.click();
  await expect(discard).toHaveText('Sure? (2)');
  await expect(page.locator('.lg-stask'), 'the capture survives the first tap').toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Save All (2)' })).toBeVisible();

  // The armed label must not push the row onto a second line — that would eat
  // the Fix A bottom budget and shove the orb under the dock.
  const armedGeometry = await page.evaluate(() => {
    const row = document.querySelector('.lg-recbtns') as HTMLElement;
    const dock = document.querySelector('.lg-dock') as HTMLElement;
    const btns = Array.from(row.querySelectorAll('button'));
    return {
      rows: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top))).size,
      widths: btns.map((b) => Math.round(b.getBoundingClientRect().width)),
      clearance: Math.round(dock.getBoundingClientRect().top - row.getBoundingClientRect().bottom),
    };
  });
  console.log('[geometry 393x852 armed]', JSON.stringify(armedGeometry));
  expect(armedGeometry.rows, 'armed row still fits on ONE line').toBe(1);
  expect(armedGeometry.clearance, 'armed row still clears the dock').toBeGreaterThan(0);

  // A tap 4.5s in — PAST the old 3000ms window — must still confirm. Under the
  // old timer code this re-armed instead, which is the dead-loop itself. Real
  // timers on purpose: the wall-clock behaviour is the thing under test.
  await page.waitForTimeout(4_500);
  await expect(discard, 'still showing the armed label at 4.5s').toHaveText('Sure? (2)');
  await discard.click();
  await expect(page.getByRole('button', { name: 'Record Meeting' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.lg-stask')).toHaveCount(0);
  await expect(page.locator('.lg-hero-col.rec')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save All/ })).toHaveCount(0);

  // Nothing was written, and nothing navigated.
  expect(counts.insertedTasks, 'zero task inserts').toEqual([]);
  expect(counts.insertedProjects, 'zero project inserts').toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/home');

  await context.close();
});

test('an armed Discard never relaxes — the label is the latch', async ({ browser }) => {
  test.setTimeout(120_000);
  resetCounts(counts);

  const context = await browser.newContext({ timezoneId: 'UTC' });
  await installIntercepts(context, counts);
  const page = await context.newPage();
  await bootHomeWithTwoTasks(page);

  const discard = page.getByRole('button', { name: /Discard captured tasks|Confirm discarding/ });

  // Arm it, then wait far past the old timer windows.
  await discard.click();
  await expect(discard).toHaveText('Sure? (2)');
  await page.waitForTimeout(9_500);

  // No timer owns the text any more: the label still shows the armed state,
  // so the user can never face a "Discard" label hiding a live latch.
  await expect(discard, 'label still armed after 9.5s — it IS the latch').toHaveText('Sure? (2)');
  await expect(page.locator('.lg-stask'), 'nothing was thrown away by waiting').toHaveCount(2);

  // And the tap executes; it does not re-arm. The old timer code re-armed here
  // (the capture would survive), which is exactly the assertion that fails on
  // a revert.
  await discard.click();
  await expect(page.getByRole('button', { name: 'Record Meeting' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.lg-stask')).toHaveCount(0);
  await expect(page.locator('.lg-hero-col.rec')).toHaveCount(0);

  expect(counts.insertedTasks, 'zero task inserts').toEqual([]);
  expect(counts.insertedProjects, 'zero project inserts').toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/home');

  await context.close();
});
