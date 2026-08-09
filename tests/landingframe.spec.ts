/**
 * PhoneFrame geometry spec (2026-08-09, extended).
 *
 * All nine feature sections now share the one unified CSS PhoneFrame: bezel +
 * screen geometry live in the frame's own classes (Landing.tsx PhoneFrame),
 * never in per-feature bezel/radius branches. This spec pins the frame's
 * computed geometry at the two Tailwind edges that matter (base <640, lg
 * >=1024) and asserts all 9 instances are identical — no drift, no leftover
 * bezel path.
 *
 * Video dims: public/media/clips/*.mp4 + *-poster.jpg (plus the new collab
 * clip) are mid re-render to 780x1688 (390:844, screen-only, no baked
 * bezel). The frame controls the SCREEN's aspect-ratio via CSS (aspectRatio
 * on the screen div), not the file's intrinsic size or its presence on disk,
 * so this spec asserts the CONTAINER geometry only. Missing clip files/poster
 * 404s during the parallel re-render window must not fail this spec.
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
const FEATURE_COUNT = 9;

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
  await expect(page.locator(FRAME).first()).toBeVisible({ timeout: 15_000 });
  return { context, page };
}

// ---------------------------------------------------------------------------
// Exactly 9 PhoneFrame instances (one per FEATURES entry), all sharing
// identical computed geometry: outer radius/width, screen radius, screen
// aspect ratio, and no bleed of whatever fills the screen (clip video/img,
// or the mcp panel's scaled 390x844 canvas).
// ---------------------------------------------------------------------------
for (const [label, viewport, expected] of [
  ['393x852 (base)', MOBILE, { outerRadius: '48px', screenRadius: '38px', width: 300 }],
  ['1280x900 (lg)', DESKTOP, { outerRadius: '67px', screenRadius: '54px', width: 420 }],
] as const) {
  test(`${label}: all 9 PhoneFrame instances share identical computed geometry`, async ({ browser }) => {
    const { context, page } = await openLanding(browser, viewport);

    await expect(page.locator(FRAME)).toHaveCount(FEATURE_COUNT);

    for (let i = 0; i < FEATURE_COUNT; i++) {
      await page.locator(FRAME).nth(i).scrollIntoViewIfNeeded();

      // Every box (outer, screen, content) and both computed radii are read
      // in one atomic evaluate: two round-trip reads of an in-flow scroll
      // container can straddle a reflow and disagree by a px or two even
      // with no scroll-behavior:smooth in play — one snapshot removes that.
      const rects = await page.evaluate((idx) => {
        const outerEl = document.querySelectorAll('[data-testid="phone-frame"]')[idx] as HTMLElement;
        const screenEl = document.querySelectorAll('[data-testid="phone-frame-screen"]')[idx] as HTMLElement;
        const contentEl = screenEl.querySelector('video, img, div') as HTMLElement | null;
        const box = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        return {
          outerRadius: getComputedStyle(outerEl).borderTopLeftRadius,
          screenRadius: getComputedStyle(screenEl).borderTopLeftRadius,
          outer: box(outerEl),
          screen: box(screenEl),
          content: contentEl ? box(contentEl) : null,
        };
      }, i);

      // Outer bezel: pixel radius + the min(300px,78vw)/380/420 width band.
      expect(rects.outerRadius, `frame ${i} outer radius`).toBe(expected.outerRadius);
      expect(rects.outer.width, `frame ${i} outer width`).toBeGreaterThan(expected.width - 2);
      expect(rects.outer.width, `frame ${i} outer width`).toBeLessThan(expected.width + 2);

      // Screen: radius = outer radius minus the bezel padding (48-10=38, 67-13=54).
      expect(rects.screenRadius, `frame ${i} screen radius`).toBe(expected.screenRadius);

      // Screen box holds the 390:844 ratio, within 1%.
      const screenBox = rects.screen;
      const ratio = screenBox.width / screenBox.height;
      const target = 390 / 844;
      expect(Math.abs(ratio - target) / target, `frame ${i} screen aspect`).toBeLessThan(0.01);

      // No bleed: the screen's own content (video/img for clips, or the mcp
      // panel's scaled canvas div) fills the screen but never exceeds it.
      // querySelector in DOM order always lands on the direct child
      // PhoneFrame was given — nothing else precedes it.
      expect(rects.content, `frame ${i} content exists`).not.toBeNull();
      const contentBox = rects.content as Box;
      expect(contentBox.x, `frame ${i} content x`).toBeGreaterThanOrEqual(screenBox.x - 1);
      expect(contentBox.y, `frame ${i} content y`).toBeGreaterThanOrEqual(screenBox.y - 1);
      expect(contentBox.x + contentBox.width, `frame ${i} content right`).toBeLessThanOrEqual(
        screenBox.x + screenBox.width + 1,
      );
      expect(contentBox.y + contentBox.height, `frame ${i} content bottom`).toBeLessThanOrEqual(
        screenBox.y + screenBox.height + 1,
      );
    }

    await context.close();
  });
}
