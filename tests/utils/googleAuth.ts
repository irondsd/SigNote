import type { MockOAuthProfile } from '../oauth/mockOAuthServer';

function mockBaseUrl() {
  const port = process.env.MOCK_OAUTH_PORT;
  if (!port) throw new Error('MOCK_OAUTH_PORT env var is not set. Is the mock OAuth server running?');
  return `http://localhost:${port}`;
}

/**
 * Configure the mock OAuth server to return this profile on the next sign-in.
 * Must be called before navigating to the sign-in page.
 */
export async function configureGoogleUser(profile: Omit<MockOAuthProfile, 'email_verified'>): Promise<void> {
  await fetch(`${mockBaseUrl()}/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
}

/**
 * Make the mock OAuth server return an error on the next authorization redirect.
 * Common values: 'access_denied', 'temporarily_unavailable'
 */
export async function setGoogleError(error: string): Promise<void> {
  await fetch(`${mockBaseUrl()}/set-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  });
}
