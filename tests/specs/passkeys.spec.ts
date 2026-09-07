import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { schema, testDb } from '../fixtures/db';
import { expectSignedIn, openSignInModal, signOut } from '../utils/emailSignIn';
import { trpcData, trpcMutate, trpcQuery } from '../utils/trpc';
import { addVirtualAuthenticator } from '../utils/virtualAuthenticator';

test.describe.configure({ mode: 'parallel' });

test('signs up, signs back in, and manages passkeys', async ({ page }) => {
  let authenticator = await addVirtualAuthenticator(page);
  try {
    await page.goto('/');
    await openSignInModal(page);
    await expect(page.getByTestId('passkey-create-account-btn')).toHaveCount(0);
    await page.getByTestId('passkey-sign-in-btn').click();
    await expect(page.getByText('We couldn’t sign you in with a passkey')).toBeVisible();
    await expect(page.getByText('A new account will not have access to your existing notes.')).toBeVisible();

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
    await expect(page.getByTestId('passkey-row')).toHaveCount(1);
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
    await page.getByTestId('add-passkey-btn').click();
    await expect(page.getByTestId('passkey-row')).toHaveCount(2);

    const newest = page.getByTestId('passkey-row').first();
    await newest.getByRole('button', { name: /^Rename / }).click();
    const nameInput = newest.getByRole('textbox', { name: 'Passkey name' });
    await nameInput.fill('Travel key');
    await nameInput.press('Enter');
    await expect(newest).toContainText('Travel key');

    await newest.getByRole('button', { name: 'Remove Travel key' }).click();
    await page.getByRole('button', { name: 'Remove passkey' }).click();
    await expect(page.getByTestId('passkey-row')).toHaveCount(1);
  } finally {
    await authenticator.dispose();
  }
});

test('account erasure deletes the passkey and makes it unusable', async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page);
  try {
    await page.goto('/');
    await openSignInModal(page);
    await page.getByTestId('passkey-sign-in-btn').click();
    await page.getByTestId('passkey-create-account-btn').click();
    await page.getByTestId('passkey-confirm-create-account-btn').click();
    await expectSignedIn(page);

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

test('redirects unauthenticated users away from passkey management', async ({ page }) => {
  await page.goto('/passkeys');
  await expect(page).toHaveURL('/');
});
