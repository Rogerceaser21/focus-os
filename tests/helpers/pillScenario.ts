/**
 * The recording-pill scenarios, shared by tests/meeting-recording-pill.spec.ts
 * (mobile-touch, 393x852) and tests/desktop-meeting-recording-pill.spec.ts
 * (desktop-mouse, REAL page.mouse clicks at coordinates). Not a *.spec.ts.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { MEETING_ID, SESSION_ID, parseTimer, spaGo, startMeetingRecording, type RecorderRig } from './meetingRecorderEnv';

export type Click = (page: Page, target: Locator) => Promise<void>;

/** Real mouse click at the centre of the element's bounding box. */
export const mouseClick: Click = async (page, target) => {
  await target.waitFor({ state: 'visible' });
  const box = await target.boundingBox();
  if (!box) throw new Error('no bounding box for click target');
  // elementFromPoint proves the point really hits this control (nothing on top).
  const hit = await target.evaluate((el, pt) => {
    const top = document.elementFromPoint(pt.x, pt.y);
    return !!top && (el === top || el.contains(top));
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit, 'click point must land on the control, not on something above it').toBe(true);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/** Touch tap at the element's centre. */
export const touchTap: Click = async (_page, target) => {
  await target.tap();
};

const pillTime = async (page: Page) =>
  parseTimer(await page.getByTestId('recording-pill-time').innerText());

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export async function pillSurvivesNavigationAndStopsFromAnywhere(page: Page, rig: RecorderRig, click: Click) {
  await startMeetingRecording(page, 'Weekly sync');
  const startedWall = Date.now();
  expect(rig.startCalls).toBe(1);

  // Hidden on /meetings itself (the page's own banner shows there).
  await expect(page.getByTestId('recording-pill')).toHaveCount(0);

  // ---- /app: pill present, recorder still recording ----
  await spaGo(page, '/app');
  const pill = page.getByTestId('recording-pill');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill).toHaveAttribute('data-phase', 'recording');

  const t1 = await pillTime(page);
  await page.waitForTimeout(2300);
  const t2 = await pillTime(page);
  expect(t2, 'elapsed must be monotonic and advance').toBeGreaterThan(t1);

  // ---- the pill clears the dock and the FAB (and sits inside the viewport) ----
  const geo = await page.evaluate(() => {
    const r = (el: Element | null) => (el ? (el.getBoundingClientRect().toJSON() as any) : null);
    return {
      pill: r(document.querySelector('[data-testid="recording-pill"]')),
      dock: r(document.querySelector('.lg-dock')),
      fab: r(document.querySelector('[data-tour-step="menu-fab"]')),
      vw: window.innerWidth,
    };
  });
  expect(geo.pill.x).toBeGreaterThanOrEqual(0);
  expect(geo.pill.x + geo.pill.width).toBeLessThanOrEqual(geo.vw);
  if (geo.dock) expect(overlaps(geo.pill, geo.dock), 'pill must not cover the dock').toBe(false);
  if (geo.fab) expect(overlaps(geo.pill, geo.fab), 'pill must not cover the record FAB').toBe(false);

  // ---- /home: pill still there; the brain-dump orb is locked with a hint ----
  await spaGo(page, '/home');
  await expect(pill).toBeVisible();
  const orb = page.getByRole('button', { name: 'Brain dump' });
  await expect(orb).toBeVisible({ timeout: 20_000 });
  await expect(orb).toBeDisabled();
  await expect(page.getByText('Meeting recording in progress').first()).toBeVisible();
  const homeGeo = await page.evaluate(() => {
    const r = (el: Element | null) => (el ? (el.getBoundingClientRect().toJSON() as any) : null);
    return {
      pill: r(document.querySelector('[data-testid="recording-pill"]')),
      orb: r(document.querySelector('.lg-orb')),
      dock: r(document.querySelector('.lg-dock')),
    };
  });
  if (homeGeo.orb) expect(overlaps(homeGeo.pill, homeGeo.orb), 'pill must not cover the orb').toBe(false);
  if (homeGeo.dock) expect(overlaps(homeGeo.pill, homeGeo.dock), 'pill must not cover the dock').toBe(false);

  // ---- pause on the pill freezes the elapsed time; resume continues ----
  await spaGo(page, '/app');
  await expect(pill).toBeVisible();
  await click(page, page.getByTestId('recording-pill-pause'));
  await expect(pill).toHaveAttribute('data-phase', 'paused');
  const p1 = await pillTime(page);
  await page.waitForTimeout(2300);
  const p2 = await pillTime(page);
  expect(p2, 'paused: elapsed must not advance').toBe(p1);
  await click(page, page.getByTestId('recording-pill-resume'));
  await expect(pill).toHaveAttribute('data-phase', 'recording');
  await page.waitForTimeout(1300);
  expect(await pillTime(page)).toBeGreaterThan(p1);

  // ---- elapsed is roughly wall-clock minus the paused stretch (never a tick count) ----
  const wallSeconds = (Date.now() - startedWall) / 1000;
  const shown = await pillTime(page);
  expect(shown).toBeLessThanOrEqual(Math.ceil(wallSeconds));
  expect(shown).toBeGreaterThanOrEqual(Math.floor(wallSeconds - 2.3 - 3));

  // ---- back to /meetings through the pill body: live banner, no pill ----
  await click(page, page.getByTestId('recording-pill-open'));
  await expect(page).toHaveURL(/\/meetings$/);
  await expect(page.getByText('Recording...').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('recording-pill')).toHaveCount(0);
  const bannerTime = parseTimer(
    await page.locator('p.font-mono').filter({ hasText: /^\d+:\d{2}$/ }).first().innerText(),
  );
  expect(bannerTime).toBeGreaterThanOrEqual(shown);

  // ---- stop from the pill on /app: the process invoke fires with the session ----
  await spaGo(page, '/app');
  await expect(pill).toBeVisible();
  await click(page, page.getByTestId('recording-pill-stop'));
  await expect.poll(() => rig.processBodies.length, { timeout: 30_000 }).toBe(1);
  expect(rig.processBodies[0].sessionId).toBe(SESSION_ID);
  expect(rig.processBodies[0].title).toBe('Weekly sync');
  expect(rig.processBodies[0].durationSeconds).toBeGreaterThanOrEqual(shown);
  // Every uploaded index is unique and ordered from 0.
  const idx = rig.uploads.filter((u) => u.ok).map((u) => u.chunkIndex);
  expect(idx.length).toBeGreaterThan(0);
  expect(idx).toEqual(idx.map((_, i) => i));
  await expect.poll(() => rig.transcribeBodies.length, { timeout: 10_000 }).toBe(1);
  expect(rig.transcribeBodies[0]).toEqual({ meetingId: MEETING_ID });
  await expect(page.getByTestId('recording-pill')).toHaveCount(0, { timeout: 10_000 });
}

export async function reverseLockoutRefusesMeetingWhileBrainDumpCapturing(page: Page, rig: RecorderRig) {
  await page.goto('/home');
  await expect(page.getByRole('button', { name: 'Brain dump' })).toBeVisible({ timeout: 20_000 });
  // Hold the brain-dump mic the way the orb does (the same engine module instance).
  await page.evaluate(async () => {
    const mod = await import(/* @vite-ignore */ '/src/lib/brainDumpAudio.ts');
    await mod.startCapture(() => {});
  });
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ '/src/lib/brainDumpAudio.ts')).isCapturing())).toBe(true);

  // The brain-dump hook releases the mic when /home unmounts, so the refusal is
  // exercised on the same page that holds it: ask the recorder to start there.
  const started = await page.evaluate(async () => {
    const rec = await import(/* @vite-ignore */ '/src/lib/meetingRecorder.ts');
    return rec.start({ title: 'Should be refused' });
  });
  expect(started).toBe(false);
  await expect(page.getByText('Brain dump is using the microphone').first()).toBeVisible({ timeout: 10_000 });
  expect(rig.startCalls, 'no recording session may be started').toBe(0);
  await expect(page.getByTestId('recording-pill')).toHaveCount(0);
  await page.evaluate(async () => (await import(/* @vite-ignore */ '/src/lib/brainDumpAudio.ts')).stopCapture());
}
