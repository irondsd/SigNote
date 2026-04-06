import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSeals } from '../fixtures/seedSeals';
import { SealsPage } from '../pages/SealsPage';
import { clearSession } from '../utils/clearSession';

test.describe.configure({ mode: 'parallel' });

// ─── Group 1: Create Seal ─────────────────────────────────────────────────────

test.describe('create seal', () => {
  test('create seal with title and content', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly();
    await sealsPage.unlock();

    const title = `Seal ${Date.now()}`;
    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('My seal content');

    const postPromise = page.waitForResponse((r) => r.url().includes('/api/seals') && r.request().method() === 'POST');
    await page.getByTestId('save-seal-btn').click();
    await postPromise;

    await expect(sealsPage.sealCard(title)).toBeVisible();
  });

  test('create seal with title only', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly();
    await sealsPage.unlock();

    const title = `Title Only Seal ${Date.now()}`;
    await page.getByRole('button', { name: 'New Seal' }).click();
    await page.getByTestId('note-title-input').fill(title);

    const postPromise = page.waitForResponse((r) => r.url().includes('/api/seals') && r.request().method() === 'POST');
    await page.getByTestId('save-seal-btn').click();
    await postPromise;

    await expect(sealsPage.sealCard(title)).toBeVisible();
  });

  test('save button disabled when both fields empty, enabled after typing title', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly();
    await sealsPage.unlock();

    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await expect(page.getByTestId('save-seal-btn')).toBeDisabled();

    await page.getByTestId('note-title-input').fill('Something');
    await expect(page.getByTestId('save-seal-btn')).toBeEnabled();
  });

  test('clicking New Seal while locked opens passphrase modal then new seal modal', async ({ page }) => {
    const { account } = makeAccount();
    await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    // Locked state: New Seal should prompt for passphrase
    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // Enter correct passphrase
    await page.getByPlaceholder('Your passphrase').fill(SealsPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    // After unlocking, the new seal modal should open automatically
    await expect(page.getByTestId('note-title-input')).toBeVisible({ timeout: 20000 });
  });
});

// ─── Group 2: View Seal ───────────────────────────────────────────────────────

test.describe('view seal', () => {
  test('card always shows encrypted placeholder even when unlocked', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Locked Grid ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'Secret seal body' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    // Even after unlocking, card should show encrypted placeholder (unlike secrets)
    const card = sealsPage.sealCard(title);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('encrypted-placeholder')).toBeVisible();
  });

  test('clicking card when unlocked opens modal with encrypted placeholder', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Modal Placeholder ${Date.now()}`;
    const contentText = 'This should not appear until decrypted';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();

    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('note-title')).toBeVisible();
    // Content placeholder should be shown inside the modal, not the actual content
    await expect(modal.getByTestId('encrypted-placeholder')).toBeVisible();
    await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();
  });

  test('"Decrypt" button in modal decrypts content', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Decrypt Button ${Date.now()}`;
    const contentText = 'Revealed after decrypt';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    const modal = page.getByTestId('note-modal');
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();
    await page.getByTestId('decrypt-btn').click();

    // Content should now be visible
    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText, { timeout: 10000 });
    await expect(modal.getByTestId('encrypted-placeholder')).not.toBeVisible();
  });

  test('"Encrypt" button re-hides content in modal', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Encrypt Button ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'Some content' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
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
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Edit Visibility ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'Some content' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    // Edit button should NOT be visible before decrypting
    await expect(page.getByTestId('edit-btn')).not.toBeVisible();

    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 });

    // Edit button should be visible after decrypting
    await expect(page.getByTestId('edit-btn')).toBeVisible();
  });

  test('clicking Decrypt while locked triggers passphrase modal then auto-decrypts', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Locked Decrypt Click ${Date.now()}`;
    const contentText = 'Decrypted after passphrase';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    // Click card while locked → seal modal opens (no passphrase prompt yet)
    await sealsPage.sealCard(title).click();
    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();

    // Click Decrypt while locked → triggers passphrase modal
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // Enter passphrase → after unlock, content auto-decrypts
    await page.getByPlaceholder('Your passphrase').fill(SealsPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText, { timeout: 20000 });
    await expect(modal.getByTestId('encrypted-placeholder')).not.toBeVisible();
  });
});

// ─── Group 3: Edit Seal ───────────────────────────────────────────────────────

test.describe('edit seal', () => {
  test('edit title updates title on card', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const originalTitle = `Original Seal ${Date.now()}`;
    const updatedTitle = `Updated Seal ${Date.now() + 1}`;
    const [seededSeal] = await seedSeals(account.address, mekBytes, [{ title: originalTitle, content: 'Body' }]);
    const originalUpdatedAt = new Date(seededSeal.updatedAt).getTime();

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(originalTitle).click();
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

    await expect(sealsPage.sealCard(updatedTitle)).toBeVisible();

    const sealsRes = await page.request.get('/api/seals');
    const seals = await sealsRes.json();
    const updated = seals.find((s: { _id: string }) => s._id === seededSeal._id.toString());
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(originalUpdatedAt);
  });

  test('edit content re-encrypts and saves', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Edit Content ${Date.now()}`;
    const [seededSeal] = await seedSeals(account.address, mekBytes, [{ title, content: 'Original content' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
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
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `To Delete ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('delete-btn').click();

    await expect(sealsPage.sealCard(title)).not.toBeVisible();
  });

  test('deleted seal absent after page reload', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Delete Reload ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    const deletePromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'DELETE',
    );
    await page.getByTestId('delete-btn').click();
    await deletePromise;
    await expect(sealsPage.sealCard(title)).not.toBeVisible();

    await clearSession(page);
    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(sealsPage.sealCard(title)).not.toBeVisible();
  });

  test('undo delete restores seal', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Undo Delete ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await page.getByTestId('delete-btn').click();
    await expect(sealsPage.sealCard(title)).not.toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect(sealsPage.sealCard(title)).toBeVisible();
  });
});

// ─── Group 5: Archive Seal ────────────────────────────────────────────────────

test.describe('archive and unarchive seal', () => {
  test('archive seal moves it to seals archive page', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Archivable Seal ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(sealsPage.sealCard(title)).not.toBeVisible();

    await page.goto('/seals/archive');
    await expect(sealsPage.sealCard(title)).toBeVisible();
  });

  test('unarchive seal moves it back to main seals grid', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `To Unarchive Seal ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, archived: true }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();
    // Navigate to archive after unlocking (Unlock button only exists on /seals)
    await page.goto('/seals/archive');

    await sealsPage.sealCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/seals/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(sealsPage.sealCard(title)).not.toBeVisible();

    await clearSession(page);
    await page.goto('/seals');
    await expect(sealsPage.sealCard(title)).toBeVisible();
  });
});

