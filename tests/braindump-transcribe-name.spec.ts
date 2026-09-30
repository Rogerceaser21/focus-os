/**
 * Transcribe-audio function NAME regression (2026-09-30).
 *
 * The bug: BrainDumpDialog, TaskOnlyBrainDumpDialog and TodayBrainDumpDialog
 * invoked the edge function `focusos-focusos-transcribe-audio` (doubled prefix),
 * which does not exist live (POST returned 404). None of the three was imported
 * anywhere (Brain Dump is BrainDumpLiveDialog now), so they were unreachable
 * dead code and were deleted. The one live caller of the transcribe function is
 * HandoffToAIDialog ("Dictate"), which uses the real name.
 *
 * What this guards, network only (no real transcribe call, no OpenAI, no real
 * Supabase; hermetic env shared with the other braindump specs):
 *   1. A live dictation sends its audio to EXACTLY .../functions/v1/focusos-transcribe-audio,
 *      as { audio: <base64> }, and the dialog USES the returned { text }.
 *   2. Nothing in the run ever calls the doubled name.
 *   3. The doubled name cannot come back in src/ (source scan, same failure
 *      the network guard would only see once a screen was mounted again).
 *
 * WHAT THIS RIG CANNOT PROVE: it is desktop Chromium with Chromium's fake mic
 * (a synthetic beep stream), not a real microphone, not iOS Safari. The
 * function's own response is mocked, so it says nothing about OpenAI/Whisper
 * or about the pending approval-gate JWT check on the live function.
 */
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCounts, installIntercepts, seedSession } from './helpers/braindumpEnv';

const REAL_NAME = 'focusos-transcribe-audio';
const DOUBLED_NAME = 'focusos-focusos-transcribe-audio';
const TRANSCRIPT = 'Remember to renew the projector lamp before Monday';

// The Handoff button is desktop-only (!isMobile) and the mic needs Chromium's
// fake device, so this spec overrides the suite's mobile-touch defaults.
test.use({
  viewport: { width: 1280, height: 900 },
  hasTouch: false,
  isMobile: false,
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('Dictate sends audio to focusos-transcribe-audio and uses the text; the doubled name is never called', async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const context = await browser.newContext({
    timezoneId: 'UTC',
    permissions: ['microphone'],
    viewport: { width: 1280, height: 900 },
  });
  const counts = createCounts();
  await installIntercepts(context, counts);

  // Registered AFTER installIntercepts, so these win over its catch-all
  // '**/functions/v1/**' handler (Playwright runs the latest matching route first).
  const realCalls: { method: string; body: any; authorization: string | undefined; apikey: string | undefined }[] = [];
  await context.route(`**/functions/v1/${REAL_NAME}`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    realCalls.push({
      method: req.method(),
      body: req.postDataJSON(),
      authorization: req.headers()['authorization'],
      apikey: req.headers()['apikey'],
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: TRANSCRIPT }),
    });
  });

  // Counted at the context level: any request at all whose URL carries the doubled name.
  const doubledCalls: string[] = [];
  context.on('request', (req) => {
    if (req.url().includes(DOUBLED_NAME)) doubledCalls.push(`${req.method()} ${req.url()}`);
  });
  const allFunctionCalls: string[] = [];
  context.on('request', (req) => {
    const m = req.url().match(/\/functions\/v1\/([^/?]+)/);
    if (m) allFunctionCalls.push(m[1]);
  });

  const page = await context.newPage();
  await seedSession(page);
  await page.goto('/app');

  // Open the Handoff dialog on a baseline task row (desktop hover-reveal button).
  const row = page.locator('h3:visible', { hasText: 'Baseline task alpha' }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.hover();
  await page.getByRole('button', { name: 'Hand off to AI' }).locator('visible=true').first().click();
  await expect(page.getByRole('button', { name: /Dictate/ })).toBeVisible({ timeout: 10_000 });

  // Record a moment of fake-mic audio, then stop: the dialog transcribes on stop.
  await page.getByRole('button', { name: /Dictate/ }).click();
  await expect(page.getByRole('button', { name: /Stop/ })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Stop/ }).click();

  await expect.poll(() => realCalls.length, { timeout: 15_000, message: 'transcribe was called' }).toBe(1);

  // Exact function, method and request shape (the real function reads { audio }).
  expect(realCalls[0].method).toBe('POST');
  expect(typeof realCalls[0].body.audio, 'body.audio is a base64 string').toBe('string');
  expect(realCalls[0].body.audio.length, 'body.audio is non-empty').toBeGreaterThan(100);
  expect(Object.keys(realCalls[0].body), 'body carries only audio').toEqual(['audio']);
  // Approval-gate readiness: supabase.functions.invoke sends the signed-in user's
  // session token as Authorization (the seeded session's access token), not just
  // the anon key. The gate branch will require exactly this header.
  expect(realCalls[0].authorization, 'Authorization header is sent').toMatch(/^Bearer /);
  expect(realCalls[0].apikey, 'anon apikey header is sent').toBeTruthy();

  // The dialog USES the result: the returned text reaches the context box.
  // (The clean-up step's mocked reply is {}, so the dialog falls back to the raw text.)
  await expect(page.locator('textarea').first()).toHaveValue(TRANSCRIPT, { timeout: 15_000 });

  // Nothing ever called the doubled name, and the only transcribe function hit was the real one.
  expect(doubledCalls, 'no request to the doubled name').toEqual([]);
  expect(allFunctionCalls.filter((n) => n.includes('transcribe')), 'the only transcribe call is the real name').toEqual([
    REAL_NAME,
  ]);

  await context.close();
});

test('the doubled function name does not exist anywhere in src/', () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(name) && readFileSync(p, 'utf8').includes(DOUBLED_NAME)) hits.push(p);
    }
  };
  walk(join(process.cwd(), 'src'));
  expect(hits, `files still naming ${DOUBLED_NAME}`).toEqual([]);
});
