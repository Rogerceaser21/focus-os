import { defineConfig } from '@playwright/test';
const PORT = process.env.PW_PORT ?? '8092';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, workers: 1, reporter: [['list']], timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1512, height: 982 }, hasTouch: false, isMobile: false, trace: 'off' },
  projects: [{ name: 'desktop-mouse', use: { browserName: 'webkit' }, testMatch: /desktop-.*\.spec\.ts/ }],
  webServer: { command: `npm run dev -- --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 120_000 },
});
