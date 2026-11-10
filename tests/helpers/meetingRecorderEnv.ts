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
  /** While true EVERY upload invoke fails with HTTP 500 (the wifi is down). */
  offline: boolean;
  /** When set, every upload is refused with this server message (HTTP 500 {error}). */
  refuse: string | null;
  /** processing_status the process-meeting stub answers with. */
  processStatus: string;
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
    offline: false,
    refuse: null,
    processStatus: 'transcribing',
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
      return json(200, { sessionId: rig.startCalls === 1 ? SESSION_ID : `${SESSION_ID}-${rig.startCalls}` });
    }
    if (url.includes('focusos-upload-audio-chunk')) {
      const body = req.postDataJSON();
      if (rig.refuse) {
        rig.uploads.push({ sessionId: body.sessionId, chunkIndex: body.chunkIndex, ok: false, bytes: 0 });
        return json(500, { error: rig.refuse });
      }
      const failing = rig.offline || rig.uploads.length < rig.failFirstUploads;
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
      return json(200, { id: MEETING_ID, processing_status: rig.processStatus });
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

/** Per-session record map the recorder keeps in localStorage. */
export const RECORDS_KEY = 'focusos-meeting-recording-sessions';

export const readRecords = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), RECORDS_KEY);

/** Number of unsent chunks the recorder holds in IndexedDB (for the given session). */
export const idbChunkCount = (page: Page, sessionId: string) =>
  page.evaluate(
    (sid) =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('focusos-meeting-chunks', 1);
        req.onerror = () => resolve(-1);
        req.onupgradeneeded = () => resolve(0);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('chunks')) return resolve(0);
          const r = db.transaction('chunks').objectStore('chunks').index('sessionId').count(sid);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(-1);
        };
      }),
    sessionId,
  );
