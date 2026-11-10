/**
 * No lost audio (R2): chunk sequencing, flush triggers, crash-recovery mirror.
 *
 * HERMETIC like the pill specs. Cases:
 *   (a) the first upload invoke fails -> the SAME chunkIndex is retried, and the
 *       indices the server accepts are 0,1,2,... with no gap;
 *   (b) a hidden tab (visibilitychange) and pagehide each flush a chunk at once,
 *       even with the periodic flush parked far in the future;
 *   (c) localStorage carries sessionId + startedAt while recording and is cleared
 *       after a successful save;
 *   (d) the recovery banner shows the persisted title and EXACT duration, and the
 *       recovery invoke carries them.
 */
import { test, expect } from '@playwright/test';
import { seedSession } from './helpers/braindumpEnv';
import {
  FAKE_MIC_ARGS,
  bootRig,
  startMeetingRecording,
  spaGo,
  readRecords,
  idbChunkCount,
  SESSION_ID,
} from './helpers/meetingRecorderEnv';

test.use({
  viewport: { width: 393, height: 852 },
  timezoneId: 'UTC',
  permissions: ['microphone'],
  launchOptions: { args: FAKE_MIC_ARGS },
});

const KEY = 'focusos-meeting-recording-sessions';

test('(a) a failed upload retries the same chunkIndex: sequence has no gap', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 1500, backoffMs: 200 }, failFirstUploads: 1 });
  await startMeetingRecording(page);
  await expect.poll(() => rig.uploads.filter((u) => u.ok).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);

  // First call failed with index 0, the retry used index 0 again.
  expect(rig.uploads[0]).toMatchObject({ chunkIndex: 0, ok: false });
  expect(rig.uploads[1]).toMatchObject({ chunkIndex: 0, ok: true });
  const accepted = rig.uploads.filter((u) => u.ok).map((u) => u.chunkIndex);
  expect(accepted).toEqual(accepted.map((_, i) => i));
  // Later chunks never overtook the failed one.
  const firstOk = rig.uploads.findIndex((u) => u.ok);
  expect(rig.uploads.slice(0, firstOk).every((u) => u.chunkIndex === 0)).toBe(true);
});

test('(b) hidden tab and pagehide flush a chunk immediately', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 600_000, backoffMs: 200 } });
  await startMeetingRecording(page);
  await page.waitForTimeout(2500); // let the 1 s recorder slices accumulate
  expect(rig.uploads.length, 'periodic flush is parked, nothing uploaded yet').toBe(0);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => rig.uploads.filter((u) => u.ok).length, { timeout: 10_000 }).toBe(1);

  await page.waitForTimeout(1500);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => rig.uploads.filter((u) => u.ok).length, { timeout: 10_000 }).toBe(2);
  expect(rig.uploads.filter((u) => u.ok).map((u) => u.chunkIndex)).toEqual([0, 1]);
});

test('(c) localStorage mirrors the live session and is cleared after save', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 1500, backoffMs: 200 } });
  await startMeetingRecording(page, 'Mirror me');
  const live = (await readRecords(page))[SESSION_ID];
  expect(live).toMatchObject({ sessionId: SESSION_ID, title: 'Mirror me', pausedMs: 0 });
  expect(typeof live.startedAt).toBe('number');
  expect(Math.abs(Date.now() - live.startedAt)).toBeLessThan(60_000);

  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => rig.processBodies.length, { timeout: 30_000 }).toBe(1);
  await expect
    .poll(async () => Object.keys(await readRecords(page)), { timeout: 10_000 })
    .toEqual([]);
});

