import { test, expect, type Page } from '@playwright/test';
import { mockProvider } from '../utils/mockProvider';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { ProfilePage } from '../pages/ProfilePage';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';
const NEW_PASSPHRASE = 'different-horse-new-staple-1337';
type EthereumWindow = Window & { ethereum?: { setPrivateKey?: (key: `0x${string}`) => void } };

// Sign in with a fresh account. Registers an addInitScript so the private key
// is re-injected on every full page navigation (keeping wagmi connected).
const setup = async (page: Page) => {
  const { privateKey, account } = makeAccount();
  await mockProvider(page);
  await page.addInitScript((pk: `0x${string}`) => {
    (window as EthereumWindow).ethereum?.setPrivateKey?.(pk);
  }, privateKey);
  await page.goto('/');
  await changeAccount(page, privateKey);
  await signIn(page);
  return { privateKey, account };
};

// Click "I confirm, delete my data", wait for confirmation, then click "Start Erasure"
const performErase = async (page: Page) => {
  await page.getByRole('button', { name: 'I confirm, delete my data' }).click();
  await expect(page.getByText('Confirmed')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Start Erasure' }).click();
};

// After account deletion, clear session and re-sign in with the same wallet key.
// The addInitScript registered during setup re-sets the key on every page load,
// so no additional key setup is needed here.
const reSignIn = async (page: Page, privateKey: `0x${string}`) => {
  await page.context().clearCookies();
  await page.goto('/');
  await changeAccount(page, privateKey);
  await signIn(page);
};

// ─── Access control ───────────────────────────────────────────────────────────

test.describe('access control', () => {
  test('redirects unauthenticated users from /erase to home', async ({ page }) => {
    await page.goto('/erase');
    await expect(page).toHaveURL('/');
  });

  test('redirects unauthenticated users from /erase-encryption to home', async ({ page }) => {
    await page.goto('/erase-encryption');
    await expect(page).toHaveURL('/');
  });
});

// ─── Erase account ────────────────────────────────────────────────────────────

test.describe('erase account', () => {
  test('deletes notes and account; re-signin creates a fresh account', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedNotes(account.address, [{ title: 'Note 1' }, { title: 'Note 2' }, { title: 'Note 3' }]);

    await mockProvider(page);
    await page.addInitScript((pk: `0x${string}`) => {
      (window as EthereumWindow).ethereum?.setPrivateKey?.(pk);
    }, privateKey);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    const { createdAt: oldCreatedAt } = await (await page.request.get('/api/profile')).json();

    await page.goto('/erase');
    await performErase(page);
    await expect(page.getByText('Account permanently erased')).toBeVisible({ timeout: 30000 });

    await reSignIn(page, privateKey);

    const newProfile = await (await page.request.get('/api/profile')).json();
    expect(newProfile.notesCount).toBe(0);
    expect(new Date(newProfile.createdAt).getTime()).toBeGreaterThan(new Date(oldCreatedAt).getTime());
  });

  test('deletes all data including encryption profile, secrets, and seals', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    await seedNotes(account.address, [{ title: 'Note A' }, { title: 'Note B' }]);
    await seedSecrets(account.address, mekBytes, [{ title: 'Secret A' }]);
    await seedSeals(account.address, mekBytes, [{ title: 'Seal A' }]);

    await mockProvider(page);
    await page.addInitScript((pk: `0x${string}`) => {
      (window as EthereumWindow).ethereum?.setPrivateKey?.(pk);
    }, privateKey);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.goto('/erase');
    await performErase(page);
    await expect(page.getByText('Account permanently erased')).toBeVisible({ timeout: 30000 });

    await reSignIn(page, privateKey);

    const profilePage = new ProfilePage(page);
    await profilePage.goto();
    await expect(profilePage.notesCount()).toHaveText('0');
    await expect(profilePage.secretsCount()).toHaveText('0');
    await expect(profilePage.sealsCount()).toHaveText('0');
    await expect(profilePage.eraseProfileBtn()).toBeDisabled();

    await page.goto('/secrets');
    await expect(page.locator('#enc-passphrase')).toBeVisible();
  });

  test('skips encryption-dependent steps when no encryption profile exists', async ({ page }) => {
    await setup(page);

    // Register listener before navigation so it catches the profile fetch triggered on page load
    const profileLoaded = page.waitForResponse((r) => r.url().includes('/api/profile') && r.status() === 200);
    await page.goto('/erase');
    await profileLoaded;

    await page.getByRole('button', { name: 'I confirm, delete my data' }).click();
    await expect(page.getByText('Confirmed')).toBeVisible({ timeout: 15000 });

    // Seals, Secrets, and Encryption Profile should be skipped (require enc profile)
    await expect(page.locator('span[data-status="skipped"]').filter({ hasText: 'Seals' })).toBeVisible();
    await expect(page.locator('span[data-status="skipped"]').filter({ hasText: 'Secrets' })).toBeVisible();
    await expect(page.locator('span[data-status="skipped"]').filter({ hasText: 'Encryption Profile' })).toBeVisible();

    // Notes and User Account should still be pending (not yet started)
    await expect(page.locator('span[data-status="pending"]').filter({ hasText: 'Notes' })).toBeVisible();
    await expect(page.locator('span[data-status="pending"]').filter({ hasText: 'User Account' })).toBeVisible();

    await page.getByRole('button', { name: 'Start Erasure' }).click();
    await expect(page.getByText('Account permanently erased')).toBeVisible({ timeout: 30000 });
  });
});

