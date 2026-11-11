/**
 * Native meeting recorder bridge (iOS shell, R3) — mobile-touch, 393x852.
 *
 * Inside the shell build the recording runs natively (NativeRecorder.swift) and the
 * web recorder (src/lib/meetingRecorder.ts) only sends commands and mirrors events
 * into the SAME snapshot. HERMETIC: the shell flags and a FAKE
 * window.webkit.messageHandlers.recorder are injected before the page loads; the
 * test plays native by calling window.__focusosNativeRecorder.onEvent(...).
 *
 * What this rig cannot prove: real AVAudioEngine capture, AAC/ADTS bytes, native
 * upload, background survival. Those need the iOS Simulator / device.
 */
import { test, expect } from '@playwright/test';
import { bootRig, spaGo, startMeetingRecording, SESSION_ID, MEETING_ID } from './helpers/meetingRecorderEnv';
import { mouseClick } from './helpers/pillScenario';

test.use({ viewport: { width: 393, height: 852 }, timezoneId: 'UTC' });

async function installFakeNative(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__FOCUSOS_SHELL__ = true;
    w.__FOCUSOS_SHELL_REC__ = true;
    w.__recMsgs = [];
    w.__gumCalls = 0;
    w.__mrCount = 0;
    const md = navigator.mediaDevices || ({} as any);
    md.getUserMedia = async () => {
      w.__gumCalls += 1;
      throw new DOMException('blocked in test', 'NotAllowedError');
    };
    try {
      Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true });
    } catch {
      /* already present */
    }
    w.MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
      constructor() {
        w.__mrCount += 1;
      }
    };
    const emit = (e: any) => w.__focusosNativeRecorder?.onEvent({ at: Date.now(), ...e });
    // The fake keeps its "native" state across page reloads, like real native does.
    const load = () => JSON.parse(sessionStorage.getItem('__fakeNative') || 'null');
    const save = (v: any) => sessionStorage.setItem('__fakeNative', JSON.stringify(v));
    let st: { sessionId: string; startedAt: number; pausedMs: number; pausedAt: number | null; recording?: boolean } =
      load() || { sessionId: '', startedAt: 0, pausedMs: 0, pausedAt: null };
    w.__nativeEmit = emit;
    w.webkit = {
      messageHandlers: {
        recorder: {
          postMessage(b: any) {
            w.__recMsgs.push(JSON.parse(JSON.stringify(b)));
            if (b.cmd === 'ready' && st.recording) {
              setTimeout(
                () => emit({ type: 'state', state: 'recording', sessionId: st.sessionId, startedAt: st.startedAt, pausedMs: st.pausedMs }),
                10,
              );
            } else if (b.cmd === 'start') {
              if (localStorage.getItem('__fakeNoStart')) return; // the mic prompt never answers
              st = { sessionId: b.sessionId, startedAt: Date.now(), pausedMs: 0, pausedAt: null, recording: true };
              save(st);
              setTimeout(() => {
                emit({ type: 'started', sessionId: st.sessionId, startedAt: st.startedAt, pausedMs: 0 });
                emit({ type: 'state', state: 'recording', sessionId: st.sessionId, startedAt: st.startedAt, pausedMs: 0 });
              }, 20);
            } else if (b.cmd === 'pause') {
              st.pausedAt = Date.now();
              setTimeout(
                () => emit({ type: 'state', state: 'paused', sessionId: st.sessionId, startedAt: st.startedAt, pausedMs: st.pausedMs, pausedAt: st.pausedAt }),
                10,
              );
            } else if (b.cmd === 'resume') {
              st.pausedMs += Date.now() - (st.pausedAt || Date.now());
              st.pausedAt = null;
              setTimeout(
                () => emit({ type: 'state', state: 'recording', sessionId: st.sessionId, startedAt: st.startedAt, pausedMs: st.pausedMs }),
                10,
              );
            }
            else if (b.cmd === 'stop' || b.cmd === 'discard') {
              st.recording = false;
              save(st);
            }
            // stop: native answers later, driven by the test.
          },
        },
      },
    };
  });
}

const msgs = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__recMsgs as any[]);
const emit = (page: import('@playwright/test').Page, e: any) =>
  page.evaluate((ev) => (window as any).__nativeEmit(ev), e);

