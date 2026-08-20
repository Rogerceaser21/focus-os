// Warm-return regression (Igor, 2026-08-19): after 30min-2h backgrounded, iOS
// reclaims the audio session; the page-lifetime AudioContext comes back parked
// and resume() can hang FOREVER (never settles), silently freezing the awaited
// engineStartCapture inside the orb tap. The fix is a bounded resume plus a
// replace-on-wedge ladder in startCapture (src/lib/brainDumpAudio.ts) — this
// spec wedges the first AudioContext exactly that way and requires capture to
// come up on a replacement context within the same click.
//
// Companion: the ?debug=1 overlay is query-gated, and the iOS shell has no URL
// bar — flagEnabled() now falls back to localStorage (focusos-flag-debug),
// written by the Settings "Voice debug overlay" switch. Tested cold-load here.
//
// Run: npx playwright test tests/braindump-resume.spec.ts
import { test, expect } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// The audioprobe harness needs a real (fake-device) getUserMedia. The
// AudioServiceSandbox disable is load-bearing: headless Chromium's sandboxed
// audio service hangs fake-device getUserMedia forever on macOS (probed
// 2026-08-19 — resolves headed or with the sandbox off).
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

/** Wedge the FIRST AudioContext the page creates: state pinned to 'suspended',
 *  resume() never settles — the reclaimed-session behaviour, minus the wait. */
const wedgeFirstContext = () => {
  const Real = window.AudioContext;
  let first = true;
  (window as unknown as { AudioContext: unknown }).AudioContext = class extends Real {
    private __wedged = false;
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      if (first) { first = false; this.__wedged = true; }
    }
    get state(): AudioContextState {
      return this.__wedged ? 'suspended' : (super.state as AudioContextState);
    }
    resume(): Promise<void> {
      if (this.__wedged) return new Promise<void>(() => { /* never settles */ });
      return super.resume();
    }
  };
};

test('a wedged AudioContext is replaced inside the tap and capture starts', async ({ page }) => {
  await page.addInitScript(wedgeFirstContext);
  await page.goto(`${BASE}/dev/braindump-repro?audioprobe=1`);
  await expect(page.getByTestId('audioprobe-ready')).toBeVisible();

  await page.getByTestId('audioprobe-start').click();

  // The ladder: bounded resume (1.5s) fails -> context replaced -> capturing.
  await expect
    .poll(async () => {
      const raw = await page.getByTestId('audioprobe-snap').textContent();
      try { return JSON.parse(raw ?? '{}'); } catch { return {}; }
    }, { timeout: 15000 })
    .toMatchObject({ contextRecreates: 1, ctxState: 'running', capturing: true });

  await expect(page.getByTestId('audioprobe-error')).toHaveText('');
});

test('the debug overlay obeys the localStorage flag and the Settings switch writes it', async ({ page }) => {
  // Init scripts re-run on every navigation — set-if-absent so the mid-test
  // '0' write survives the reload below.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('focusos-flag-debug') === null) {
        localStorage.setItem('focusos-flag-debug', '1');
      }
    } catch { /* ignore */ }
  });

  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });

  // No ?debug=1 anywhere in the URL — localStorage alone lights the overlay.
  await expect(page.getByTestId('bd-debug-overlay')).toBeVisible({ timeout: 15000 });

  // Flag off -> a reload extinguishes it (same key the Settings switch writes).
  await page.evaluate(() => localStorage.setItem('focusos-flag-debug', '0'));
  await page.reload();
  await page.waitForURL('**/home');
  await expect(page.getByTestId('bd-debug-overlay')).toHaveCount(0);

  // The Settings switch is the shell's writer for that key.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Voice debug overlay' });
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await toggle.click();
  expect(await page.evaluate(() => localStorage.getItem('focusos-flag-debug'))).toBe('1');
});
