import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

// Helper: locate a secret card by its visible title text
const secretCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

// Sign in with a fresh account that already has an encryption profile
const setup = async (page: Page, startUrl = '/secrets') => {
  const { privateKey, account } = makeAccount();
  const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);

  return { privateKey, account, mekBytes };
};

// Unlock the session via PassphraseModal
const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).last().click();
  // PBKDF2 at 600k iterations can be slow; allow enough time
  await expect(page.getByText('Unlocked')).toBeVisible({ timeout: 20000 });
};

// ─── Group 1: Create Secret ───────────────────────────────────────────────────

test.describe('create secret', () => {
  test('create secret with title and content', async ({ page }) => {
    await setup(page);
    await unlock(page);

    const title = `Secret ${Date.now()}`;
    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('My secret content');

    const postPromise = page.waitForResponse(
      (r) => r.url().includes('/api/secrets') && r.request().method() === 'POST',
    );
    await page.getByTestId('save-secret-btn').click();
    await postPromise;

    await expect(secretCard(page, title)).toBeVisible();
  });

  test('create secret with title only', async ({ page }) => {
    await setup(page);
    await unlock(page);

    const title = `Title Only Secret ${Date.now()}`;
    await page.getByRole('button', { name: 'New Secret' }).click();
    await page.getByTestId('note-title-input').fill(title);

    const postPromise = page.waitForResponse(
      (r) => r.url().includes('/api/secrets') && r.request().method() === 'POST',
    );
    await page.getByTestId('save-secret-btn').click();
    await postPromise;

    await expect(secretCard(page, title)).toBeVisible();
  });

  test('save button disabled when both fields empty, enabled after typing title', async ({ page }) => {
    await setup(page);
    await unlock(page);

    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await expect(page.getByTestId('save-secret-btn')).toBeDisabled();

    await page.getByTestId('note-title-input').fill('Something');
    await expect(page.getByTestId('save-secret-btn')).toBeEnabled();
  });

  test('clicking New Secret while locked opens passphrase modal then new secret modal', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Locked state: New Secret should prompt for passphrase
    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // Enter correct passphrase
    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    // After unlocking, the new secret modal should open automatically
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });
});

// ─── Group 2: View Secret ─────────────────────────────────────────────────────

test.describe('view secret', () => {
  test('card shows encrypted placeholder when locked', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Locked Preview ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title, content: 'Secret body' }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Encrypted placeholder should be present instead of content
    const card = secretCard(page, title);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('encrypted-placeholder')).toBeVisible();
  });

  test('card shows decrypted preview text when unlocked', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    const title = `Unlocked Preview ${Date.now()}`;
    const contentText = 'My decrypted secret preview';
    await seedSecrets(account.address, mekBytes, [{ title, content: contentText }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    const card = secretCard(page, title);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('encrypted-placeholder')).not.toBeVisible();
    await expect(card).toContainText(contentText);
  });

  test('clicking card when unlocked opens modal with decrypted content', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Open Unlocked ${Date.now()}`;
    const contentText = 'Decrypted modal content';
    await seedSecrets(account.address, mekBytes, [{ title, content: contentText }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();

    await expect(page.getByTestId('note-title')).toBeVisible();
    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText);
  });

  test('clicking card when locked opens passphrase modal then secret modal', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Open Locked ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title, content: 'Content after unlock' }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Click card while locked → triggers passphrase modal
    await secretCard(page, title).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // Unlock via modal
    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    // Secret modal should open after unlock
    await expect(page.getByTestId('note-title')).toBeVisible({ timeout: 20000 });
  });

  test('clicking card when locked shows decrypted content in modal immediately after unlock', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `First Unlock Content ${Date.now()}`;
    const contentText = 'Secret content visible after unlock';
    await seedSecrets(account.address, mekBytes, [{ title, content: contentText }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Click card while locked
    await secretCard(page, title).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // Unlock
    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    // Modal should show content immediately — without close/reopen
    await expect(page.getByTestId('note-title')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText, { timeout: 5000 });
  });
});

// ─── Group 3: Edit Secret ─────────────────────────────────────────────────────

test.describe('edit secret', () => {
  test('edit title updates title and bumps updatedAt', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const originalTitle = `Original Secret ${Date.now()}`;
    const updatedTitle = `Updated Secret ${Date.now() + 1}`;
    const [seededSecret] = await seedSecrets(account.address, mekBytes, [{ title: originalTitle }]);
    const originalUpdatedAt = new Date(seededSecret.updatedAt).getTime();

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, originalTitle).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('edit-btn').click();

    await page.getByTestId('note-title-input').fill(updatedTitle);

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/secrets/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    await expect(secretCard(page, updatedTitle)).toBeVisible();

    const secretsRes = await page.request.get('/api/secrets');
    const secrets = await secretsRes.json();
    const updated = secrets.find((s: { _id: string }) => s._id === seededSecret._id.toString());
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(originalUpdatedAt);
  });

  test('edit content re-encrypts and saves', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Edit Content ${Date.now()}`;
    const originalContent = 'Original content';
    const [seededSecret] = await seedSecrets(account.address, mekBytes, [{ title, content: originalContent }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('edit-btn').click();

    // Clear and type new content in the editor
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Updated secret content');

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/secrets/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    // After save, modal returns to view mode — content state reflects the new value
    await expect(page.getByTestId('tiptap-editor')).toContainText('Updated secret content');

    // Verify API confirms encryptedBody was re-encrypted (not null)
    const secretsRes = await page.request.get('/api/secrets');
    const secrets = await secretsRes.json();
    const updated = secrets.find((s: { _id: string }) => s._id === seededSecret._id.toString());
    expect(updated.encryptedBody).not.toBeNull();
  });
});

