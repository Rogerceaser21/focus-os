// Warm-return hardening (Igor's phone, 2026-08-20/21): after a long background
// stay, brain dump died on the REAL device while every v60 signal looked fine.
// The 40-min iOS 26 sim soak could not reproduce it (the sim never loses its
// audio session), so this spec stages the real-device failure classes
// directly in the engine and the hook, and requires the new behaviour:
//   - a context that will not run, even after replacement, FAILS LOUDLY
//     (AudioEngineError) and leaves the engine reset — never a silent
//     "Listening…" over a dead pipe;
//   - getUserMedia and addModule are bounded (a hang names its step);
//   - a long hidden stay discards the page-lifetime context so the next tap
//     is the cold-start path;
//   - the hook's dead-audio watchdog resets + retries once, then lands the
//     user on the restart surface with a Reload action.
// Rig: Chromium fake device. WHAT IT CANNOT PROVE: that iOS actually takes
// these paths — it proves the code does the right thing WHEN it does.
// Run: npx playwright test tests/braindump-warm-return.spec.ts
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--disable-features=AudioServiceSandbox',
    ],
  },
});

const snapshot = (page: Page) =>
  expect.poll(async () => {
    const raw = await page.getByTestId('audioprobe-snap').textContent();
    try { return JSON.parse(raw ?? '{}'); } catch { return {}; }
  }, { timeout: 15000 });

/** EVERY context: resume() resolves, but the state never becomes 'running'
 *  (WebKit's post-interruption 'interrupted', minus the phone). */
const deadContexts = () => {
  const Real = window.AudioContext;
  (window as unknown as { AudioContext: unknown }).AudioContext = class extends Real {
    get state(): AudioContextState { return 'interrupted' as AudioContextState; }
    resume(): Promise<void> { return Promise.resolve(); }
  };
};

test.describe('engine (audioprobe harness)', () => {
  test('a context that will not run fails loudly and resets the engine', async ({ page }) => {
    await page.addInitScript(deadContexts);
    await page.goto(`${BASE}/dev/braindump-repro?audioprobe=1`);
    await expect(page.getByTestId('audioprobe-ready')).toBeVisible();

    await page.getByTestId('audioprobe-start').click();

    await expect(page.getByTestId('audioprobe-error')).toContainText("replacement context stuck in 'interrupted'", { timeout: 15000 });
    await snapshot(page).toMatchObject({
      contextRecreates: 1,
      engineResets: 1,
      lastResetReason: 'context-dead',
      ctxState: 'none',
      capturing: false,
      step: 'idle',
    });
  });

  test('a microphone that never answers is bounded and names its step', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __bdAudioTuning: unknown }).__bdAudioTuning = { micTimeoutMs: 1000 };
      navigator.mediaDevices.getUserMedia = () => new Promise(() => { /* never */ });
    });
    await page.goto(`${BASE}/dev/braindump-repro?audioprobe=1`);
    await expect(page.getByTestId('audioprobe-ready')).toBeVisible();

    await page.getByTestId('audioprobe-start').click();
    // Mid-hang the overlay snapshot points at the step.
    await snapshot(page).toMatchObject({ step: 'mic' });
    await expect(page.getByTestId('audioprobe-error')).toContainText('microphone did not answer within 1000ms', { timeout: 10000 });
    await snapshot(page).toMatchObject({ step: 'idle', capturing: false, lastError: 'mic: microphone did not answer within 1000ms' });
  });

  test('a hung worklet load falls back to the ScriptProcessor path', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __bdAudioTuning: unknown }).__bdAudioTuning = { workletTimeoutMs: 500 };
      AudioWorklet.prototype.addModule = () => new Promise(() => { /* never */ });
    });
    await page.goto(`${BASE}/dev/braindump-repro?audioprobe=1`);
    await expect(page.getByTestId('audioprobe-ready')).toBeVisible();

    await page.getByTestId('audioprobe-start').click();
    await snapshot(page).toMatchObject({ capturing: true, worklet: false, ctxState: 'running' });
    await expect(page.getByTestId('audioprobe-error')).toHaveText('');
    await expect.poll(async () => Number(await page.getByTestId('audioprobe-chunks').textContent()), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('a long hidden stay discards the context; the next tap is a cold start', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __bdAudioTuning: unknown }).__bdAudioTuning = { longGapMs: 1000 };
      // Drive document.visibilityState from the test.
      let vis: DocumentVisibilityState = 'visible';
      Object.defineProperty(document, 'visibilityState', { get: () => vis, configurable: true });
      (window as unknown as { __setVisibility: (v: DocumentVisibilityState) => void }).__setVisibility = (v) => {
        vis = v;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    await page.goto(`${BASE}/dev/braindump-repro?audioprobe=1`);
    await expect(page.getByTestId('audioprobe-ready')).toBeVisible();

    await page.getByTestId('audioprobe-start').click();
    await snapshot(page).toMatchObject({ capturing: true, ctxState: 'running', captureStarts: 1 });
    await page.getByTestId('audioprobe-stop').click();
    await snapshot(page).toMatchObject({ capturing: false, ctxState: 'running' });

    // Short stay: context kept (the page-lifetime rule still holds).
    await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility('hidden'));
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility('visible'));
    await snapshot(page).toMatchObject({ ctxState: 'running', engineResets: 0 });

    // Long stay: context discarded.
    await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility('hidden'));
    await page.waitForTimeout(1300);
    await page.evaluate(() => (window as unknown as { __setVisibility: (v: string) => void }).__setVisibility('visible'));
    await snapshot(page).toMatchObject({ ctxState: 'none', engineResets: 1, lastResetReason: 'long-background' });

    // And the next tap builds a fresh, running one.
    await page.getByTestId('audioprobe-start').click();
    await snapshot(page).toMatchObject({ capturing: true, ctxState: 'running', captureStarts: 2 });
  });
});