// ─── Group 6: Auto-Encrypt Timer ─────────────────────────────────────────────

test.describe('auto-encrypt timer', () => {
  test('decrypted seal auto-encrypts after 60 seconds', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Auto Encrypt ${Date.now()}`;
    const contentText = 'Timer should hide this';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    // Accelerate setInterval so 1s ticks become 10ms (~600ms total for 60 ticks)
    await page.addInitScript(() => {
      const orig = window.setInterval.bind(window);
      // @ts-expect-error override
      window.setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => orig(fn, 10, ...args);
    });

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    const modal = page.getByTestId('note-modal');
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText, { timeout: 10000 });

    // Auto-encrypt should fire after ~600ms (60 ticks * 10ms)
    await expect(modal.getByTestId('encrypted-placeholder')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();
  });

  test('clicking timer extends time and prevents auto-encrypt', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Extend Timer ${Date.now()}`;
    const contentText = 'Should stay visible';
    await seedSeals(account.address, mekBytes, [{ title, content: contentText }]);

    // Accelerate setInterval: 1s ticks become 100ms (gives time to interact between ticks)
    await page.addInitScript(() => {
      const orig = window.setInterval.bind(window);
      // @ts-expect-error override
      window.setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => orig(fn, 100, ...args);
    });

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText, { timeout: 10000 });

    // Wait ~3s (30 of 60 ticks at 100ms), then click timer to add 60s
    await page.waitForTimeout(3000);
    await page.getByTestId('decrypt-timer').click();

    // Content should still be visible — timer was extended
    await expect(page.getByTestId('tiptap-editor')).toContainText(contentText);

    // Eventually auto-encrypt should fire after remaining ~90 ticks * 100ms = ~9s
    await expect(page.getByTestId('encrypted-placeholder')).toBeVisible({ timeout: 15000 });
  });
});

// ─── Group 7: Search Seals ────────────────────────────────────────────────────

test.describe('search seals', () => {
  test('search returns both archived and non-archived results by title', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const tag = `srch${Date.now()}`;
    await seedSeals(account.address, mekBytes, [
      { title: `${tag} seal 1` },
      { title: `${tag} seal 2` },
      { title: `${tag} seal 3`, archived: true },
    ]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Search seals' }).fill(tag);

    await expect(sealsPage.sealCard(`${tag} seal 1`)).toBeVisible();
    await expect(sealsPage.sealCard(`${tag} seal 2`)).toBeVisible();
    await expect(sealsPage.sealCard(`${tag} seal 3`)).toBeVisible();

    // Archived card shows badge; active cards do not
    await expect(sealsPage.sealCard(`${tag} seal 3`).getByTestId('archived-badge')).toBeVisible();
    await expect(sealsPage.sealCard(`${tag} seal 1`).getByTestId('archived-badge')).not.toBeVisible();
  });

  test('search filters out non-matching seals', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const catsTag = `cats${Date.now()}`;
    const dogsTag = `dogs${Date.now()}`;
    await seedSeals(account.address, mekBytes, [
      { title: `${catsTag} seal` },
      { title: `${dogsTag} seal` },
      { title: `${dogsTag} archived`, archived: true },
    ]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    await page.getByRole('button', { name: 'Search' }).click();
    const searchInput = page.getByRole('textbox', { name: 'Search seals' });

    await searchInput.fill(dogsTag);
    await expect(sealsPage.sealCard(`${dogsTag} seal`)).toBeVisible();
    await expect(sealsPage.sealCard(`${dogsTag} archived`)).toBeVisible();
    await expect(sealsPage.sealCard(`${catsTag} seal`)).not.toBeVisible();

    await searchInput.fill('nomatch_xyz_99999');
    await expect(page.getByTestId('secret-card')).toHaveCount(0);
  });

  test('clearing search hides archived seals', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const tag = `clr${Date.now()}`;
    await seedSeals(account.address, mekBytes, [
      { title: `${tag} active` },
      { title: `${tag} archived`, archived: true },
    ]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    await page.getByRole('button', { name: 'Search' }).click();
    const searchInput = page.getByRole('textbox', { name: 'Search seals' });
    await searchInput.fill(tag);

    await expect(sealsPage.sealCard(`${tag} active`)).toBeVisible();
    await expect(sealsPage.sealCard(`${tag} archived`)).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();

    await expect(sealsPage.sealCard(`${tag} active`)).toBeVisible();
    await expect(sealsPage.sealCard(`${tag} archived`)).not.toBeVisible();
  });
});