test('(d) recovery banner shows the persisted title and exact duration', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context);
  const startedAt = Date.now() - 40 * 60_000;
  await page.addInitScript(
    ({ k, rec }) => localStorage.setItem(k, JSON.stringify({ 'orphan-0001': rec })),
    {
      k: KEY,
      rec: {
        sessionId: 'orphan-0001',
        startedAt,
        title: 'Board review',
        pausedMs: 60_000,
        endedAt: startedAt + 20 * 60_000, // 20 min wall clock - 1 min paused = 19:00 exactly
      },
    },
  );
  await context.route('**/rest/v1/focusos_recording_sessions**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'orphan-0001',
          chunk_count: 3,
          created_at: new Date(startedAt).toISOString(),
          gcs_folder_path: 'zz/orphan-0001',
          mime_type: 'audio/webm',
          status: 'recording',
        },
      ]),
    }),
  );
  await page.goto('/meetings');
  const summary = page.locator('[data-orphan-summary]');
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toContainText('19:00');
  await expect(summary).toContainText('"Board review"');
  await expect(summary).not.toContainText('90s');

  await page.getByRole('button', { name: 'Recover' }).click();
  await expect.poll(() => rig.processBodies.length, { timeout: 20_000 }).toBe(1);
  expect(rig.processBodies[0]).toMatchObject({
    sessionId: 'orphan-0001',
    title: 'Board review',
    durationSeconds: 1140,
  });
});

const assertGapFree = (rig: { uploads: { chunkIndex: number; ok: boolean }[] }) => {
  const accepted = rig.uploads.filter((u) => u.ok).map((u) => u.chunkIndex);
  expect(accepted.length).toBeGreaterThan(0);
  expect(accepted).toEqual(accepted.map((_, i) => i));
};

test('(e) offline at Stop: nothing lost, process-meeting once after the queue drains', async ({ page, context }) => {
  test.setTimeout(90_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 1000, backoffMs: 200 } });
  await startMeetingRecording(page, 'Offline meeting');
  await expect.poll(() => rig.uploads.filter((u) => u.ok).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  rig.offline = true; // wifi down
  await page.waitForTimeout(3500); // several chunks cut while offline
  await page.getByRole('button', { name: 'Stop' }).click();

  // Honest state on the Meetings banner AND on the pill, never "saved".
  // A waiting save becomes a BACKGROUND save: a small status line, not the full screen.
  await expect(page.locator('[data-bg-save-status]')).toContainText('waiting for connection', { timeout: 15_000 });
  await expect(page.locator('[data-bg-save-status]')).toContainText('left');
  await spaGo(page, '/app');
  const pill = page.getByTestId('recording-pill');
  await expect(pill).toHaveAttribute('data-waiting', 'true', { timeout: 15_000 });
  await expect(pill).toContainText('waiting for connection');
  await expect(pill).toContainText('left');
  await page.waitForTimeout(2500);
  expect(rig.processBodies.length, 'process-meeting must NOT run while chunks are unsent').toBe(0);
  expect((await readRecords(page))[SESSION_ID], 'the record must be kept').toBeTruthy();

  rig.offline = false; // wifi back: the online event wakes the retry at once
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => rig.processBodies.length, { timeout: 30_000 }).toBe(1);
  await page.waitForTimeout(1000);
  expect(rig.processBodies.length).toBe(1);
  expect(rig.processBodies[0].sessionId).toBe(SESSION_ID);
  assertGapFree(rig);
  // Every failed attempt retried the SAME index as the chunk that finally got through.
  const firstFail = rig.uploads.find((u) => !u.ok)!;
  expect(rig.uploads.some((u) => u.ok && u.chunkIndex === firstFail.chunkIndex)).toBe(true);
  await expect.poll(async () => Object.keys(await readRecords(page)), { timeout: 10_000 }).toEqual([]);
  await expect(pill).toHaveCount(0, { timeout: 10_000 });
  expect(await idbChunkCount(page, SESSION_ID)).toBe(0);
});

