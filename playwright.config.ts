import { defineConfig } from '@playwright/test';

// Drawer regression harness. Runs a throwaway Vite dev server on PW_PORT
// (default 8093) so the detached preview server on 8080 is never touched.
//
// Two projects (2026-09-02, desktop-mouse regression wave): the suite was
// single-project mobile-touch (390x844, hasTouch, isMobile) so page.tap /
// page.touchscreen dispatch real pointerType:"touch" events — the only path
// that triggers the Radix DismissableLayer deferred-dismiss bug the original
// suite guards against. That left desktop mouse-pointer paths (hover, plain
// click, no touch) with ZERO coverage, and desktop-only surfaces like the
// project bar's More/Pin actions were never exercised by a real mouse
// profile. desktop-mouse runs only tests/desktop-*.spec.ts, at 1512x982 with
// hasTouch/isMobile off; every other existing spec still runs exactly as
// before under mobile-touch, so the suite count is unchanged plus the new
// desktop specs.
const PORT = process.env.PW_PORT ?? '8093';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chromium',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    trace: 'off',
  },
  projects: [
    { name: 'mobile-touch', testIgnore: /desktop-.*\.spec\.ts/ },
    {
      name: 'desktop-mouse',
      testMatch: /desktop-.*\.spec\.ts/,
      use: { viewport: { width: 1512, height: 982 }, hasTouch: false, isMobile: false },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
