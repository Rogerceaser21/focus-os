// "My Photo" custom wallpaper.
//
// The load-bearing claim is a RENDER-PHASE one: a cached custom photo must be
// in the FIRST --wallpaper-url write of a cold start, exactly like a built-in
// URL, never applied by a second post-paint write (house render-phase laws).
// So every wallpaper test here runs behind a MutationObserver armed via
// addInitScript — live before the app's first module executes — that records the
// deduped SEQUENCE of data-wallpaper values and --wallpaper-url values on
// <html>. One entry per list is the proof: no wave-then-photo swap, no flash.
//
// Run: npx playwright test tests/custom-wallpaper.spec.ts
// Default target is the config's own webServer (baseURL); WAVE_BASE_URL may
// point at any localhost dev server serving this branch.
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

const LS_CHOICE = 'focusos-wallpaper';
const LS_PHOTO = 'focusos-custom-wallpaper';
const LS_PHOTO_URL = 'focusos-custom-wallpaper-url';

const WAVE_SRC =
  'https://mshlbsgsyzzfxyxramjj.supabase.co/storage/v1/object/public/wallpapers/great-wave.jpg';

// An 8x8 JPEG. Small enough to inline, real enough for canvas to decode when
// the picker path re-encodes it.
const FIXTURE_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDAooor1DzD/9k=';
const FIXTURE_URI = `data:image/jpeg;base64,${FIXTURE_B64}`;
const FIXTURE_HEAD = FIXTURE_B64.slice(0, 48);
const FIXTURE_BUFFER = Buffer.from(FIXTURE_B64, 'base64');

type WpLog = { wp: string[]; url: string[] };

/** Records every distinct data-wallpaper / --wallpaper-url value ever set on
 *  <html>, from before the first app script to the assertion. */
const armWallpaperLogger = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __wpLog: WpLog };
    w.__wpLog = { wp: [], url: [] };
    const push = (arr: string[], v: string | null) => {
      if (v && (!arr.length || arr[arr.length - 1] !== v)) arr.push(v);
    };
    const scan = () => {
      const el = document.documentElement;
      if (!el) return;
      push(w.__wpLog.wp, el.getAttribute('data-wallpaper'));
      push(w.__wpLog.url, el.style.getPropertyValue('--wallpaper-url') || null);
    };
    // Observe the document node itself: documentElement may not exist yet when
    // an init script runs.
    new MutationObserver(scan).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-wallpaper', 'style'],
    });
    scan();
  });

const readLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __wpLog: WpLog }).__wpLog);

const rootWallpaperVar = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--wallpaper-url').trim()
  );

const bodyLayerImage = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);

const readKeys = (page: Page) =>
  page.evaluate(
    ([choice, photo, url]) => ({
      choice: localStorage.getItem(choice),
      photo: localStorage.getItem(photo),
      url: localStorage.getItem(url),
    }),
    [LS_CHOICE, LS_PHOTO, LS_PHOTO_URL]
  );

/** Seed localStorage on the app's own origin, then arm the logger and reload —
 *  the reload is the cold start under test. */
const coldStartWith = async (page: Page, seed: Record<string, string>) => {
  await page.goto(`${BASE}/auth`);
  await page.evaluate((entries) => {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, seed);
  await armWallpaperLogger(page);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/liquid-glass/);
};

test('cold start paints the cached photo in the first wallpaper write', async ({ page }) => {
  await coldStartWith(page, { [LS_CHOICE]: 'custom', [LS_PHOTO]: FIXTURE_URI });

  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'custom');
  expect(await rootWallpaperVar(page)).toContain(FIXTURE_HEAD);
  // The visible wallpaper layer, not just the variable.
  expect(await bodyLayerImage(page)).toContain('data:image/jpeg;base64');

  // No swap: one wallpaper id and one image, ever.
  const log = await readLog(page);
  expect(log.wp).toEqual(['custom']);
  expect(log.url).toHaveLength(1);
  expect(log.url[0]).toContain(FIXTURE_HEAD);
});