test('(f) reload while chunks are unsent: IndexedDB chunks upload in order and the save finishes', async ({ page, context }) => {
  test.setTimeout(90_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 1000, backoffMs: 200 } });
  rig.offline = true;
  await startMeetingRecording(page, 'Reload me');
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('[data-bg-save-status]')).toContainText('waiting for connection', { timeout: 15_000 });
  await expect.poll(() => idbChunkCount(page, SESSION_ID), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  const stored = await idbChunkCount(page, SESSION_ID);
  expect(rig.processBodies.length).toBe(0);

  // The tab is reloaded (or closed and reopened) with the connection back.
  rig.offline = false;
  const before = rig.uploads.length;
  await page.reload();
  await expect.poll(() => rig.processBodies.length, { timeout: 40_000 }).toBe(1);
  expect(rig.processBodies[0]).toMatchObject({ sessionId: SESSION_ID, title: 'Reload me' });
  const afterReload = rig.uploads.slice(before).filter((u) => u.ok).map((u) => u.chunkIndex);
  expect(afterReload.length).toBe(stored);
  expect(afterReload).toEqual([...afterReload].sort((a, b) => a - b)); // in index order
  expect(afterReload[0]).toBe(0);
  expect(afterReload).toEqual(afterReload.map((_, i) => i)); // and gap-free
  await expect.poll(async () => Object.keys(await readRecords(page)), { timeout: 10_000 }).toEqual([]);
  await expect.poll(() => idbChunkCount(page, SESSION_ID), { timeout: 10_000 }).toBe(0);
});

test('(g) sign-out while recording: mic stopped, pill gone, nothing uploaded afterwards', async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    (window as any).__streams = [];
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const s = await orig(c);
      (window as any).__streams.push(s);
      return s;
    };
  });
  const rig = await bootRig(page, context, { tuning: { flushMs: 1000, backoffMs: 200 } });
  await startMeetingRecording(page, 'Signed out soon');
  await spaGo(page, '/app');
  await expect(page.getByTestId('recording-pill')).toBeVisible({ timeout: 15_000 });
  expect(
    await page.evaluate(() => (window as any).__streams.flatMap((s: MediaStream) => s.getTracks()).some((t: MediaStreamTrack) => t.readyState === 'live')),
  ).toBe(true);

  await page.evaluate(async () => {
    const mod = await import(/* @vite-ignore */ '/src/integrations/supabase/client.ts');
    await mod.supabase.auth.signOut({ scope: 'local' });
  });
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__streams.flatMap((s: MediaStream) => s.getTracks()).every((t: MediaStreamTrack) => t.readyState === 'ended')),
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect(page.getByTestId('recording-pill')).toHaveCount(0);
  await spaGo(page, '/auth');
  await expect(page.getByTestId('recording-pill')).toHaveCount(0);

  const uploadsAtSignOut = rig.uploads.length;
  await page.waitForTimeout(3000);
  expect(rig.uploads.length, 'no chunk may be uploaded after sign-out').toBe(uploadsAtSignOut);
  expect(rig.processBodies.length).toBe(0);
  const rec = (await readRecords(page))[SESSION_ID];
  expect(rec, 'the session is kept for the same user to resume').toBeTruthy();
  expect(typeof rec.endedAt).toBe('number');
});

test('(h) a permanent server refusal stops the loop and clears the session storage', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 1000, backoffMs: 200 } });
  rig.refuse = 'Session is not in recording state'; // the edge function's real refusal shape
  await startMeetingRecording(page, 'Closed elsewhere');
  await expect.poll(() => rig.uploads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('already closed on the server').first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => Object.keys(await readRecords(page)), { timeout: 10_000 }).toEqual([]);
  await expect.poll(() => idbChunkCount(page, SESSION_ID), { timeout: 10_000 }).toBe(0);
  const n = rig.uploads.length;
  await page.waitForTimeout(3000);
  expect(rig.uploads.length, 'the retry loop must have stopped').toBe(n);
  expect(rig.processBodies.length).toBe(0);
  await expect(page.locator('[data-bg-save-status]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /New Meeting/ })).toBeVisible();
});

