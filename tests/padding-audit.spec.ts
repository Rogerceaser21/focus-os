/**
 * PADDING AUDIT HARNESS — task 611ad2fc (padding congruency sweep).
 * READ-ONLY instrumentation: measures computed paddings/gutters/gaps on every
 * shell surface at desktop + mobile widths and screenshots each view.
 * NOT part of the regression suite: gated behind PADAUDIT=1. No app code touched.
 *
 * Run:
 *   PADAUDIT=1 npx playwright test tests/padding-audit.spec.ts
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.skip(!process.env.PADAUDIT, 'padding audit harness — run with PADAUDIT=1');

const EVIDENCE_DIR = path.join('test-results', 'padding-audit');

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const TASK_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

function todayNoonIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

const taskRow = () => ({
  id: TASK_ID,
  title: 'Probe task today',
  description: 'A probe task description for measurement',
  priority: 'high',
  status: 'todo',
  start_date: null,
  end_date: null,
  due_date: todayNoonIso(),
  timer_total_seconds: 0,
  timer_is_running: false,
  timer_start_time: null,
  project_id: PROJECT_ID,
  sort_order: 0,
  completed_by_email: null,
  assigned_to_email: null,
  change_request_message: null,
  google_calendar_event_id: null,
  created_at: new Date().toISOString(),
  images: [],
});

const taskRowPastDue = () => ({
  ...taskRow(),
  id: 'dddddddd-4444-4444-8444-dddddddddddd',
  title: 'Probe task past due',
  due_date: new Date(Date.now() - 3 * 86_400_000).toISOString(),
});

const projectRow = (userId: string) => ({
  id: PROJECT_ID,
  name: 'Probe project with an extremely long name that must truncate not wrap',
  color: '#B8572E',
  is_shared: false,
  user_id: userId,
  created_at: new Date().toISOString(),
});

const prefRow = (userId: string) => ({
  id: 'cccccccc-3333-4333-8333-cccccccccccc',
  user_id: userId,
  default_view: 'today',
  default_display_mode: 'list',
  default_task_filter: 'all',
  default_task_card_view: 'compact',
  default_task_card_view_mobile: 'minimal',
  theme: 'liquid-glass',
  has_completed_onboarding: true,
  has_completed_task_tour: true,
  has_completed_projects_tour: true,
  has_completed_home_tour: true,
  has_completed_meetings_tour: true,
});

const knobs = { userId: 'unknown' };

async function installRestIntercepts(context: BrowserContext) {
  await context.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const accept = req.headers()['accept'] || '';
    const wantsObject = accept.includes('vnd.pgrst.object');
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (method !== 'GET' && method !== 'HEAD') {
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow(knobs.userId) : [prefRow(knobs.userId)]);
      return reply(wantsObject ? {} : []);
    }
    if (url.includes('focusos_user_preferences')) {
      return reply(wantsObject ? prefRow(knobs.userId) : [prefRow(knobs.userId)]);
    }
    if (url.includes('focusos_tasks')) {
      return reply([taskRow(), taskRowPastDue()]);
    }
    if (url.includes('focusos_projects')) {
      return reply([projectRow(knobs.userId)]);
    }
    if (url.includes('focusos_meetings')) {
      return reply([]);
    }
    return reply(wantsObject ? {} : []);
  });
  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

async function extractUserId(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
        try {
          const v = JSON.parse(localStorage.getItem(k) || '{}');
          return v?.user?.id || 'unknown';
        } catch {
          return 'unknown';
        }
      }
    }
    return 'unknown';
  });
}

/** Measure computed box metrics for a list of named selectors. */
async function measure(page: Page, targets: Array<{ name: string; selector: string }>) {
  return page.evaluate((tgts) => {
    const out: Record<string, unknown> = { viewport: { w: window.innerWidth, h: window.innerHeight } };
    for (const t of tgts) {
      const el = document.querySelector(t.selector) as HTMLElement | null;
      if (!el) { out[t.name] = null; continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out[t.name] = {
        selector: t.selector,
        rect: { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, width: Math.round(r.width * 10) / 10 },
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`,
        gap: cs.gap,
        background: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        radius: cs.borderRadius,
      };
    }
    return out;
  }, targets);
}

const APP_TARGETS = [
  { name: 'maincol', selector: '.lg-maincol' },
  // Below lg the three bars below are display:none and .lg-onebar carries the
  // whole top chrome instead (2026-08-02) — measured here so the mobile audit
  // still has a top-chrome row to compare against the desktop one.
  { name: 'onebar', selector: '.lg-onebar' },
  { name: 'row1_searchPill', selector: '.lg-row1' },
  { name: 'search_inner', selector: '.lg-search' },
  { name: 'tabs', selector: '.lg-tabs' },
  { name: 'projbar', selector: '.lg-projbar' },
  { name: 'projbar_inner', selector: '.lg-projbar > div' },
  { name: 'specialBanner', selector: 'div.mt-4.w-full' },
  { name: 'specialBanner_inner', selector: 'div.mt-4.w-full > div' },
  { name: 'content', selector: '.lg-content:not([hidden]):not([data-state="inactive"])' },
  { name: 'taskCard', selector: '[data-task-card]' },
  { name: 'dock', selector: '.lg-dock' },
  { name: 'sidebar', selector: '.lg-side' },
];

const MEETINGS_TARGETS = [
  { name: 'pagehead', selector: '.lg-pagehead' },
  { name: 'reveal', selector: '.lg-reveal' },
  { name: 'revealContent', selector: '.lg-reveal-content' },
  { name: 'pagehead_inner', selector: '.lg-pagehead > div' },
  { name: 'column', selector: '.max-w-4xl.mx-auto' },
  { name: 'glasscard', selector: '.lg-glasscard' },
  { name: 'dock', selector: '.lg-dock' },
];

async function auditViewport(
  browser: import('@playwright/test').Browser,
  label: string,
  viewport: { width: number; height: number },
  storageState?: string,
) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport.width < 800,
    isMobile: viewport.width < 800,
    ...(storageState ? { storageState } : {}),
  });
  await installRestIntercepts(context);
  const page = await context.newPage();

  if (!storageState) {
    const stamp = Date.now();
    const email = `focusos.padaudit+${stamp}@thefeedbackapp.net`;
    const password = `PadAudit!${stamp}`;
    await page.goto('/auth');
    await page.getByRole('tab', { name: /sign up/i }).click();
    await page.locator('#signup-firstname').fill('Pad');
    await page.locator('#signup-lastname').fill('Audit');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-password').fill(password);
    await page.getByRole('button', { name: /sign up/i }).click();
    await page.waitForURL((u) => !u.pathname.includes('/auth'), { timeout: 30_000 });
    knobs.userId = await extractUserId(page);
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'state.json'), JSON.stringify(await context.storageState()));
  }

  const results: Record<string, unknown> = {};

  const views: Array<{ key: string; url: string }> = [
    { key: 'today', url: '/app?view=today' },
    { key: 'past-due', url: '/app?view=past-due' },
    { key: 'unassigned', url: '/app?view=unassigned' },
    { key: 'project', url: `/app?view=${PROJECT_ID}` },
  ];

  for (const v of views) {
    await page.goto(v.url);
    // Top-chrome ready gate. The visible top bar is breakpoint-dependent since
    // the one-bar landed: .lg-row1 at >= lg, .lg-onebar below it.
    await expect(
      page.locator(viewport.width >= 1024 ? '.lg-row1' : '.lg-onebar'),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    results[v.key] = await measure(page, APP_TARGETS);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${label}-${v.key}.png`), fullPage: false });
  }

  await page.goto('/meetings');
  await page.waitForTimeout(1500);
  results['meetings'] = await measure(page, MEETINGS_TARGETS);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${label}-meetings.png`), fullPage: false });

  fs.writeFileSync(path.join(EVIDENCE_DIR, `measurements-${label}.json`), JSON.stringify(results, null, 2));
  await context.close();
}

test.describe.serial('padding audit', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test('desktop 1280', async ({ browser }) => {
    test.setTimeout(180_000);
    await auditViewport(browser, 'desktop', { width: 1280, height: 800 });
  });

  test('mobile 390', async ({ browser }) => {
    test.setTimeout(180_000);
    const state = path.join(EVIDENCE_DIR, 'state.json');
    await auditViewport(browser, 'mobile', { width: 390, height: 844 }, state);
  });
});
