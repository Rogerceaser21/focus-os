/**
 * Meeting recording survives navigation (desktop-mouse, 1512x982).
 *
 * Same scenario as tests/meeting-recording-pill.spec.ts, but every pill control
 * is pressed with a REAL page.mouse click at coordinates (after an
 * elementFromPoint probe proving nothing sits on top of the control), the path
 * the touch project never exercises.
 */
import { test } from '@playwright/test';
import { FAKE_MIC_ARGS, bootRig } from './helpers/meetingRecorderEnv';
import {
  mouseClick,
  pillSurvivesNavigationAndStopsFromAnywhere,
  reverseLockoutRefusesMeetingWhileBrainDumpCapturing,
} from './helpers/pillScenario';

test.use({
  timezoneId: 'UTC',
  permissions: ['microphone'],
  launchOptions: { args: FAKE_MIC_ARGS },
});

test('desktop: pill follows a recording across routes with real mouse clicks', async ({ page, context }) => {
  test.setTimeout(120_000);
  const rig = await bootRig(page, context, { tuning: { flushMs: 2000, backoffMs: 200 } });
  await pillSurvivesNavigationAndStopsFromAnywhere(page, rig, mouseClick);
});

test('desktop: starting a meeting recording is refused while the brain dump holds the mic', async ({ page, context }) => {
  test.setTimeout(60_000);
  const rig = await bootRig(page, context);
  await reverseLockoutRefusesMeetingWhileBrainDumpCapturing(page, rig);
});
