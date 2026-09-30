// Shared by every spec that answers `**/rest/v1/**` itself (hermetic specs with
// a fake session). The account-approval gate reads its own row in
// focusos_account_approvals before it lets the app render, so a blanket mock
// that answers `[]` would park the fake user on "Waiting for approval".
// Call this FIRST inside the blanket handler: it answers the approvals read
// with an approved row and reports whether it did.
import type { Route } from '@playwright/test';

export const APPROVED_ROWS = [{ status: 'approved' }];

export function fulfillApprovedAccount(route: Route): boolean {
  const req = route.request();
  if (!req.url().includes('/rest/v1/focusos_account_approvals')) return false;
  void route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(req.method() === 'GET' || req.method() === 'HEAD' ? APPROVED_ROWS : []),
  });
  return true;
}
