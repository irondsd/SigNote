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

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });
const secretCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });
const sealCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

const setup = async (page: Page, startUrl = '/') => {
  const { privateKey, account } = makeAccount();
  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);
  return { privateKey, account };
};

const setupEncrypted = async (page: Page, startUrl: string) => {
  const { privateKey, account } = makeAccount();
  const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);
  return { privateKey, account, mekBytes };
};

// PBKDF2 at 600k iterations is slow — 20s timeout on the lock button assertion
const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).last().click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });
};

// ─── Group 1: Create failure recovery ────────────────────────────────────────

test.describe('create failure recovery', () => {
  test('note: failed POST re-opens NewNoteModal pre-filled with content', async ({ page }) => {
    await setup(page);

    const title = `Recovery Note ${Date.now()}`;
    const content = 'Note recovery body';

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(content);

    // Intercept the POST to return a server error
    await page.route('**/api/notes', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' });
      } else {
        await route.continue();
      }
    });

    const failedPost = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'POST');
    await page.getByTestId('save-note-btn').click();
    await failedPost;

    // Modal should re-open with original content
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toHaveValue(title);
    await expect(page.getByTestId('tiptap-editor')).toContainText(content);

    // Error toast should be persistent
    await expect(page.getByText('Failed to create note')).toBeVisible();
    await expect(page.getByText('Your content has been recovered.')).toBeVisible();

    // Retry — let the real request through
    await page.unroute('**/api/notes');
    const successPost = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.request().method() === 'POST' && r.status() !== 500,
    );
    await page.getByTestId('save-note-btn').click();
    await successPost;

    await expect(noteCard(page, title)).toBeVisible();
  });

  test('secret: failed POST re-opens NewSecretModal pre-filled with plaintext content', async ({ page }) => {
    await setupEncrypted(page, '/secrets');
    await unlock(page);

    const title = `Recovery Secret ${Date.now()}`;
    const content = 'Secret recovery body';

    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(content);

    await page.route('**/api/secrets', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' });
      } else {
        await route.continue();
      }
    });

    const failedPost = page.waitForResponse((r) => r.url().includes('/api/secrets') && r.request().method() === 'POST');
    await page.getByTestId('save-secret-btn').click();
    await failedPost;

    // NewSecretModal captures plaintext in pendingRecoveryRef before encrypting,
    // so initialContent passed to the re-opened modal is the original plaintext
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toHaveValue(title);
    await expect(page.getByTestId('tiptap-editor')).toContainText(content);

    await expect(page.getByText('Failed to create secret')).toBeVisible();
    await expect(page.getByText('Your content has been recovered.')).toBeVisible();

    await page.unroute('**/api/secrets');
    const successPost = page.waitForResponse(
      (r) => r.url().includes('/api/secrets') && r.request().method() === 'POST' && r.status() !== 500,
    );
    await page.getByTestId('save-secret-btn').click();
    await successPost;

    await expect(secretCard(page, title)).toBeVisible();
  });

  test('seal: failed POST re-opens NewSealModal pre-filled with plaintext content', async ({ page }) => {
    await setupEncrypted(page, '/seals');
    await unlock(page);

    const title = `Recovery Seal ${Date.now()}`;
    const content = 'Seal recovery body';

    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(content);

    // Intercepting the POST is sufficient — the 2-step mutationFn throws immediately
    // when apiCreateSeal returns non-ok, so the PATCH with encrypted body never runs
    await page.route('**/api/seals', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' });
      } else {
        await route.continue();
      }
    });

    const failedPost = page.waitForResponse((r) => r.url().includes('/api/seals') && r.request().method() === 'POST');
    await page.getByTestId('save-seal-btn').click();
    await failedPost;

    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toHaveValue(title);
    await expect(page.getByTestId('tiptap-editor')).toContainText(content);

    await expect(page.getByText('Failed to create seal')).toBeVisible();
    await expect(page.getByText('Your content has been recovered.')).toBeVisible();

    await page.unroute('**/api/seals');
    const successPost = page.waitForResponse(
      (r) => r.url().includes('/api/seals') && r.request().method() === 'POST' && r.status() !== 500,
    );
    await page.getByTestId('save-seal-btn').click();
    await successPost;

    await expect(sealCard(page, title)).toBeVisible();
  });
});

// ─── Group 2: Edit failure recovery ──────────────────────────────────────────

test.describe('edit failure recovery', () => {
  test('note: failed PATCH keeps NoteModal in edit mode with content intact', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const originalTitle = `Edit Recovery Note ${Date.now()}`;
    await seedNotes(account.address, [{ title: originalTitle, content: '<p>Original content</p>' }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await noteCard(page, originalTitle).click();
    await page.getByTestId('edit-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    const updatedTitle = `${originalTitle} Updated`;
    await page.getByTestId('note-title-input').fill(updatedTitle);

    await page.route('**/api/notes/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' });
      } else {
        await route.continue();
      }
    });

    const failedPatch = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await failedPatch;

    // save-btn still visible means we're back in edit mode
    await expect(page.getByTestId('save-btn')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toHaveValue(updatedTitle);
    await expect(page.getByText('Failed to save note')).toBeVisible();

    await page.unroute('**/api/notes/**');
  });

  test('secret: failed PATCH keeps SecretNoteModal in edit mode with content intact', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const originalTitle = `Edit Recovery Secret ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title: originalTitle, content: 'Original secret content' }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, originalTitle).click();
    await page.getByTestId('edit-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    const updatedTitle = `${originalTitle} Updated`;
    await page.getByTestId('note-title-input').fill(updatedTitle);

    await page.route('**/api/secrets/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' });
      } else {
        await route.continue();
      }
    });

    const failedPatch = page.waitForResponse(
      (r) => r.url().includes('/api/secrets/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await failedPatch;

    await expect(page.getByTestId('save-btn')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toHaveValue(updatedTitle);
    await expect(page.getByText('Failed to save secret')).toBeVisible();

    await page.unroute('**/api/secrets/**');
  });

  test('seal: failed PATCH keeps SealNoteModal in edit mode with content intact', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const originalTitle = `Edit Recovery Seal ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title: originalTitle, content: 'Original seal content' }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, originalTitle).click();
    // Seals require decryption before edit mode is available
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    const updatedTitle = `${originalTitle} Updated`;
    await page.getByTestId('note-title-input').fill(updatedTitle);

    await page.route('**/api/seals/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' });
      } else {
        await route.continue();
      }
    });

    const failedPatch = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await failedPatch;

    await expect(page.getByTestId('save-btn')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toHaveValue(updatedTitle);
    await expect(page.getByText('Failed to save seal')).toBeVisible();

    await page.unroute('**/api/seals/**');
  });
});
