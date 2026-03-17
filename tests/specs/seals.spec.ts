import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSeals } from '../fixtures/seedSeals';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

// Helper: locate a seal card by its visible title text
// NOTE: EncryptedNoteCard renders data-testid="secret-card" for both secrets and seals
const sealCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

// Sign in with a fresh account that already has an encryption profile
const setup = async (page: Page, startUrl = '/seals') => {
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

// ─── Group 1: Create Seal ─────────────────────────────────────────────────────

test.describe('create seal', () => {
  test('create seal with title and content', async ({ page }) => {
    await setup(page);
    await unlock(page);

    const title = `Seal ${Date.now()}`;
    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('My seal content');

    const postPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals') && r.request().method() === 'POST',
    );
    await page.getByTestId('save-seal-btn').click();
    await postPromise;

    await expect(sealCard(page, title)).toBeVisible();
  });

  test('create seal with title only', async ({ page }) => {
    await setup(page);
    await unlock(page);

    const title = `Title Only Seal ${Date.now()}`;
    await page.getByRole('button', { name: 'New Seal' }).click();
    await page.getByTestId('note-title-input').fill(title);

    const postPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals') && r.request().method() === 'POST',
    );
    await page.getByTestId('save-seal-btn').click();
    await postPromise;

    await expect(sealCard(page, title)).toBeVisible();
  });

  test('save button disabled when both fields empty, enabled after typing title', async ({ page }) => {
    await setup(page);
    await unlock(page);

    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await expect(page.getByTestId('save-seal-btn')).toBeDisabled();

    await page.getByTestId('note-title-input').fill('Something');
    await expect(page.getByTestId('save-seal-btn')).toBeEnabled();
  });

  test('clicking New Seal while locked opens passphrase modal then new seal modal', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Locked state: New Seal should prompt for passphrase
    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // Enter correct passphrase
    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    // After unlocking, the new seal modal should open automatically
    await expect(page.getByTestId('note-title-input')).toBeVisible({ timeout: 20000 });
  });
});

// ─── Group 2: View Seal ───────────────────────────────────────────────────────

test.describe('view seal', () => {
  test('card always shows encrypted placeholder even when unlocked', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Locked Grid ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'Secret seal body' }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    // Even after unlocking, card should show encrypted placeholder (unlike secrets)
    const card = sealCard(page, title);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('encrypted-placeholder')).toBeVisible();
  });

  test('clicking card when unlocked opens modal with encrypted placeholder', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Modal Placeholder ${Date.now()}`;
    const contentText = 'This should not appear until decrypted';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();

    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('note-title')).toBeVisible();
    // Content placeholder should be shown inside the modal, not the actual content
    await expect(modal.getByTestId('encrypted-placeholder')).toBeVisible();
    await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();
  });

  test('"Decrypt" button in modal decrypts content', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Decrypt Button ${Date.now()}`;
    const contentText = 'Revealed after decrypt';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    const modal = page.getByTestId('note-modal');
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();
    await page.getByTestId('decrypt-btn').click();

    // Content should now be visible
    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText, { timeout: 10000 });
    await expect(modal.getByTestId('encrypted-placeholder')).not.toBeVisible();
  });

  test('"Encrypt" button re-hides content in modal', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Encrypt Button ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'Some content' }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    const modal = page.getByTestId('note-modal');
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 });

    // Re-lock the content
    await page.getByTestId('encrypt-btn').click();

    await expect(modal.getByTestId('encrypted-placeholder')).toBeVisible();
    await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();
    // Decrypt button should be back
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();
  });

  test('edit button hidden before decrypt, visible after decrypt', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Edit Visibility ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'Some content' }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    // Edit button should NOT be visible before decrypting
    await expect(page.getByTestId('edit-btn')).not.toBeVisible();

    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 });

    // Edit button should be visible after decrypting
    await expect(page.getByTestId('edit-btn')).toBeVisible();
  });

  test('clicking Decrypt while locked triggers passphrase modal then auto-decrypts', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Locked Decrypt Click ${Date.now()}`;
    const contentText = 'Decrypted after passphrase';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Click card while locked → seal modal opens (no passphrase prompt yet)
    await sealCard(page, title).click();
    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();

    // Click Decrypt while locked → triggers passphrase modal
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // Enter passphrase → after unlock, content auto-decrypts
    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText, { timeout: 20000 });
    await expect(modal.getByTestId('encrypted-placeholder')).not.toBeVisible();
  });
});

// ─── Group 3: Edit Seal ───────────────────────────────────────────────────────

test.describe('edit seal', () => {
  test('edit title updates title on card', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const originalTitle = `Original Seal ${Date.now()}`;
    const updatedTitle = `Updated Seal ${Date.now() + 1}`;
    const [seededSeal] = await seedSeals(account.address, mekBytes, [{ title: originalTitle, content: 'Body' }]);
    const originalUpdatedAt = new Date(seededSeal.updatedAt).getTime();

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, originalTitle).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    // Must decrypt first to get edit button
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('edit-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();

    await page.getByTestId('note-title-input').fill(updatedTitle);

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    await expect(sealCard(page, updatedTitle)).toBeVisible();

    const sealsRes = await page.request.get('/api/seals');
    const seals = await sealsRes.json();
    const updated = seals.find((s: { _id: string }) => s._id === seededSeal._id.toString());
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(originalUpdatedAt);
  });

  test('edit content re-encrypts and saves', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Edit Content ${Date.now()}`;
    const [seededSeal] = await seedSeals(account.address, mekBytes, [{ title, content: 'Original content' }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('edit-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();

    // Clear and type new content in the editor
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Updated seal content');

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    // After save, modal returns to view mode — content state reflects the new value
    await expect(page.getByTestId('tiptap-editor')).toContainText('Updated seal content');

    // Verify API confirms encryptedBody and wrappedNoteKey were re-encrypted
    const sealsRes = await page.request.get('/api/seals');
    const seals = await sealsRes.json();
    const updated = seals.find((s: { _id: string }) => s._id === seededSeal._id.toString());
    expect(updated.encryptedBody).not.toBeNull();
    expect(updated.wrappedNoteKey).not.toBeNull();
  });
});

