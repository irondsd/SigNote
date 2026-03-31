import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';

test.describe.configure({ mode: 'parallel' });

// ─── Account Isolation: Notes ───────────────────────────────────────────────

test.describe('account isolation - notes', () => {
  test('account A cannot see account B notes', async ({ page }) => {
    const accountA = makeAccount();
    const accountB = makeAccount();

    const tagA = `onlyA_${Date.now()}`;
    const tagB = `onlyB_${Date.now()}`;

    await seedNotes(accountA.account.address, [{ title: tagA, content: '<p>A content</p>' }]);
    await seedNotes(accountB.account.address, [{ title: tagB, content: '<p>B content</p>' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet(accountA.privateKey);

    await expect(notesPage.noteCard(tagA)).toBeVisible();
    await expect(notesPage.noteCard(tagB)).toHaveCount(0);

    // Sign out
    await page.getByTestId('sign-out-button').first().click();
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible();

    // Sign in as account B
    await notesPage.signInWithWallet(accountB.privateKey);

    await expect(notesPage.noteCard(tagB)).toBeVisible();
    await expect(notesPage.noteCard(tagA)).toHaveCount(0);
  });
});

// ─── Account Isolation: Secrets ─────────────────────────────────────────────

test.describe('account isolation - secrets', () => {
  test('account A cannot see account B secrets', async ({ page }) => {
    const accountA = makeAccount();
    const accountB = makeAccount();

    const tagA = `secretA_${Date.now()}`;
    const tagB = `secretB_${Date.now()}`;

    const { mekBytes: mekA } = await seedEncryptionProfile(accountA.account.address, SecretsPage.PASSPHRASE);
    const { mekBytes: mekB } = await seedEncryptionProfile(accountB.account.address, SecretsPage.PASSPHRASE);

    await seedSecrets(accountA.account.address, mekA, [{ title: tagA, content: 'A secret' }]);
    await seedSecrets(accountB.account.address, mekB, [{ title: tagB, content: 'B secret' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet(accountA.privateKey);
    await secretsPage.unlock();

    await expect(secretsPage.secretCard(tagA)).toBeVisible();
    await expect(secretsPage.secretCard(tagB)).toHaveCount(0);

    // Sign out
    await page.getByTestId('sign-out-button').first().click();
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible();

    // Sign in as account B and unlock
    await secretsPage.signInWithWallet(accountB.privateKey);
    await secretsPage.unlock();

    await expect(secretsPage.secretCard(tagB)).toBeVisible();
    await expect(secretsPage.secretCard(tagA)).toHaveCount(0);
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