test('(i) two tabs, one session: process-meeting runs exactly once', async ({ page, context }) => {
  test.setTimeout(90_000);
  const tuning = { flushMs: 1000, backoffMs: 200 };
  const rig = await bootRig(page, context, { tuning });
  await startMeetingRecording(page, 'Two tabs');
  await page.waitForTimeout(500);
  rig.offline = true;
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('[data-bg-save-status]')).toContainText('waiting for connection', { timeout: 15_000 });

  // A second tab of the same browser opens while the first still owns the save.
  const page2 = await context.newPage();
  await seedSession(page2);
  await page2.addInitScript((t) => ((window as any).__meetingRecorderTuning = t), tuning);
  await page2.goto('/home');
  await page2.waitForTimeout(2500);
  await expect(page2.getByTestId('recording-pill'), 'tab 2 must not show tab 1 save as its own').toHaveCount(0);

  rig.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page2.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => rig.processBodies.length, { timeout: 30_000 }).toBe(1);
  await page.waitForTimeout(3500);
  expect(rig.processBodies.length, 'exactly one process-meeting call').toBe(1);
  expect(rig.transcribeBodies.length).toBe(1);
});

test('(j) a waiting save is a background save: New Meeting works, a second recording starts, and the first finishing does not navigate', async ({ page, context }) => {
  test.setTimeout(90_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 1000, backoffMs: 200 } });
  rig.processStatus = 'done'; // the legacy sync flow, which used to navigate to the detail page
  await startMeetingRecording(page, 'First');
  await page.waitForTimeout(500);
  rig.offline = true;
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('[data-bg-save-status]')).toContainText('waiting for connection', { timeout: 15_000 });
  await expect(page.locator('[data-processing-banner-label]')).toHaveCount(0);

  // New Meeting is usable and a second recording can start while the first waits.
  await page.getByRole('button', { name: /New Meeting/ }).click();
  const input = page.getByPlaceholder('Enter meeting name (required)');
  await input.fill('Second');
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.getByText('Recording...').first()).toBeVisible({ timeout: 15_000 });
  expect(rig.startCalls).toBe(2);
  expect(Object.keys(await readRecords(page)).length).toBe(2);

  // The first save finishes while the second recording runs: no navigation, no hijack.
  rig.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => rig.processBodies.length, { timeout: 30_000 }).toBe(1);
  expect(rig.processBodies[0].sessionId).toBe(SESSION_ID);
  await page.waitForTimeout(1500);
  expect(page.url(), 'must not jump to the finished meeting').not.toContain('/meetings/meeting-pill');
  await expect(page.getByText('Recording...').first()).toBeVisible();
});

test('(k) Discard clears the session record and its unsent chunks', async ({ page, context }) => {
  test.setTimeout(60_000);
  await bootRig(page, context);
  const startedAt = Date.now() - 40 * 60_000;
  await page.addInitScript(
    ({ k, rec }) => localStorage.setItem(k, JSON.stringify({ 'orphan-0002': rec })),
    { k: KEY, rec: { sessionId: 'orphan-0002', startedAt, title: 'Drop me', pausedMs: 0 } },
  );
  await context.route('**/rest/v1/focusos_recording_sessions**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'orphan-0002', chunk_count: 2, created_at: new Date(startedAt).toISOString(), gcs_folder_path: 'zz/o2', mime_type: 'audio/webm', status: 'recording' },
          ]),
        })
      : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/meetings');
  await expect(page.locator('[data-orphan-summary]')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    const store = await import(/* @vite-ignore */ '/src/lib/meetingChunkStore.ts');
    await store.putChunk('orphan-0002', 0, new Blob(['leftover']));
  });
  expect(await idbChunkCount(page, 'orphan-0002')).toBe(1);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect.poll(() => idbChunkCount(page, 'orphan-0002'), { timeout: 10_000 }).toBe(0);
  expect(Object.keys(await readRecords(page))).toEqual([]);
});
