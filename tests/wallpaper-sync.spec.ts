// WALLPAPER FOLLOWS THE ACCOUNT (O5, 2026-08-24): end-to-end against the real
// demo account and the real Supabase backend (no mocking), same shape as
// tests/project-rollups.spec.ts and tests/share-status-live.spec.ts:
// DEMO_EMAIL/DEMO_PASSWORD + the /auth sign-in steps, BASE from WAVE_BASE_URL,
// REST writes with the demo account's own session, and a final restore that
// puts focusos_user_preferences.wallpaper_prefs back to null with an ASSERTED
// read-back, so a leak fails the run loudly.
//
// What this proves:
//   (a) picking a wallpaper in Settings sends it to the account. The PATCH body
//       carries wallpaper_prefs, and the row holds it afterwards;
//   (b) a device that has never seen this account (empty localStorage) paints
//       the account's wallpaper once preferences arrive, and caches it locally,
//       so every later load on that device paints it with no network;
//   (c) a device whose local choice is NEWER than the account's keeps its own
//       choice (never a frame of the account's older one) and pushes it up
//       (conflict rule: latest updatedAt wins);
//   (d) a second account signing in on that device does not inherit the first
//       account's wallpaper: a stamp belonging to someone else is not a
//       comparable timestamp, so this account starts on the app default.
//
// The visible trade-off (b) documents on purpose: the FIRST load on a brand-new
// device paints the default until the preferences row arrives, then swaps once
// (the wallpaper sequence below is exactly ['wave', 'starry']). Every later load
// reads the local cache during render and paints the right wallpaper straight
// away, which is why (c)'s sequence is a single entry.
//
// Names, not ids: the Settings tiles read Monet / Hokusai / Van Gogh, while the
// stored ids are lilies / wave / starry (src/lib/wallpaper.tsx WALLPAPERS).
//
// Run: WAVE_BASE_URL=http://localhost:8080 npx playwright test tests/wallpaper-sync.spec.ts
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const BASE = process.env.WAVE_BASE_URL ?? '';

// Same Apple-review demo account the other project specs sign in with.
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

// Same project + publishable key the app ships (src/integrations/supabase/client.ts).
const SUPABASE_URL = 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';

// The demo account as this branch found it. Nothing here creates a project or a
// task; the counts are asserted at both ends so a stray row cannot hide.
const DEMO_PROJECT_COUNT = 9;
const DEMO_TASK_COUNT = 9;

const LS_CHOICE = 'focusos-wallpaper';
const LS_SYNC = 'focusos-wallpaper-sync';
const DEFAULT_PLAIN_COLOR = '#eef1f5';

type WallpaperPrefs = {
  v: number;
  id: string;
  plainColor: string;
  customUrl: string | null;
  customBrightness: number | null;
  customDominant: string | null;
  updatedAt: string;
};

const prefsFor = (id: string, updatedAt: string): WallpaperPrefs => ({
  v: 1,
  id,
  plainColor: DEFAULT_PLAIN_COLOR,
  customUrl: null,
  customBrightness: null,
  customDominant: null,
  updatedAt,
});

// ---- PostgREST helpers, signed in as the demo account ------------------------

interface Session { token: string; userId: string; }

const restSignIn = async (request: APIRequestContext): Promise<Session> => {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  expect(res.ok(), 'REST sign-in as the demo account must succeed').toBeTruthy();
  const body = await res.json();
  expect(body.access_token, 'REST sign-in must return an access token').toBeTruthy();
  return { token: body.access_token, userId: body.user.id };
};

const restHeaders = (s: Session, extra: Record<string, string> = {}) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${s.token}`,
  'Content-Type': 'application/json',
  ...extra,
});

/** Write wallpaper_prefs on the demo row and PROVE the write landed: the
 *  representation the server echoes is what the next assertion reads. */
const restSetPrefs = async (
  request: APIRequestContext,
  s: Session,
  value: WallpaperPrefs | null,
): Promise<WallpaperPrefs | null> => {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/focusos_user_preferences?user_id=eq.${s.userId}`,
    { headers: restHeaders(s, { Prefer: 'return=representation' }), data: { wallpaper_prefs: value } },
  );
  expect(res.ok(), `seeding wallpaper_prefs must succeed (${res.status()})`).toBeTruthy();
  const rows = await res.json();
  expect(rows.length, 'the demo account must have exactly one preferences row').toBe(1);
  return rows[0].wallpaper_prefs ?? null;
};

