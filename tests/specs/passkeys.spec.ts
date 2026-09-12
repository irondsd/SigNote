import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { schema, testDb } from '../fixtures/db';
import { configureGoogleUser } from '../utils/googleAuth';
import {
  fillStable,
  expectSignedIn,
  openSignInModal,
  SERVER_ROUND_TRIP_MS,
  signInWithEmail,
  signOut,
} from '../utils/emailSignIn';
import { waitForCode } from '../utils/emailInbox';
import { trpcData, trpcMutate, trpcQuery } from '../utils/trpc';
import { addVirtualAuthenticator } from '../utils/virtualAuthenticator';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';

test.describe.configure({ mode: 'parallel' });

const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/**
 * Clicks Add and waits for the row it produces.
 *
 * That row is not one render away: it is a WebAuthn ceremony plus the
 * registration round trip plus the list refetch that follows it, so it waits on
 * the server budget the rest of the suite uses rather than on the expect
 * default, which six parallel workers can outrun.
 */
async function addPasskey(page: Page, expectedRows: number) {
  await page.getByTestId('add-passkey-btn').click();
  await expect(page.getByTestId('passkey-row')).toHaveCount(expectedRows, { timeout: SERVER_ROUND_TRIP_MS });
}

async function reachPasskeyAccountCreation(page: Page) {
  await openSignInModal(page);
  await page.getByTestId('passkey-sign-in-btn').click();
  await expect(page.getByTestId('passkey-create-account-btn')).toBeVisible();
}

async function createPasskeyAccount(page: Page) {
  await reachPasskeyAccountCreation(page);
  await page.getByTestId('passkey-create-account-btn').click();
  await page.getByTestId('passkey-confirm-create-account-btn').click();
  await expectSignedIn(page);
}

