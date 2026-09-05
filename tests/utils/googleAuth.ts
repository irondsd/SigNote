import type { Page } from '@playwright/test';
import { FLOW_COOKIE, type MockOAuthProfile } from '../oauth/mockOAuthServer';

function mockBaseUrl() {
  const port = process.env.MOCK_OAUTH_PORT;
  if (!port) throw new Error('MOCK_OAUTH_PORT env var is not set. Is the mock OAuth server running?');
  return `http://localhost:${port}`;
}

/**
 * Queues one flow for this browser context by naming it in a cookie on the mock
 * provider's own origin.
 *
 * A cookie rather than a `page.route` that rewrites the authorization URL: that
 * route had to be armed per flow and removed after one use, and dropping the
 * last handler tears down Chromium's request interception. A navigation issued
 * in that same moment — and the provider's redirect back to
 * `/api/auth/callback/google` always is — can be left paused for good: the
 * browser reports the request as sent, the server never receives it, and the
 * test spends its timeout on a page that never navigates. Cookies need no
 * interception at all.
 *
 * Cookies ignore ports, so this one also rides along to the app on :5005, where
 * it means nothing. The mock clears it the moment it is used.
 */
async function armFlow(page: Page, flowId: string): Promise<void> {
  await page.context().addCookies([{ name: FLOW_COOKIE, value: flowId, url: mockBaseUrl() }]);
}

/**
 * Configure the mock OAuth server to return this profile on the next sign-in.
 * Must be called before navigating to the sign-in page.
 */
export async function configureGoogleUser(
  page: Page,
  // `email_verified` is included: it decides whether the address is claimed at
  // all, so the unverified branch has to be reachable from a test.
  profile: MockOAuthProfile,
): Promise<void> {
  const res = await fetch(`${mockBaseUrl()}/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const { flowId } = (await res.json()) as { flowId: string };
  await armFlow(page, flowId);
}

/**
 * Make the mock OAuth server return an error on the next authorization redirect.
 * Common values: 'access_denied', 'temporarily_unavailable'
 */
export async function setGoogleError(page: Page, error: string): Promise<void> {
  const res = await fetch(`${mockBaseUrl()}/set-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  });
  const { flowId } = (await res.json()) as { flowId: string };
  await armFlow(page, flowId);
}