const restReadPrefs = async (
  request: APIRequestContext,
  s: Session,
): Promise<WallpaperPrefs | null> => {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/focusos_user_preferences?select=wallpaper_prefs&user_id=eq.${s.userId}`,
    { headers: restHeaders(s) },
  );
  expect(res.ok(), `reading wallpaper_prefs must succeed (${res.status()})`).toBeTruthy();
  const rows = await res.json();
  expect(rows.length, 'the demo account must have exactly one preferences row').toBe(1);
  return rows[0].wallpaper_prefs ?? null;
};

/** Exact row count for a table on the demo account (Content-Range, no payload). */
const restCount = async (
  request: APIRequestContext,
  s: Session,
  table: 'focusos_projects' | 'focusos_tasks',
): Promise<number> => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    headers: restHeaders(s, { Prefer: 'count=exact' }),
  });
  expect(res.ok(), `counting ${table} must succeed (${res.status()})`).toBeTruthy();
  const range = res.headers()['content-range'] ?? '';
  const total = Number(range.split('/')[1]);
  expect(Number.isFinite(total), `${table} count must parse from ${range}`).toBeTruthy();
  return total;
};

// ---- Browser helpers --------------------------------------------------------

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 30000 });
};

/** Records every DISTINCT data-wallpaper value <html> ever wears, armed before
 *  the first app script runs, the same MutationObserver proof
 *  tests/custom-wallpaper.spec.ts uses for the no-flash claim. One entry means
 *  the wallpaper never swapped. */
const armWallpaperLogger = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __wpSeq: string[] };
    w.__wpSeq = [];
    const scan = () => {
      const v = document.documentElement?.getAttribute('data-wallpaper');
      if (v && w.__wpSeq[w.__wpSeq.length - 1] !== v) w.__wpSeq.push(v);
    };
    new MutationObserver(scan).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-wallpaper'],
    });
    scan();
  });

const readSequence = (page: Page) =>
  page.evaluate(() => (window as unknown as { __wpSeq: string[] }).__wpSeq);

const readLocal = (page: Page) =>
  page.evaluate(
    ([choice, sync]) => ({
      choice: localStorage.getItem(choice),
      sync: localStorage.getItem(sync),
    }),
    [LS_CHOICE, LS_SYNC],
  );

/** A PATCH of focusos_user_preferences whose body carries this wallpaper id. */
const prefsPatchWithId = (id: string) => (req: { url(): string; method(): string; postDataJSON(): any }) => {
  if (req.method() !== 'PATCH' || !req.url().includes('focusos_user_preferences')) return false;
  try {
    return req.postDataJSON()?.wallpaper_prefs?.id === id;
  } catch {
    return false;
  }
};

// Same engine the rest of the suite runs on. File-level: a channel inside a
// describe would force its own worker, which Playwright refuses.
test.use({ channel: 'chromium' });

// ---- (a) + (c): phone ------------------------------------------------------

test.describe('wallpaper sync (phone)', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('picking a wallpaper in Settings writes it to the account', async ({ page, request }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    // Clean slate: this account has never synced a wallpaper.
    expect(await restSetPrefs(request, s, null)).toBeNull();

    await signIn(page);
    // This device has no wallpaper of its own either, so the first
    // reconciliation claims the account with the default. Let that write land
    // before the pick, so the two writes cannot race for last word.
    await expect
      .poll(async () => (await restReadPrefs(request, s))?.id, { timeout: 20000 })
      .toBe('wave');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const monet = dialog.getByRole('button', { name: 'Monet' });
    await expect(monet).toBeVisible({ timeout: 15000 });

    const patch = page.waitForRequest(prefsPatchWithId('lilies'), { timeout: 20000 });
    await monet.click();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'lilies');

    const body = (await patch).postDataJSON().wallpaper_prefs as WallpaperPrefs;
    expect(body.v).toBe(1);
    expect(body.id).toBe('lilies');
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);

    // The row itself, read back with the demo session, not just the request.
    await expect
      .poll(async () => (await restReadPrefs(request, s))?.id, { timeout: 15000 })
      .toBe('lilies');
  });

  test('a local choice newer than the account wins and is pushed up', async ({ page, request }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const older = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect((await restSetPrefs(request, s, prefsFor('lilies', older)))?.id).toBe('lilies');

    await signIn(page);
    // Let the first reconciliation settle on the account's Monet, so the stamp
    // seeded below is the LAST word on this device, not a race with it.
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'lilies', {
      timeout: 30000,
    });

    // This device then picks Van Gogh AFTER the account's Monet: a stamp of its
    // own, newer, and belonging to this same account.
    const newer = new Date().toISOString();
    await page.evaluate(
      ([choice, sync, id, stamp]) => {
        localStorage.setItem(choice, id);
        localStorage.setItem(sync, stamp);
      },
      [LS_CHOICE, LS_SYNC, 'starry', JSON.stringify({ updatedAt: newer, userId: s.userId })],
    );

    await armWallpaperLogger(page);
    const patch = page.waitForRequest(prefsPatchWithId('starry'), { timeout: 30000 });
    await page.reload();
    await page.waitForURL('**/home', { timeout: 30000 });

    // The account's older Monet never gets a frame.
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'starry');
    const pushed = (await patch).postDataJSON().wallpaper_prefs as WallpaperPrefs;
    expect(pushed.id).toBe('starry');
    expect(pushed.updatedAt).toBe(newer);
    expect(await readSequence(page)).toEqual(['starry']);

    await expect
      .poll(async () => (await restReadPrefs(request, s))?.id, { timeout: 15000 })
      .toBe('starry');
    expect((await restReadPrefs(request, s))?.updatedAt).toBe(newer);
    expect((await readLocal(page)).choice).toBe('starry');
  });

  test('a second account on the same device does not inherit the first one', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    // This account has never chosen a wallpaper…
    expect(await restSetPrefs(request, s, null)).toBeNull();

    await signIn(page);
    // The first reconciliation on an empty device claims it by pushing its
    // (default) state up. Wait for that write to LAND on the row: the local
    // stamp is written before the request is even sent, so watching localStorage
    // would leave an in-flight push to overwrite the reset below.
    await expect
      .poll(async () => (await restReadPrefs(request, s))?.id, { timeout: 20000 })
      .toBe('wave');
    // Now put the account back to "never chose a wallpaper", which is the case
    // under test: a brand-new account signing in on a used device.
    expect(await restSetPrefs(request, s, null)).toBeNull();

    // …but the device is carrying SOMEONE ELSE's choice, stamped with their id.
    await page.evaluate(
      ([choice, sync, id, stamp]) => {
        localStorage.setItem(choice, id);
        localStorage.setItem(sync, stamp);
      },
      [
        LS_CHOICE,
        LS_SYNC,
        'lilies',
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          userId: '00000000-0000-4000-8000-000000000000',
        }),
      ],
    );

    await armWallpaperLogger(page);
    const patch = page.waitForRequest(prefsPatchWithId('wave'), { timeout: 30000 });
    await page.reload();
    await page.waitForURL('**/home', { timeout: 30000 });

    // The other account's Monet is on the device, so it paints first, and is
    // then replaced by this account's own starting point, exactly once.
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'wave', {
      timeout: 30000,
    });
    expect(await readSequence(page)).toEqual(['lilies', 'wave']);
    expect(((await patch).postDataJSON().wallpaper_prefs as WallpaperPrefs).id).toBe('wave');

    const after = await readLocal(page);
    expect(after.choice).toBe('wave');
    // The device now belongs to THIS account.
    expect(JSON.parse(after.sync as string).userId).toBe(s.userId);

    await expect
      .poll(async () => (await restReadPrefs(request, s))?.id, { timeout: 15000 })
      .toBe('wave');
  });
});

// ---- (b): desktop ----------------------------------------------------------

test.describe('wallpaper sync (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test('a device that has never seen this account paints the account wallpaper', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const s = await restSignIn(request);
    const chosen = new Date().toISOString();
    expect((await restSetPrefs(request, s, prefsFor('starry', chosen)))?.id).toBe('starry');

    // Fresh context, so localStorage carries no wallpaper of its own.
    await armWallpaperLogger(page);
    await page.goto(`${BASE}/auth`);
    const before = await readLocal(page);
    expect(before.choice, 'this device must start with no wallpaper cached').toBeNull();
    expect(before.sync, 'this device must start with no sync stamp').toBeNull();

    await signIn(page);

    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'starry', {
      timeout: 30000,
    });
    // The trade-off, asserted rather than described: the default paints first,
    // then ONE swap when the account's row arrives.
    expect(await readSequence(page)).toEqual(['wave', 'starry']);

    // And it is cached, so the next cold start on this device needs no network.
    const after = await readLocal(page);
    expect(after.choice).toBe('starry');
    expect(JSON.parse(after.sync as string)).toEqual({ updatedAt: chosen, userId: s.userId });

    // Applying the account's value must not write it straight back.
    expect((await restReadPrefs(request, s))?.updatedAt).toBe(chosen);
  });
});

// ---- (e): restore ----------------------------------------------------------

test.describe('demo account restore', () => {
  test('wallpaper_prefs goes back to null and the account is otherwise untouched', async ({
    request,
  }) => {
    const s = await restSignIn(request);
    expect(await restSetPrefs(request, s, null)).toBeNull();
    expect(await restReadPrefs(request, s), 'the demo row must end this run unsynced').toBeNull();
    expect(await restCount(request, s, 'focusos_projects')).toBe(DEMO_PROJECT_COUNT);
    expect(await restCount(request, s, 'focusos_tasks')).toBe(DEMO_TASK_COUNT);
  });
});
