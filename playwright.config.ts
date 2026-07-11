import { defineConfig } from '@playwright/test';

// Drawer regression harness. Runs a throwaway Vite dev server on 8093 so the
// detached preview server on 8080 is never touched. Mobile viewport + touch so
// page.tap / page.touchscreen dispatch real pointerType:"touch" events — the
// only path that triggers the Radix DismissableLayer deferred-dismiss bug this
// suite guards against.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8093',
    channel: 'chromium',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    trace: 'off',
  },
  projects: [{ name: 'mobile-touch' }],
  webServer: {
    command: 'npm run dev -- --port 8093 --strictPort',
    url: 'http://localhost:8093',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
