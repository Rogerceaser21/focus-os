// Account-approval gate (front end). Every NEW account waits until the owner
// clicks Approve in an email; existing accounts are already approved.
// NETWORK INTERCEPTION ONLY: the demo account signs in for real (same as the
// other specs), but the approvals read, the request function, the decide
// function and the sign-up call are all mocked. No real account is created and
// the real request / decide functions are never called.
//   (a) approved row  -> the app loads
//   (b) no row + request says pending -> waiting screen, no app, Sign out -> /auth
//   (c) declined row -> declined screen
//   (d) /approve?token=x -> shows who asks, Approve posts, nothing posts on load
//   (e) sign-up with no session -> inbox message, stays on the auth card
// Run: PW_PORT=8080 npx playwright test tests/approval-gate.spec.ts
import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, actionTimeout: 15000 });

const BASE = process.env.WAVE_BASE_URL ?? '';
const DEMO_EMAIL = 'apple.review@focusos.tech';
const DEMO_PASSWORD = 'FocusOS-Review-2026';

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify(body),
});

const signIn = async (page: Page) => {
  await page.goto(`${BASE}/auth`);
  const panel = page.getByRole('tabpanel');
  await panel.getByLabel(/email/i).fill(DEMO_EMAIL);
  await panel.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await panel.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
};

const mockApprovalsRead = async (page: Page, rows: unknown[]) => {
  await page.route('**/rest/v1/focusos_account_approvals*', (route) => route.fulfill(json(rows)));
};

test.describe('approval gate', () => {
  test('(a) approved account: the app loads', async ({ page }) => {
    await mockApprovalsRead(page, [{ status: 'approved' }]);
    let requested = 0;
    await page.route('**/functions/v1/focusos-request-approval*', (route) => {
      requested++;
      return route.fulfill(json({ status: 'approved' }));
    });
    await signIn(page);
    await expect(page.getByTestId('approval-gate')).toHaveCount(0);
    await expect(page.getByText('Waiting for approval')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Access not approved');
    expect(requested).toBe(0);
  });

  test('(b) pending account: waiting screen, no app, Sign out returns to /auth', async ({ page }) => {
    await mockApprovalsRead(page, []);
    let requested = 0;
    await page.route('**/functions/v1/focusos-request-approval*', (route) => {
      requested++;
      return route.fulfill(json({ status: 'pending' }));
    });
    await signIn(page);
    const gate = page.getByTestId('approval-gate');
    await expect(gate.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    await expect(
      gate.getByText(
        "Thanks for signing up. Igor has been sent your request and will approve your account soon. You'll get an email when it's done.",
      ),
    ).toBeVisible();
    await expect(gate.getByText(DEMO_EMAIL)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
    // The app itself is not on screen.
    await expect(page.getByRole('button', { name: 'Projects', exact: true })).toHaveCount(0);
    expect(requested).toBe(1);
    // Check again re-reads the row but does not re-request.
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(gate.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    expect(requested).toBe(1);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/auth', { timeout: 15000 });
    await expect(page.getByTestId('auth-card')).toBeVisible();
  });

  test('(b2) Check again picks up an approval', async ({ page }) => {
    let approved = false;
    await page.route('**/rest/v1/focusos_account_approvals*', (route) =>
      route.fulfill(json(approved ? [{ status: 'approved' }] : [{ status: 'pending' }])),
    );
    await page.route('**/functions/v1/focusos-request-approval*', (route) =>
      route.fulfill(json({ status: 'pending' })),
    );
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    approved = true;
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('approval-gate')).toHaveCount(0);
  });

  test('(c) declined account: declined screen', async ({ page }) => {
    await mockApprovalsRead(page, [{ status: 'declined' }]);
    await signIn(page);
    const gate = page.getByTestId('approval-gate');
    await expect(gate.getByRole('heading', { name: 'Access not approved' })).toBeVisible();
    await expect(
      gate.getByText('Igor has not approved this account. If you think this is a mistake, contact him.'),
    ).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  });

  test('(c2) read error: retry state, never the app', async ({ page }) => {
    await page.route('**/rest/v1/focusos_account_approvals*', (route) =>
      route.fulfill(json({ message: 'boom' }, 500)),
    );
    await signIn(page);
    const gate = page.getByTestId('approval-gate');
    await expect(gate.getByRole('heading', { name: "Couldn't check your account" })).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

test.describe('/approve page', () => {
  test('(d) shows who asks; Approve posts; nothing posts on load', async ({ page }) => {
    const posts: string[] = [];
    await page.route('**/functions/v1/focusos-decide-approval*', (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
          },
        });
      }
      if (req.method() === 'POST') {
        posts.push(req.postData() ?? '');
        return route.fulfill(json({ status: 'approved' }));
      }
      return route.fulfill(json({ email: 'new.person@example.com', name: 'New Person', status: 'pending' }));
    });
    await page.goto(`${BASE}/approve?token=x`);
    const card = page.getByTestId('approve-card');
    await expect(card.getByText('New Person')).toBeVisible();
    await expect(card.getByText('new.person@example.com')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Decline' })).toBeVisible();
    expect(posts).toHaveLength(0);
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(card.getByText('Approved. new.person@example.com has been told by email.')).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0])).toEqual({ token: 'x', action: 'approve' });
    await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test('(d2) already decided and bad link', async ({ page }) => {
    await page.route('**/functions/v1/focusos-decide-approval*', (route) => {
      const url = route.request().url();
      if (url.includes('token=old')) {
        return route.fulfill(json({ email: 'a@b.co', name: 'A', status: 'declined' }));
      }
      return route.fulfill(json({ error: 'This link has expired.' }, 400));
    });
    await page.goto(`${BASE}/approve?token=old`);
    await expect(page.getByText('Already declined.')).toBeVisible();
    await page.goto(`${BASE}/approve?token=bad`);
    await expect(page.getByText('This link has expired.')).toBeVisible();
  });
});

test.describe('sign-up without a session', () => {
  test('(e) shows the inbox message and stays on the auth card', async ({ page }) => {
    await page.route('**/auth/v1/signup*', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'POST,OPTIONS',
          },
        });
      }
      return route.fulfill(
        json({
          id: '00000000-0000-0000-0000-000000000001',
          aud: 'authenticated',
          role: '',
          email: 'new.person@example.com',
          created_at: '2026-09-30T00:00:00Z',
          app_metadata: {},
          user_metadata: {},
          identities: [],
        }),
      );
    });
    await page.goto(`${BASE}/auth`);
    await page.getByRole('tab', { name: 'Sign Up' }).click();
    const panel = page.getByRole('tabpanel');
    await panel.getByLabel('First Name').fill('New');
    await panel.getByLabel('Surname').fill('Person');
    await panel.getByLabel('Email').fill('new.person@example.com');
    await panel.getByLabel('Password').fill('Not-A-Real-Pass-1');
    await panel.getByRole('button', { name: 'Start Free Today' }).click();
    await expect(page.getByText('Check your inbox to confirm your email, then sign in.')).toBeVisible();
    await expect(page.getByText('Account created! Logging you in...')).toHaveCount(0);
    await expect(page.getByTestId('auth-card')).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
    // back on the sign-in tab
    await expect(page.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('data-state', 'active');
  });
});