test('native recorder: start posts auth, pill survives routes, interruption shows, stop waits for native', async ({ page, context }) => {
  test.setTimeout(90_000);
  await installFakeNative(page);
  const rig = await bootRig(page, context);
  await startMeetingRecording(page, 'Native sync');

  // start posted with the session id and the auth native needs to upload by itself
  let m = await msgs(page);
  expect(m.some((x) => x.cmd === 'ready')).toBe(true);
  const start = m.find((x) => x.cmd === 'start');
  expect(start.sessionId).toBe(SESSION_ID);
  expect(typeof start.accessToken).toBe('string');
  expect(start.supabaseUrl).toMatch(/^https:\/\/.+\.supabase\.co$/);
  expect(typeof start.anonKey).toBe('string');
  expect(typeof start.userId).toBe('string');
  expect(rig.startBodies[0].mimeType).toBe('audio/aac');

  // the web MediaRecorder / getUserMedia path is NOT used
  expect(await page.evaluate(() => (window as any).__gumCalls)).toBe(0);
  expect(await page.evaluate(() => (window as any).__mrCount)).toBe(0);

  // pill shows and survives navigation
  await spaGo(page, '/app');
  const pill = page.getByTestId('recording-pill');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill).toHaveAttribute('data-phase', 'recording');
  await spaGo(page, '/home');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('data-phase', 'recording');

  // user Pause / Resume round-trips through native
  await mouseClick(page, page.getByTestId('recording-pill-pause'));
  await expect(pill).toHaveAttribute('data-phase', 'paused');
  expect((await msgs(page)).some((x) => x.cmd === 'pause')).toBe(true);
  await mouseClick(page, page.getByTestId('recording-pill-resume'));
  await expect(pill).toHaveAttribute('data-phase', 'recording');
  await page.waitForTimeout(150); // let the fake native's confirmation land first (real native is ordered)

  // a call interrupts: pill shows Interrupted; native resumes: back to recording
  await emit(page, { type: 'chunkSaved', sessionId: SESSION_ID, index: 0 });
  await emit(page, { type: 'interrupted', sessionId: SESSION_ID });
  await expect(pill).toHaveAttribute('data-phase', 'paused');
  await expect(pill).toHaveAttribute('data-interrupted', 'true');
  await expect(pill).toContainText('Interrupted');
  await emit(page, { type: 'resumed', sessionId: SESSION_ID });
  await expect(pill).toHaveAttribute('data-phase', 'recording');
  await expect(pill).not.toHaveAttribute('data-interrupted', 'true');

  // a token refresh pushes a fresh token to native
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.endsWith('-auth-token'))!;
    const s = JSON.parse(localStorage.getItem(k)!);
    s.expires_at = Math.floor(Date.now() / 1000) + 5;
    localStorage.setItem(k, JSON.stringify(s));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(async () => (await msgs(page)).filter((x) => x.cmd === 'setAuth' && x.accessToken === 'probe-refreshed').length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  // Stop: native is told, process-meeting does NOT run until native says everything is uploaded
  await emit(page, { type: 'chunkSaved', sessionId: SESSION_ID, index: 1 });
  await mouseClick(page, page.getByTestId('recording-pill-stop'));
  expect((await msgs(page)).some((x) => x.cmd === 'stop')).toBe(true);
  await expect(pill).toHaveAttribute('data-phase', 'saving');
  await emit(page, { type: 'state', state: 'idle' });
  await emit(page, { type: 'uploadWaiting', pending: 2, reason: 'signin' });
  await expect(pill).toHaveAttribute('data-waiting', 'true');
  await expect(pill).toContainText('sign-in');
  await page.waitForTimeout(1200);
  expect(rig.processBodies.length).toBe(0);

  await emit(page, { type: 'chunkUploaded', sessionId: SESSION_ID, index: 0 });
  await emit(page, { type: 'chunkUploaded', sessionId: SESSION_ID, index: 1 });
  await page.waitForTimeout(500);
  expect(rig.processBodies.length).toBe(0);

  await emit(page, { type: 'stopped', sessionId: SESSION_ID, lastIndex: 1, allUploaded: true });
  await expect.poll(() => rig.processBodies.length, { timeout: 15_000 }).toBe(1);
  expect(rig.processBodies[0].sessionId).toBe(SESSION_ID);
  expect(rig.processBodies[0].mimeType).toBe('audio/aac');
  expect(rig.processBodies[0].title).toBe('Native sync');
  await expect.poll(() => rig.transcribeBodies.length, { timeout: 10_000 }).toBe(1);
  expect(rig.transcribeBodies[0].meetingId).toBe(MEETING_ID);
  await expect(pill).toHaveCount(0);

  // a duplicate `stopped` never processes twice; native is told to forget the files
  await emit(page, { type: 'stopped', sessionId: SESSION_ID, lastIndex: 1, allUploaded: true });
  await page.waitForTimeout(800);
  expect(rig.processBodies.length).toBe(1);
  expect((await msgs(page)).some((x) => x.cmd === 'forget' && x.sessionId === SESSION_ID)).toBe(true);
});

