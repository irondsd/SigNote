import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';

test.describe.configure({ mode: 'parallel' });

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });
const secretCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

// Unlock the session via PassphraseModal
const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).last().click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });
};

// ─── Account Isolation: Notes ───────────────────────────────────────────────

test.describe('account isolation - notes', () => {
  test('account A cannot see account B notes', async ({ page }) => {
    const accountA = makeAccount();
    const accountB = makeAccount();

    const tagA = `onlyA_${Date.now()}`;
    const tagB = `onlyB_${Date.now()}`;

    await seedNotes(accountA.account.address, [{ title: tagA, content: '<p>A content</p>' }]);
    await seedNotes(accountB.account.address, [{ title: tagB, content: '<p>B content</p>' }]);

    // Sign in as account A
    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, accountA.privateKey);
    await signIn(page);

    await expect(noteCard(page, tagA)).toBeVisible();
    await expect(noteCard(page, tagB)).toHaveCount(0);

    // Sign out
    await page.getByTestId('sign-out-button').first().click();
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible();

    // Sign in as account B
    await changeAccount(page, accountB.privateKey);
    await signIn(page);

    await expect(noteCard(page, tagB)).toBeVisible();
    await expect(noteCard(page, tagA)).toHaveCount(0);
  });
});

// ─── Account Isolation: Secrets ─────────────────────────────────────────────

test.describe('account isolation - secrets', () => {
  test('account A cannot see account B secrets', async ({ page }) => {
    const accountA = makeAccount();
    const accountB = makeAccount();

    const tagA = `secretA_${Date.now()}`;
    const tagB = `secretB_${Date.now()}`;

    const { mekBytes: mekA } = await seedEncryptionProfile(accountA.account.address, TEST_PASSPHRASE);
    const { mekBytes: mekB } = await seedEncryptionProfile(accountB.account.address, TEST_PASSPHRASE);

    await seedSecrets(accountA.account.address, mekA, [{ title: tagA, content: 'A secret' }]);
    await seedSecrets(accountB.account.address, mekB, [{ title: tagB, content: 'B secret' }]);

    // Sign in as account A and unlock
    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, accountA.privateKey);
    await signIn(page);
    await unlock(page);

    await expect(secretCard(page, tagA)).toBeVisible();
    await expect(secretCard(page, tagB)).toHaveCount(0);

    // Sign out
    await page.getByTestId('sign-out-button').first().click();
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible();

    // Sign in as account B and unlock
    await changeAccount(page, accountB.privateKey);
    await signIn(page);
    await unlock(page);

    await expect(secretCard(page, tagB)).toBeVisible();
    await expect(secretCard(page, tagA)).toHaveCount(0);
  });
});

// ─── Unauthenticated API Access ─────────────────────────────────────────────

test.describe('unauthenticated API access', () => {
  test('GET /api/notes returns 401 when not authenticated', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.get('/api/notes');
    expect(response.status()).toBe(401);
  });

  test('POST /api/notes returns 401 when not authenticated', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.post('/api/notes', {
      data: { title: 'should fail', content: '<p>test</p>' },
    });
    expect(response.status()).toBe(401);
  });
});
