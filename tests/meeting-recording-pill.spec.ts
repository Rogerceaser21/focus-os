/**
 * Meeting recording survives navigation (mobile-touch, 393x852).
 *
 * The recorder is a module-level singleton (src/lib/meetingRecorder.ts); the
 * floating RecordingPill follows the recording across routes. HERMETIC: fake
 * microphone (Chromium flags), seeded session, every edge function intercepted
 * (tests/helpers/meetingRecorderEnv.ts). Desktop twin with real mouse clicks:
 * tests/desktop-meeting-recording-pill.spec.ts.
 *
 * What this rig cannot prove: iOS Safari background behaviour, a real wake
 * lock, or a real microphone; it is desktop Chromium at a phone viewport.
 */
import { test } from '@playwright/test';
import { FAKE_MIC_ARGS, bootRig } from './helpers/meetingRecorderEnv';
import {
  pillSurvivesNavigationAndStopsFromAnywhere,
  reverseLockoutRefusesMeetingWhileBrainDumpCapturing,
  touchTap,
  drawerCoversPill,
} from './helpers/pillScenario';

test.use({
  viewport: { width: 393, height: 852 },
  timezoneId: 'UTC',
  permissions: ['microphone'],
  launchOptions: { args: FAKE_MIC_ARGS },
});

test('pill follows a recording across routes: pause, return, stop from /app', async ({ page, context }) => {
  test.setTimeout(120_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 2000, backoffMs: 200 } });
  await pillSurvivesNavigationAndStopsFromAnywhere(page, rig, touchTap);
});

test('starting a meeting recording is refused while the brain dump holds the mic', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context);
  await reverseLockoutRefusesMeetingWhileBrainDumpCapturing(page, rig);
});

test('the open projects drawer covers the pill and owns its taps', async ({ page, context }) => {
  test.setTimeout(60_000);
  await bootRig(page, context);
  await drawerCoversPill(page);
});