test('signs up, signs back in, and manages passkeys', async ({ page }) => {
  let authenticator = await addVirtualAuthenticator(page);
  try {
    await page.goto('/');
    await openSignInModal(page);
    await expect(page.getByTestId('passkey-create-account-btn')).toHaveCount(0);
    await page.getByTestId('passkey-sign-in-btn').click();
    await expect(page.getByText('Passkey sign-in wasn’t completed')).toBeVisible();
    await expect(
      page.getByText('A new account starts empty — it won’t have access to your existing notes.'),
    ).toBeVisible();

    const retry = page.getByTestId('passkey-retry-btn');
    await retry.click();
    await expect(retry).toBeEnabled();

    await page.getByTestId('passkey-failure-back').click();
    await expect(page.getByTestId('email-sign-in-btn')).toBeVisible();
    await page.getByTestId('passkey-sign-in-btn').click();

    await page.getByTestId('passkey-create-account-btn').click();
    await expect(page.getByTestId('passkey-create-account-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByTestId('passkey-create-account-dialog')).toHaveCount(0);

    await page.getByTestId('passkey-create-account-btn').click();
    await page.getByTestId('passkey-confirm-create-account-btn').click();
    await expectSignedIn(page);

    await page.goto('/profile');
    const passkeyMethod = page.getByTestId('identity-passkey');
    await expect(passkeyMethod).toContainText('1 passkey');
    await expect(page.getByTestId('manage-passkeys-btn')).toContainText('Manage');

    await signOut(page);
    await openSignInModal(page);
    await page.getByTestId('passkey-sign-in-btn').click();
    await expectSignedIn(page);

    await page.goto('/sessions');
    await expect(page.getByText('Passkey', { exact: true }).first()).toBeVisible();

    await page.goto('/passkeys');
    await expect(page.getByTestId('passkey-row')).toHaveCount(1, { timeout: SERVER_ROUND_TRIP_MS });
    // A passkey-only account may not remove its last way back in.
    await expect(page.getByRole('button', { name: /^Remove / })).toBeDisabled();
    const [onlyPasskey] = await trpcData<Array<{ id: string }>>(await trpcQuery(page.request, 'passkeys.list'));
    const directRemove = await trpcMutate(page.request, 'passkeys.remove', { id: onlyPasskey.id });
    expect(directRemove.status()).toBe(400);
    expect(JSON.stringify(await directRemove.json())).toContain('LAST_IDENTITY');

    // A platform authenticator keeps one resident credential per RP account.
    // Swap in a fresh virtual authenticator to represent a second device.
    await authenticator.dispose();
    authenticator = await addVirtualAuthenticator(page);
    await addPasskey(page, 2);

    const newest = page.getByTestId('passkey-row').first();
    await newest.getByRole('button', { name: /^Rename / }).click();
    const nameInput = newest.getByRole('textbox', { name: 'Passkey name' });
    await nameInput.fill('Travel key');
    await nameInput.press('Enter');
    await expect(newest).toContainText('Travel key');

    await newest.getByRole('button', { name: 'Remove Travel key' }).click();
    await page.getByRole('button', { name: 'Remove passkey' }).click();
    await expect(page.getByTestId('passkey-row')).toHaveCount(1, { timeout: SERVER_ROUND_TRIP_MS });
  } finally {
    await authenticator.dispose();
  }
});

test('account erasure deletes the passkey and makes it unusable', async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  try {
    await page.goto('/');
    await createPasskeyAccount(page);

    const { userId } = await trpcData<{ userId: string }>(await trpcQuery(page.request, 'me'));

    await page.goto('/erase');
    await page.getByRole('button', { name: 'I confirm, delete my data' }).click();
    await expect(page.getByText('Confirmed')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Start Erasure' }).click();
    await expect(page.getByText('Account permanently erased')).toBeVisible({ timeout: 30_000 });

    expect(
      await testDb().select().from(schema.passkeyCredentials).where(eq(schema.passkeyCredentials.userId, userId)),
    ).toHaveLength(0);

    await page.context().clearCookies();
    await page.goto('/');
    await openSignInModal(page);
    await page.getByTestId('passkey-sign-in-btn').click();
    await expect(page.getByText('We couldn’t sign you in with a passkey')).toBeVisible();
    expect(await testDb().select().from(schema.users).where(eq(schema.users.id, userId))).toHaveLength(0);
  } finally {
    await authenticator.dispose();
  }
});

test('a passkey still signs in after its account is absorbed by an identity merge', async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  const google = {
    sub: `passkey-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Passkey Merge',
    email: uniqueEmail('passkey-merge-google'),
  };

  try {
    await page.goto('/');
    await createPasskeyAccount(page);
    const sourceSession = (await (await page.request.get('/api/auth/session')).json()) as { user?: { id?: string } };
    const sourceUserId = sourceSession.user?.id;
    expect(sourceUserId).toBeTruthy();
    const [sourcePasskey] = await testDb()
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.userId, sourceUserId!));
    expect(sourcePasskey).toBeTruthy();

    await configureGoogleUser(page, google);
    await page.goto('/profile');
    await page.getByTestId('connect-google').click();
    await expect(page.getByText('Google account linked successfully.').first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/profile$/);

    await signOut(page);
    const destinationEmail = uniqueEmail('passkey-merge-destination');
    await signInWithEmail(page, destinationEmail);
    await expectSignedIn(page);
    const destinationSession = (await (await page.request.get('/api/auth/session')).json()) as {
      user?: { id?: string };
    };
    const destinationUserId = destinationSession.user?.id;
    expect(destinationUserId).toBeTruthy();
    expect(destinationUserId).not.toBe(sourceUserId);

    await configureGoogleUser(page, google);
    await page.goto('/profile');
    await page.getByTestId('connect-google').click();
    await expect(page.getByText('Google account linked successfully.').first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/profile$/);

    const [moved] = await testDb()
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.credentialId, sourcePasskey.credentialId));
    expect(moved.userId).toBe(destinationUserId);
    expect(await testDb().select().from(schema.users).where(eq(schema.users.id, sourceUserId!))).toHaveLength(0);

    await signOut(page);
    await openSignInModal(page);
    await page.getByTestId('passkey-sign-in-btn').click();
    await expectSignedIn(page);

    const mergedSession = (await (await page.request.get('/api/auth/session')).json()) as { user?: { id?: string } };
    expect(mergedSession.user?.id).toBe(destinationUserId);
  } finally {
    await authenticator.dispose();
  }
});

test('replaying a completed passkey assertion cannot create another session', async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  try {
    await page.goto('/');
    await createPasskeyAccount(page);
    await signOut(page);
    await openSignInModal(page);

    const callbackRequestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/auth/callback/passkey') && request.method() === 'POST',
    );
    await page.getByTestId('passkey-sign-in-btn').click();
    const callbackRequest = await callbackRequestPromise;
    const callbackBody = callbackRequest.postData();
    expect(callbackBody).toBeTruthy();
    await expectSignedIn(page);

    await signOut(page);
    const csrfResponse = await page.request.get('/api/auth/csrf');
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    const replayBody = new URLSearchParams(callbackBody!);
    replayBody.set('csrfToken', csrfToken);

    await page.request.post(callbackRequest.url(), {
      data: replayBody.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const replayedSession = (await (await page.request.get('/api/auth/session')).json()) as { user?: unknown };
    expect(replayedSession.user).toBeUndefined();
  } finally {
    await authenticator.dispose();
  }
});

test('an email account can add a passkey and then detach its email', async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  const email = uniqueEmail('passkey-email-detach');
  try {
    await page.goto('/');
    await signInWithEmail(page, email);
    await expectSignedIn(page);
    const session = (await (await page.request.get('/api/auth/session')).json()) as { user?: { id?: string } };
    const userId = session.user?.id;
    expect(userId).toBeTruthy();

    await page.goto('/passkeys');
    // The page renders nothing until its three queries land; the empty state is
    // the proof they have, and that Add is the button of a settled list.
    await expect(page.getByText('No passkeys yet')).toBeVisible({ timeout: SERVER_ROUND_TRIP_MS });
    await addPasskey(page, 1);

    await page.goto('/profile');
    await page.getByTestId('unlink-email').click();
    await expect(page.getByTestId('connect-email')).toBeVisible();

    const [user] = await testDb().select().from(schema.users).where(eq(schema.users.id, userId!));
    expect(user.email).toBeNull();
    expect(
      await testDb().select().from(schema.passkeyCredentials).where(eq(schema.passkeyCredentials.userId, userId!)),
    ).toHaveLength(1);
  } finally {
    await authenticator.dispose();
  }
});

test('a passkey account can add an email and then remove its passkey', async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  const email = uniqueEmail('passkey-add-email');
  try {
    await page.goto('/');
    await createPasskeyAccount(page);

    await page.goto('/profile');
    await page.getByTestId('connect-email').click();
    await fillStable(page.getByTestId('link-email-email-input'), email);
    await page.getByTestId('link-email-submit').click();
    const code = await waitForCode(email);
    await fillStable(page.getByTestId('link-email-code-input'), code);
    await page.getByTestId('link-email-submit').click();
    await expect(page.getByTestId('email-method-address')).toContainText(email);

    await page.goto('/passkeys');
    await page.getByRole('button', { name: /^Remove / }).click();
    await page.getByRole('button', { name: 'Remove passkey' }).click();
    await expect(page.getByTestId('passkey-row')).toHaveCount(0, { timeout: SERVER_ROUND_TRIP_MS });
  } finally {
    await authenticator.dispose();
  }
});

test('concurrent cross-method removals cannot delete the final sign-in method', async ({ page }) => {
  const { account } = makeAccount();
  const token = await createTestSession(account.address);
  await injectSession(page, token);
  await page.goto('/profile');

  const session = (await (await page.request.get('/api/auth/session')).json()) as { user?: { id?: string } };
  const userId = session.user?.id;
  expect(userId).toBeTruthy();
  const [passkey] = await testDb()
    .insert(schema.passkeyCredentials)
    .values({
      userId: userId!,
      credentialId: `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      publicKey: 'cHVibGljLWtleQ',
      counter: 0,
      transports: [],
      aaguid: '00000000-0000-0000-0000-000000000000',
      deviceType: 'singleDevice',
      backedUp: false,
      nickname: 'Race passkey',
    })
    .returning();

  const responses = await Promise.all([
    trpcMutate(page.request, 'identities.unlink', { provider: 'siwe' }),
    trpcMutate(page.request, 'passkeys.remove', { id: passkey.id }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 400]);

  const [identities, passkeys] = await Promise.all([
    testDb().select().from(schema.authIdentities).where(eq(schema.authIdentities.userId, userId!)),
    testDb().select().from(schema.passkeyCredentials).where(eq(schema.passkeyCredentials.userId, userId!)),
  ]);
  expect(identities.length + passkeys.length).toBe(1);
});

test('redirects unauthenticated users away from passkey management', async ({ page }) => {
  await page.goto('/passkeys');
  await expect(page).toHaveURL('/');
});
