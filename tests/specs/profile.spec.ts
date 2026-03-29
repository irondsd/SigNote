import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';

test.describe.configure({ mode: 'parallel' });

const setup = async (page: Page, startUrl = '/') => {
  const { privateKey, account } = makeAccount();
  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);
  return { privateKey, account };
};

// ─── Access control ──────────────────────────────────────────────────────────

test.describe('access control', () => {
  test('redirects unauthenticated users to home', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL('/');
  });

  test('authenticated user can access profile page', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');
    await expect(page).toHaveURL('/profile');
    await expect(page.getByTestId('profile-address')).toBeVisible();
  });
});

// ─── Overview ────────────────────────────────────────────────────────────────

test.describe('overview', () => {
  test('displays the full wallet address', async ({ page }) => {
    const { account } = await setup(page);
    await page.goto('/profile');

    const addressEl = page.getByTestId('profile-address');
    await expect(addressEl).toBeVisible();
    await expect(addressEl).toContainText(account.address.slice(0, 6));
    await expect(addressEl).toContainText(account.address.slice(-4));
  });

  test('displays member since date', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');

    await expect(page.getByText('Member since')).toBeVisible();
  });
});

// ─── Statistics ───────────────────────────────────────────────────────────────

test.describe('statistics', () => {
  test('shows correct note count including archived', async ({ page }) => {
    const { account } = await setup(page);

    await seedNotes(account.address, [
      { title: 'Active note 1' },
      { title: 'Active note 2' },
      { title: 'Archived note', archived: true },
    ]);

    await page.goto('/profile');

    await expect(page.getByTestId('notes-count')).toHaveText('3');
  });

  test('does not count soft-deleted notes', async ({ page }) => {
    const { account } = await setup(page);

    await seedNotes(account.address, [{ title: 'Visible note' }, { title: 'Deleted note', deletedAt: new Date() }]);

    await page.goto('/profile');

    await expect(page.getByTestId('notes-count')).toHaveText('1');
  });

  test('shows correct secret and seal counts', async ({ page }) => {
    const { account } = await setup(page);
    const { mekBytes } = await seedEncryptionProfile(account.address, 'test-passphrase-abc-123');

    await seedSecrets(account.address, mekBytes, [{ title: 'Secret A' }, { title: 'Secret B' }]);
    await seedSeals(account.address, mekBytes, [{ title: 'Seal A' }]);

    await page.goto('/profile');

    await expect(page.getByTestId('secrets-count')).toHaveText('2');
    await expect(page.getByTestId('seals-count')).toHaveText('1');
  });

  test('shows zero counts for new account with no data', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');

    await expect(page.getByTestId('notes-count')).toHaveText('0');
    await expect(page.getByTestId('secrets-count')).toHaveText('0');
    await expect(page.getByTestId('seals-count')).toHaveText('0');
  });
});

// ─── Encryption profile detection ─────────────────────────────────────────────

test.describe('encryption profile', () => {
  test('erase button is disabled when no encryption profile exists', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');

    await expect(page.getByTestId('erase-profile-btn')).toBeDisabled();
  });

  test('erase button is enabled when encryption profile exists', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, 'test-passphrase-abc-123');

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.goto('/profile');

    await expect(page.getByTestId('erase-profile-btn')).toBeEnabled();
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────

test.describe('navigation', () => {
  test('sidebar wallet address navigates to /profile', async ({ page }) => {
    await setup(page);

    await page.getByTestId('wallet-address').first().click();
    await expect(page).toHaveURL('/profile');
  });

  test('change passphrase button is disabled without encryption profile', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');

    await expect(page.getByRole('button', { name: 'Change' })).toBeDisabled();
  });

  test('change passphrase button navigates to /change-passphrase when profile is set up', async ({ page }) => {
    const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Change' }).click();
    await expect(page).toHaveURL('/change-passphrase');
  });
});