test('native recorder: a microphone failure shows as Interrupted with its reason, resume clears it', async ({ page, context }) => {
  test.setTimeout(60_000);
  await installFakeNative(page);
  await bootRig(page, context);
  await startMeetingRecording(page, 'Mic fails');
  await spaGo(page, '/app');
  const pill = page.getByTestId('recording-pill');
  await expect(pill).toHaveAttribute('data-phase', 'recording', { timeout: 15_000 });

  // native's watchdog: no audio for 5 s -> paused + interrupted {reason}
  await emit(page, { type: 'interrupted', sessionId: SESSION_ID, reason: 'noAudio' });
  await expect(pill).toHaveAttribute('data-phase', 'paused');
  await expect(pill).toHaveAttribute('data-interrupted', 'true');
  await expect(pill).toHaveAttribute('data-interrupt-reason', 'noAudio');
  await expect(pill).toContainText('mic stopped');
  await expect(page.getByText('Recording paused: the microphone stopped.').first()).toBeVisible();

  // native restarted the engine by itself
  await emit(page, { type: 'resumed', sessionId: SESSION_ID });
  await expect(pill).toHaveAttribute('data-phase', 'recording');
  await expect(pill).not.toHaveAttribute('data-interrupt-reason', /.+/);
});

test('native recorder: a parked session shows the honest message and is never processed', async ({ page, context }) => {
  test.setTimeout(60_000);
  await installFakeNative(page);
  const rig = await bootRig(page, context);
  await startMeetingRecording(page, 'Parked');
  await spaGo(page, '/app');
  const pill = page.getByTestId('recording-pill');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await emit(page, { type: 'chunkSaved', sessionId: SESSION_ID, index: 0 });
  await mouseClick(page, page.getByTestId('recording-pill-stop'));
  await emit(page, { type: 'state', state: 'idle' });
  await emit(page, { type: 'uploadWaiting', pending: 1, reason: 'network' });
  await expect(pill).toHaveAttribute('data-waiting', 'true');

  // native read the session row, saw it is no longer recording, stopped retrying
  await emit(page, { type: 'parked', sessionId: SESSION_ID });
  await expect(page.getByText('Part of this meeting could not be uploaded; it is kept on this device.').first()).toBeVisible();
  await expect(pill).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(rig.processBodies.length).toBe(0);
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('focusos-meeting-recording-sessions') || '{}'));
  expect(rec[SESSION_ID].closed).toBe(true);
});

test('native recorder: a start that times out sends discard and records nothing', async ({ page, context }) => {
  test.setTimeout(60_000);
  await installFakeNative(page);
  await page.addInitScript(() => localStorage.setItem('__fakeNoStart', '1'));
  await bootRig(page, context, { tuning: { nativeStartMs: 1500 } });
  await page.goto('/meetings?new=true');
  const input = page.getByPlaceholder('Enter meeting name (required)');
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await input.fill('Slow prompt');
  await page.getByRole('button', { name: 'Start Recording' }).click();

  await expect.poll(async () => (await msgs(page)).some((x) => x.cmd === 'discard' && x.sessionId === SESSION_ID), {
    timeout: 15_000,
  }).toBe(true);
  await expect(page.getByText('Failed to start recording').first()).toBeVisible();
  await spaGo(page, '/app');
  await expect(page.getByTestId('recording-pill')).toHaveCount(0);
});

test('native recorder: a page reload while native records re-attaches to the live recording', async ({ page, context }) => {
  test.setTimeout(60_000);
  await installFakeNative(page);
  await bootRig(page, context);
  await startMeetingRecording(page, 'Reload me');
  await page.waitForTimeout(1500);

  await page.reload();
  // native replays its state on "ready"; the page rebuilds the snapshot from its own record
  await expect(page.getByText('Recording...').first()).toBeVisible({ timeout: 20_000 });
  await spaGo(page, '/app');
  const pill = page.getByTestId('recording-pill');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill).toHaveAttribute('data-phase', 'recording');
  const m = await msgs(page);
  expect(m.filter((x) => x.cmd === 'ready').length).toBeGreaterThan(0);
  // the elapsed time is the whole recording, not restarted at the reload
  const parts = (await page.getByTestId('recording-pill-time').innerText()).split(':').map(Number);
  expect(parts.reduce((a, n) => a * 60 + n, 0)).toBeGreaterThanOrEqual(1);
  // and it can still be stopped from the pill
  await mouseClick(page, page.getByTestId('recording-pill-stop'));
  expect((await msgs(page)).some((x) => x.cmd === 'stop')).toBe(true);
});
