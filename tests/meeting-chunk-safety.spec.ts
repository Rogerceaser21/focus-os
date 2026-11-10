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
import { FAKE_MIC_ARGS, bootRig, startMeetingRecording, SESSION_ID } from './helpers/meetingRecorderEnv';

test.use({
  viewport: { width: 393, height: 852 },
  timezoneId: 'UTC',
  permissions: ['microphone'],
  launchOptions: { args: FAKE_MIC_ARGS },
});

const KEY = 'focusos-meeting-recording-session';

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
  const live = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  expect(live).toMatchObject({ sessionId: SESSION_ID, title: 'Mirror me', pausedMs: 0 });
  expect(typeof live.startedAt).toBe('number');
  expect(Math.abs(Date.now() - live.startedAt)).toBeLessThan(60_000);

  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => rig.processBodies.length, { timeout: 30_000 }).toBe(1);
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), KEY), { timeout: 10_000 })
    .toBeNull();
});

test('(d) recovery banner shows the persisted title and exact duration', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context);
  const startedAt = Date.now() - 40 * 60_000;
  await page.addInitScript(
    ({ k, rec }) => localStorage.setItem(k, JSON.stringify(rec)),
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