test.describe('hook (mocklive + real audio engine)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __mockLiveSession: boolean }).__mockLiveSession = true;
      (window as unknown as { __bdAudioTuning: unknown }).__bdAudioTuning = { noAudioMs: 800 };
    });
  });

  test('a silent pipe is reset and retried once, then lands on the restart surface', async ({ page }) => {
    // No samples ever reach the graph: the source node's connect is a no-op.
    await page.addInitScript(() => {
      MediaStreamAudioSourceNode.prototype.connect = function () { return undefined as unknown as AudioNode; };
    });
    await page.goto(`${BASE}/dev/braindump-repro?mocklive=1&realaudio=1`);
    await expect(page.getByTestId('transport-ready')).toBeVisible();

    await page.getByTestId('transport-start').click();
    await expect(page.getByTestId('transport-state')).toHaveText('listening');

    await expect(page.getByTestId('transport-state')).toHaveText('error', { timeout: 10000 });
    const debug = await page.evaluate(() => {
      const d = (window as unknown as { __bdDebug: { noAudioRecoveries: number; audio: () => { engineResets: number; capturing: boolean } } }).__bdDebug;
      return { recoveries: d.noAudioRecoveries, ...d.audio() };
    });
    expect(debug.recoveries).toBe(1);
    expect(debug.engineResets).toBeGreaterThanOrEqual(1);
    expect(debug.capturing).toBe(false);
    await expect(page.getByText('Voice needs a restart')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  });

  test('a muted track counts as dead audio', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(MediaStreamTrack.prototype, 'muted', { get: () => true, configurable: true });
    });
    await page.goto(`${BASE}/dev/braindump-repro?mocklive=1&realaudio=1`);
    await expect(page.getByTestId('transport-ready')).toBeVisible();

    await page.getByTestId('transport-start').click();
    await expect(page.getByTestId('transport-state')).toHaveText('error', { timeout: 10000 });
    await expect(page.getByText('Voice needs a restart')).toBeVisible();
  });

  test('a healthy pipe is left alone by the watchdog', async ({ page }) => {
    await page.goto(`${BASE}/dev/braindump-repro?mocklive=1&realaudio=1`);
    await expect(page.getByTestId('transport-ready')).toBeVisible();

    await page.getByTestId('transport-start').click();
    await expect(page.getByTestId('transport-state')).toHaveText('listening');
    await page.waitForTimeout(2500); // three watchdog windows
    await expect(page.getByTestId('transport-state')).toHaveText('listening');
    const recoveries = await page.evaluate(() => (window as unknown as { __bdDebug: { noAudioRecoveries: number } }).__bdDebug.noAudioRecoveries);
    expect(recoveries).toBe(0);
    await page.getByTestId('transport-stop').click();
  });
});