// ─── Group 4: Delete Seal ─────────────────────────────────────────────────────

test.describe('delete seal', () => {
  test('deleted seal disappears from grid immediately', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `To Delete ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('delete-btn').click();

    await expect(sealCard(page, title)).not.toBeVisible();
  });

  test('deleted seal absent after page reload', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Delete Reload ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    const deletePromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'DELETE',
    );
    await page.getByTestId('delete-btn').click();
    await deletePromise;
    await expect(sealCard(page, title)).not.toBeVisible();

    await page.reload();
    await expect(page.getByTestId('wallet-address').first()).toBeVisible({ timeout: 10000 });
    await expect(sealCard(page, title)).not.toBeVisible();
  });

  test('undo delete restores seal', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Undo Delete ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    await page.getByTestId('delete-btn').click();
    await expect(sealCard(page, title)).not.toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect(sealCard(page, title)).toBeVisible();
  });
});

// ─── Group 5: Archive Seal ────────────────────────────────────────────────────

test.describe('archive and unarchive seal', () => {
  test('archive seal moves it to seals archive page', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Archivable Seal ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(sealCard(page, title)).not.toBeVisible();

    await page.goto('/seals/archive');
    await expect(sealCard(page, title)).toBeVisible();
  });

  test('unarchive seal moves it back to main seals grid', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `To Unarchive Seal ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, archived: true }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);
    // Navigate to archive after unlocking (Unlock button only exists on /seals)
    await page.goto('/seals/archive');

    await sealCard(page, title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(sealCard(page, title)).not.toBeVisible();

    await page.goto('/seals');
    await expect(sealCard(page, title)).toBeVisible();
  });
});

// ─── Group 6: Search Seals ────────────────────────────────────────────────────

test.describe('search seals', () => {
  test('search returns both archived and non-archived results by title', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const tag = `srch${Date.now()}`;
    await seedSeals(account.address, mekBytes, [
      { title: `${tag} seal 1` },
      { title: `${tag} seal 2` },
      { title: `${tag} seal 3`, archived: true },
    ]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.getByRole('textbox', { name: 'Search seals' }).fill(tag);

    await expect(sealCard(page, `${tag} seal 1`)).toBeVisible();
    await expect(sealCard(page, `${tag} seal 2`)).toBeVisible();
    await expect(sealCard(page, `${tag} seal 3`)).toBeVisible();

    // Archived card shows badge; active cards do not
    await expect(sealCard(page, `${tag} seal 3`).getByTestId('archived-badge')).toBeVisible();
    await expect(sealCard(page, `${tag} seal 1`).getByTestId('archived-badge')).not.toBeVisible();
  });

  test('search filters out non-matching seals', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const catsTag = `cats${Date.now()}`;
    const dogsTag = `dogs${Date.now()}`;
    await seedSeals(account.address, mekBytes, [
      { title: `${catsTag} seal` },
      { title: `${dogsTag} seal` },
      { title: `${dogsTag} archived`, archived: true },
    ]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);

    const searchInput = page.getByRole('textbox', { name: 'Search seals' });

    await searchInput.fill(dogsTag);
    await expect(sealCard(page, `${dogsTag} seal`)).toBeVisible();
    await expect(sealCard(page, `${dogsTag} archived`)).toBeVisible();
    await expect(sealCard(page, `${catsTag} seal`)).not.toBeVisible();

    await searchInput.fill('nomatch_xyz_99999');
    await expect(page.getByTestId('secret-card')).toHaveCount(0);
  });

  test('clearing search hides archived seals', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const tag = `clr${Date.now()}`;
    await seedSeals(account.address, mekBytes, [
      { title: `${tag} active` },
      { title: `${tag} archived`, archived: true },
    ]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);

    const searchInput = page.getByRole('textbox', { name: 'Search seals' });
    await searchInput.fill(tag);

    await expect(sealCard(page, `${tag} active`)).toBeVisible();
    await expect(sealCard(page, `${tag} archived`)).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();

    await expect(sealCard(page, `${tag} active`)).toBeVisible();
    await expect(sealCard(page, `${tag} archived`)).not.toBeVisible();
  });
});