// ─── Erase encryption profile ─────────────────────────────────────────────────

test.describe('erase encryption profile', () => {
  test('erases encrypted data while regular notes survive', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    await seedNotes(account.address, [{ title: 'Note A' }, { title: 'Note B' }]);
    await seedSecrets(account.address, mekBytes, [{ title: 'Secret A' }]);
    await seedSeals(account.address, mekBytes, [{ title: 'Seal A' }]);

    await mockProvider(page);
    await page.addInitScript((pk: `0x${string}`) => {
      (window as EthereumWindow).ethereum?.setPrivateKey?.(pk);
    }, privateKey);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.goto('/erase-encryption');
    await performErase(page);

    // onDone fires after 10s timer → router.push('/profile')
    await expect(page).toHaveURL('/profile', { timeout: 15000 });

    const profilePage = new ProfilePage(page);
    await expect(profilePage.notesCount()).toHaveText('2');
    await expect(profilePage.eraseProfileBtn()).toBeDisabled();

    await page.goto('/secrets');
    await expect(page.locator('#enc-passphrase')).toBeVisible();
  });

  test('can set up a fresh encryption profile after erasure', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.addInitScript((pk: `0x${string}`) => {
      (window as EthereumWindow).ethereum?.setPrivateKey?.(pk);
    }, privateKey);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.goto('/erase-encryption');
    await performErase(page);
    await expect(page).toHaveURL('/profile', { timeout: 15000 });

    await page.goto('/secrets');
    await expect(page.locator('#enc-passphrase')).toBeVisible();

    await page.locator('#enc-passphrase').fill(NEW_PASSPHRASE);
    await page.locator('#enc-confirm').fill(NEW_PASSPHRASE);

    const postPromise = page.waitForResponse(
      (r) => r.url().includes('/api/encryption/profile') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create encryption keys' }).click();
    const postResponse = await postPromise;

    expect(postResponse.status()).toBe(201);
    await expect(page.locator('#enc-passphrase')).not.toBeVisible();
  });

  test('profile API reflects hasEncryptionProfile: false after erasure', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.addInitScript((pk: `0x${string}`) => {
      (window as EthereumWindow).ethereum?.setPrivateKey?.(pk);
    }, privateKey);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.goto('/erase-encryption');
    await performErase(page);
    await expect(page).toHaveURL('/profile', { timeout: 15000 });

    const profileRes = await page.request.get('/api/profile');
    const profile = await profileRes.json();
    expect(profile.hasEncryptionProfile).toBe(false);
    expect(profile.encryptionProfileCreatedAt).toBeNull();

    const profilePage = new ProfilePage(page);
    await expect(profilePage.eraseProfileBtn()).toBeDisabled();
  });
});