// ─── Group 4: Delete Secret ───────────────────────────────────────────────────

test.describe('delete secret', () => {
  test('deleted secret disappears from grid immediately', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `To Delete ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('delete-btn').click();

    await expect(secretCard(page, title)).not.toBeVisible();
  });

  test('deleted secret absent after page reload', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Delete Reload ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();
    await page.getByTestId('delete-btn').click();
    await expect(secretCard(page, title)).not.toBeVisible();

    await page.reload();
    await expect(page.getByTestId('wallet-address').first()).toBeVisible({ timeout: 10000 });
    await expect(secretCard(page, title)).not.toBeVisible();
  });

  test('undo delete restores secret', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Undo Delete ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();
    await page.getByTestId('delete-btn').click();
    await expect(secretCard(page, title)).not.toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect(secretCard(page, title)).toBeVisible();
  });
});

// ─── Group 5: Archive Secret ─────────────────────────────────────────────────

test.describe('archive and unarchive secret', () => {
  test('archive secret moves it to secrets archive page', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Archivable Secret ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/secrets/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(secretCard(page, title)).not.toBeVisible();

    await page.goto('/secrets/archive');
    await expect(secretCard(page, title)).toBeVisible();
  });

  test('unarchive secret moves it back to main secrets grid', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `To Unarchive Secret ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title, archived: true }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);
    // Navigate to archive after unlocking (Unlock button only exists on /secrets)
    await page.goto('/secrets/archive');

    await secretCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/secrets/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(secretCard(page, title)).not.toBeVisible();

    await page.goto('/secrets');
    await expect(secretCard(page, title)).toBeVisible();
  });
});

// ─── Group 6: Search Secrets ─────────────────────────────────────────────────

test.describe('search secrets', () => {
  test('search returns both archived and non-archived results by title', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const tag = `srch${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [
      { title: `${tag} secret 1` },
      { title: `${tag} secret 2` },
      { title: `${tag} secret 3`, archived: true },
    ]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.getByRole('textbox', { name: 'Search secrets' }).fill(tag);

    await expect(secretCard(page, `${tag} secret 1`)).toBeVisible();
    await expect(secretCard(page, `${tag} secret 2`)).toBeVisible();
    await expect(secretCard(page, `${tag} secret 3`)).toBeVisible();

    // Archived card shows badge; active cards do not
    await expect(secretCard(page, `${tag} secret 3`).getByTestId('archived-badge')).toBeVisible();
    await expect(secretCard(page, `${tag} secret 1`).getByTestId('archived-badge')).not.toBeVisible();
  });

  test('search filters out non-matching secrets', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const catsTag = `cats${Date.now()}`;
    const dogsTag = `dogs${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [
      { title: `${catsTag} secret` },
      { title: `${dogsTag} secret` },
      { title: `${dogsTag} archived`, archived: true },
    ]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    const searchInput = page.getByRole('textbox', { name: 'Search secrets' });

    await searchInput.fill(dogsTag);
    await expect(secretCard(page, `${dogsTag} secret`)).toBeVisible();
    await expect(secretCard(page, `${dogsTag} archived`)).toBeVisible();
    await expect(secretCard(page, `${catsTag} secret`)).not.toBeVisible();

    await searchInput.fill('nomatch_xyz_99999');
    await expect(page.getByTestId('secret-card')).toHaveCount(0);
  });

  test('clearing search hides archived secrets', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const tag = `clr${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [
      { title: `${tag} active` },
      { title: `${tag} archived`, archived: true },
    ]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    const searchInput = page.getByRole('textbox', { name: 'Search secrets' });
    await searchInput.fill(tag);

    await expect(secretCard(page, `${tag} active`)).toBeVisible();
    await expect(secretCard(page, `${tag} archived`)).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();

    await expect(secretCard(page, `${tag} active`)).toBeVisible();
    await expect(secretCard(page, `${tag} archived`)).not.toBeVisible();
  });
});

// ─── Group 7: Infinite Scroll Decryption ─────────────────────────────────────

test.describe('infinite scroll decryption', () => {
  test('secrets loaded via infinite scroll are auto-decrypted when already unlocked', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    // Seed 50 secrets: 'Secret 01' gets lowest position → appears last in desc sort
    await seedSecrets(
      account.address,
      mekBytes,
      Array.from({ length: 50 }, (_, i) => {
        const num = String(i + 1).padStart(2, '0');
        return { title: `Secret ${num}`, content: `Content of Secret ${num}` };
      }),
    );

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    // Page 1 (30 items): Secret 50 → Secret 21
    await expect(secretCard(page, 'Secret 50')).toBeVisible();

    // Scroll 1 — load page 2: Secret 20 → Secret 11
    const scroll1 = page.waitForResponse((r) => r.url().includes('/api/secrets') && r.request().method() === 'GET');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await scroll1;

    // Scroll 2 — load page 3: Secret 10 → Secret 01
    const scroll2 = page.waitForResponse((r) => r.url().includes('/api/secrets') && r.request().method() === 'GET');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await scroll2;

    // Secret 01 should now be visible on screen
    await expect(secretCard(page, 'Secret 01')).toBeVisible();

    // And it should be auto-decrypted: no encrypted placeholder, content visible
    await expect(secretCard(page, 'Secret 01').getByTestId('encrypted-placeholder')).not.toBeVisible();
    await expect(secretCard(page, 'Secret 01')).toContainText('Content of Secret 01');
  });
});
