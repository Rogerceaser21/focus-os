/**
 * PhoneFrame geometry spec (2026-08-09).
 *
 * braindump is the sample-first gate for the unified CSS PhoneFrame: bezel +
 * screen geometry live in the frame's own classes (Landing.tsx PhoneFrame),
 * not baked into the clip's pixels. This spec pins the frame's computed
 * geometry at the two Tailwind edges that matter (base <640, lg >=1024) and
 * guards that the other eight feature phones — still on the old bezel paths
 * — did not move.
 *
 * Video dims: public/media/clips/braindump.mp4 + -poster.jpg are mid
 * re-render to 780x1688 (390:844, screen-only, no baked bezel). The frame
 * controls the SCREEN's aspect-ratio via CSS (aspectRatio on the screen div),
 * not the file's intrinsic size, so this spec asserts the CONTAINER geometry
 * and never depends on which file happens to be on disk when it runs.
 *
 * HERMETIC-adjacent, unlike the /app suites: Landing ("/") is a public route,
 * no seeded session needed. useAuth() resolves loading=false/user=null from
 * an empty localStorage with no network round trip, so a plain page.goto('/')
 * settles fast.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const MOBILE = { width: 393, height: 852 };
const DESKTOP = { width: 1280, height: 900 };

const FRAME = '[data-testid="phone-frame"]';
const SCREEN = '[data-testid="phone-frame-screen"]';

type Box = { x: number; y: number; width: number; height: number };

async function openLanding(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  // Same touch/isMobile-by-width convention as tests/onebar.spec.ts and
  // tests/movetasks.spec.ts: real touch below the lg breakpoint, none above.
  const touch = viewport.width < 1024;
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator(FRAME)).toBeVisible({ timeout: 15_000 });
  return { context, page };
}

async function requireBox(locator: { boundingBox(): Promise<Box | null> }): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b as Box;
}

// ---------------------------------------------------------------------------
// 1+2+3. Frame geometry at the two breakpoints that matter: base (<640) and
//    lg (>=1024). Outer radius/width, screen radius, screen aspect ratio, and
//    the media never bleeding past the screen box.
// ---------------------------------------------------------------------------
for (const [label, viewport, expected] of [
  ['393x852 (base)', MOBILE, { outerRadius: '48px', screenRadius: '38px', width: 300 }],
  ['1280x900 (lg)', DESKTOP, { outerRadius: '67px', screenRadius: '54px', width: 420 }],
] as const) {
  test(`${label}: braindump PhoneFrame computed geometry`, async ({ browser }) => {
    const { context, page } = await openLanding(browser, viewport);

    const outer = page.locator(FRAME);
    const screen = page.locator(SCREEN);

    // Outer bezel: pixel radius + the min(300px,78vw)/380/420 width band.
    const outerRadius = await outer.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(outerRadius).toBe(expected.outerRadius);
    const outerBox = await requireBox(outer);
    expect(outerBox.width).toBeGreaterThan(expected.width - 2);
    expect(outerBox.width).toBeLessThan(expected.width + 2);

    // Screen: radius = outer radius minus the bezel padding (48-10=38, 67-13=54).
    const screenRadius = await screen.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(screenRadius).toBe(expected.screenRadius);

    // Screen box holds the 390:844 ratio, within 1%.
    const screenBox = await requireBox(screen);
    const ratio = screenBox.width / screenBox.height;
    const target = 390 / 844;
    expect(Math.abs(ratio - target) / target).toBeLessThan(0.01);

    // No bleed: the media fills the screen (object-cover) but never exceeds it.
    const media = page.locator(`${SCREEN} video, ${SCREEN} img`).first();
    const mediaBox = await requireBox(media);
    expect(mediaBox.x).toBeGreaterThanOrEqual(screenBox.x - 1);
    expect(mediaBox.y).toBeGreaterThanOrEqual(screenBox.y - 1);
    expect(mediaBox.x + mediaBox.width).toBeLessThanOrEqual(screenBox.x + screenBox.width + 1);
    expect(mediaBox.y + mediaBox.height).toBeLessThanOrEqual(screenBox.y + screenBox.height + 1);

    await context.close();
  });
}

// ---------------------------------------------------------------------------
// 4. Sample-leak guard: the meetings phone (still baked-bezel, film-crop)
//    must keep its exact current classes — old radius on the media itself,
//    the scale-[1.01] safety margin, 718-wide attrs, no PhoneFrame wrapper.
// ---------------------------------------------------------------------------
test('393x852: meetings phone is untouched by the braindump PhoneFrame sample', async ({ browser }) => {
  const { context, page } = await openLanding(browser, MOBILE);

  // Exactly one PhoneFrame instance exists on the page (braindump only, this
  // wave) — the guard that the sample did not leak onto another section.
  await expect(page.locator(FRAME)).toHaveCount(1);

  const meetingsVideo = page.locator('video[poster*="meetings-poster.jpg"]');
  await expect(meetingsVideo).toHaveCount(1);
  await expect(meetingsVideo).toHaveAttribute('width', '718');
  await expect(meetingsVideo).toHaveAttribute('height', '1342');

  const cls = (await meetingsVideo.getAttribute('class')) ?? '';
  expect(cls).toContain('scale-[1.01]');
  expect(cls).toContain('rounded-[48px]');
  expect(cls).not.toContain('object-cover');

  // Baked-bezel wrapper: overflow-hidden + rounded-[48px], no bezel bg/padding
  // (the film-crop path never gets the #1d232c bezel — it is IN the pixels).
  const wrapperCls = (await meetingsVideo.locator('xpath=..').getAttribute('class')) ?? '';
  expect(wrapperCls).toContain('overflow-hidden');
  expect(wrapperCls).toContain('rounded-[48px]');
  expect(wrapperCls).not.toContain('bg-[#1d232c]');

  await context.close();
});
