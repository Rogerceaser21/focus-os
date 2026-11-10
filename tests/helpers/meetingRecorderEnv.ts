/**
 * Hermetic meeting-recorder environment (shared by meeting-recording-pill,
 * desktop-meeting-recording-pill and meeting-chunk-safety). Not a *.spec.ts, so
 * Playwright never collects it.
 *
 * No microphone hardware, no real Supabase: the mic is Chromium's fake device
 * (launch flags below), auth is the seeded session from braindumpEnv, and every
 * edge function the recorder touches is route-intercepted and recorded here.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { createCounts, installIntercepts, seedSession } from './braindumpEnv';

export const FAKE_MIC_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];

export const SESSION_ID = 'sess-pill-0001';
export const MEETING_ID = 'meeting-pill-0001';

export interface RecorderRig {
  startCalls: number;
  /** Every upload invoke, in arrival order, with the HTTP outcome the rig returned. */
  uploads: { sessionId: string; chunkIndex: number; ok: boolean; bytes: number }[];
  processBodies: any[];
  transcribeBodies: any[];
  /** First N upload invokes fail with HTTP 500 (set before starting). */
  failFirstUploads: number;
}

export async function bootRig(
  page: Page,
  context: BrowserContext,
  opts?: { tuning?: { flushMs?: number; backoffMs?: number }; failFirstUploads?: number },
): Promise<RecorderRig> {
  const rig: RecorderRig = {
    startCalls: 0,
    uploads: [],
    processBodies: [],
    transcribeBodies: [],
    failFirstUploads: opts?.failFirstUploads ?? 0,
  };
  await seedSession(page);
  if (opts?.tuning) {
    await page.addInitScript((t) => {
      (window as any).__meetingRecorderTuning = t;
    }, opts.tuning);
  }
  await installIntercepts(context, createCounts());

  // Registered AFTER installIntercepts, so these win for edge functions.
  await context.route('**/functions/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('focusos-start-recording-session')) {
      rig.startCalls += 1;
      return json(200, { sessionId: SESSION_ID });
    }
    if (url.includes('focusos-upload-audio-chunk')) {
      const body = req.postDataJSON();
      const failing = rig.uploads.length < rig.failFirstUploads;
      rig.uploads.push({
        sessionId: body.sessionId,
        chunkIndex: body.chunkIndex,
        ok: !failing,
        bytes: (body.audioBase64 || '').length,
      });
      return failing ? json(500, { error: 'rig: upload refused' }) : json(200, {});
    }
    if (url.includes('focusos-process-meeting')) {
      rig.processBodies.push(req.postDataJSON());
      return json(200, { id: MEETING_ID, processing_status: 'transcribing' });
    }
    if (url.includes('focusos-transcribe-meeting')) {
      rig.transcribeBodies.push(req.postDataJSON());
      return json(200, {});
    }
    return json(200, {});
  });
  return rig;
}

/** Client-side navigation: keeps the module-level recorder alive (page.goto would reload). */
export async function spaGo(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** Open /meetings with the new-meeting card, name it and press Start Recording. */
export async function startMeetingRecording(page: Page, name = 'Weekly sync') {
  await page.goto('/meetings?new=true');
  const input = page.getByPlaceholder('Enter meeting name (required)');
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await input.fill(name);
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await page.getByText('Recording...').first().waitFor({ state: 'visible', timeout: 15_000 });
}

/** "m:ss" or "h:mm:ss" -> seconds. */
export function parseTimer(text: string): number {
  const parts = text.trim().split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
