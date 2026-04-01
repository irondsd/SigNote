import { test, expect, type Page } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';

test.describe.configure({ mode: 'parallel' });

const setup = async (page: Page, startUrl = '/') => {
  const { account } = makeAccount();
  const token = await createTestSession(account.address);
  await injectSession(page, token);
  await page.goto(startUrl);
  return { account };
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
  test('displays the display name', async ({ page }) => {
    const { account } = await setup(page);
    await page.goto('/profile');

    const displayNameEl = page.getByTestId('profile-address');
    await expect(displayNameEl).toBeVisible();
    await expect(displayNameEl).toContainText(account.address);
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
    const { account } = makeAccount();
    await seedEncryptionProfile(account.address, 'test-passphrase-abc-123');

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/profile');

    await expect(page.getByTestId('erase-profile-btn')).toBeEnabled();
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────

test.describe('navigation', () => {
  test('sidebar wallet address navigates to /profile', async ({ page }) => {
    await setup(page);

    await page.getByTestId('display-name').first().click();
    await expect(page).toHaveURL('/profile');
  });

  test('change passphrase button is disabled without encryption profile', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');

    await expect(page.getByRole('button', { name: 'Change' })).toBeDisabled();
  });

  test('change passphrase button navigates to /change-passphrase when profile is set up', async ({ page }) => {
    const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';
    const { account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Change' }).click();
    await expect(page).toHaveURL('/change-passphrase');
  });
});
