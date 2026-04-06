import type { Page } from '@playwright/test';
import type { MockOAuthProfile } from '../oauth/mockOAuthServer';

function mockBaseUrl() {
  const port = process.env.MOCK_OAUTH_PORT;
  if (!port) throw new Error('MOCK_OAUTH_PORT env var is not set. Is the mock OAuth server running?');
  return `http://localhost:${port}`;
}

function setupFlowRoute(page: Page, flowId: string): Promise<void> {
  const port = process.env.MOCK_OAUTH_PORT!;
  return page.route(
    (url) => url.hostname === 'localhost' && url.port === port && url.pathname === '/auth',
    (route) => {
      const target = new URL(route.request().url());
      target.searchParams.set('_flow_key', flowId);
      return route.continue({ url: target.toString() });
    },
    { times: 1 },
  );
}

/**
 * Configure the mock OAuth server to return this profile on the next sign-in.
 * Must be called before navigating to the sign-in page.
 */
export async function configureGoogleUser(
  page: Page,
  profile: Omit<MockOAuthProfile, 'email_verified'>,
): Promise<void> {
  const res = await fetch(`${mockBaseUrl()}/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const { flowId } = (await res.json()) as { flowId: string };
  await setupFlowRoute(page, flowId);
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
  await setupFlowRoute(page, flowId);
}