test('custom wears the darkest built-in scrim with the default teal accent', async ({ page }) => {
  await coldStartWith(page, { [LS_CHOICE]: 'custom', [LS_PHOTO]: FIXTURE_URI });

  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      veil: s.getPropertyValue('--wallpaper-veil').trim(),
      background: s.getPropertyValue('--background').trim(),
      primary: s.getPropertyValue('--primary').trim(),
      primaryFg: s.getPropertyValue('--primary-foreground').trim(),
    };
  });
  // Smoke (Van Gogh) material + its scrim…
  expect(tokens.veil).toContain('radial-gradient');
  expect(tokens.background).toBe('228 32% 10%');
  // …and the app's default Hokusai teal accent, not smoke's light blue.
  expect(tokens.primary).toBe('193 81% 31%');
  expect(tokens.primaryFg).toBe('0 0% 100%');
});

test('no photo: the built-in default is untouched', async ({ page }) => {
  await page.goto(`${BASE}/auth`);
  await armWallpaperLogger(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'wave');
  expect(await rootWallpaperVar(page)).toContain('great-wave.jpg');
  const log = await readLog(page);
  expect(log.wp).toEqual(['wave']);
  // Inline-style value, verbatim as the controller writes it (single quotes).
  expect(log.url).toEqual([`url('${WAVE_SRC}')`]);
});

test('a custom choice with no photo left falls back to the built-in default', async ({ page }) => {
  await coldStartWith(page, { [LS_CHOICE]: 'custom' });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'wave');
  const log = await readLog(page);
  expect(log.wp).toEqual(['wave']);
});

test('the uploaded copy paints when the device cache is gone', async ({ page }) => {
  const remote = `${WAVE_SRC}?remote-fallback`;
  await coldStartWith(page, { [LS_CHOICE]: 'custom', [LS_PHOTO_URL]: remote });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'custom');
  const log = await readLog(page);
  expect(log.wp).toEqual(['custom']);
  expect(log.url).toEqual([`url('${remote}')`]);
});

test('the Settings tile picks a photo, keeps it when switching away, and removes it', async ({
  page,
}) => {
  test.setTimeout(90_000);

  // The bucket write is the one leg that would touch production storage: fulfil
  // it locally. Everything else (encode, cache, select, public-URL shape) is the
  // real code path.
  const uploads: string[] = [];
  await page.route('**/storage/v1/object/focusos-task-images/**', async (route) => {
    uploads.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Id: 'test', Key: 'focusos-task-images/test' }),
    });
  });

  await armWallpaperLogger(page);
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const tile = dialog.getByRole('button', { name: 'My Photo' });
  await expect(tile).toBeVisible({ timeout: 15000 });
  // Nothing cached yet, so there is nothing to remove.
  await expect(dialog.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);

  // The tile opens the library (a real file input, hence a real file chooser).
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    tile.click(),
  ]);
  await chooser.setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: FIXTURE_BUFFER });

  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'custom');
  await expect
    .poll(async () => (await readKeys(page)).url, { timeout: 15000 })
    .toContain('/wallpapers/');
  const afterPick = await readKeys(page);
  expect(afterPick.choice).toBe('custom');
  expect(afterPick.photo?.startsWith('data:image/jpeg;base64,')).toBe(true);
  // Path shape the bucket's RLS accepts: the user id leads, wallpapers/ under it.
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(
    /\/storage\/v1\/object\/focusos-task-images\/[0-9a-f-]{36}\/wallpapers\/\d+\.jpg$/
  );
  expect(await rootWallpaperVar(page)).toContain('data:image/jpeg;base64');

  // Switching to a built-in keeps the photo cached…
  await dialog.getByRole('button', { name: 'Hokusai' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'wave');
  expect((await readKeys(page)).photo).toBe(afterPick.photo);
  // …and the tile switches straight back to it, no second file pick.
  await tile.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'custom');

  // Remove clears the cache entry and drops back to the default wallpaper.
  await dialog.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'wave');
  const afterRemove = await readKeys(page);
  expect(afterRemove.photo).toBeNull();
  expect(afterRemove.url).toBeNull();
  await expect(dialog.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
});
