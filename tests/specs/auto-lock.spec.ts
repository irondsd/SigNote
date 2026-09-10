/**
 * Auto-lock tests
 *
 * Tests for soft lock (tab visibility), hard lock (inactivity/sleep)
 */

import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';
import { settleModal } from '../utils/settleModal';
import { testDb } from '../fixtures/db';
import { sealNoteVersions, secretNoteVersions } from '../../src/db/schema';

test.describe.configure({ mode: 'parallel' });

// Cover every plaintext surface while preserving the unsaved editor buffer.
test.describe('locking covers creation and history', () => {
  for (const tier of ['Secret', 'Seal'] as const) {
    for (const lock of ['soft', 'hard'] as const) {
      test(`${lock} lock hides an unsaved new ${tier} body`, async ({ page }) => {
        const model = tier === 'Secret' ? new SecretsPage(page) : new SealsPage(page);
        await model.signInDirectly();
        if (lock === 'hard') await page.clock.install();
        await model.unlock();
        await page.getByRole('button', { name: `New ${tier}`, exact: true }).click();
        await page.getByTestId('note-title-input').fill(`Unsaved ${tier}`);
        const editor = page.locator('.ProseMirror');
        const sentinel = `PRIVATE_UNSAVED_${tier}_${lock}`;
        await editor.fill(sentinel);
        await expect(editor).toBeVisible();
        await expect(editor).toContainText(sentinel);

        if (lock === 'soft') await model.simulateTabHidden();
        else await page.clock.fastForward(5 * 60_000 + 1000);
        await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');
        if (lock === 'hard') {
          await expect.poll(() => page.evaluate(() => sessionStorage.getItem('enc_device_share_v1'))).toBeNull();
        }

        await expect.soft(editor, 'locked creation editor must not display plaintext').not.toBeVisible();
        await expect(editor).toHaveAttribute('contenteditable', 'false');
        await expect(page.getByRole('button', { name: 'Formatting options' })).not.toBeVisible();
        await expect(page.getByTestId('note-content-veil')).toBeVisible();
        await page.getByTestId('reveal-content-btn').click();
        if (lock === 'hard') {
          await page.getByPlaceholder('Your passphrase').fill(SecretsPage.PASSPHRASE);
          await page.getByRole('button', { name: 'Unlock', exact: true }).last().click();
        } else {
          await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
        }
        await expect(editor).toBeVisible();
        await expect(editor).toContainText(sentinel);
        await expect(page.getByTestId('note-title-input')).toHaveValue(`Unsaved ${tier}`);
      });
    }

    test(`soft lock closes ${tier} history into the veiled note modal`, async ({ page }) => {
      const { account } = makeAccount();
      const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
      const title = `${tier} history lock`;
      const sentinel = `PRIVATE_HISTORY_${tier}`;
      const [note] =
        tier === 'Secret'
          ? await seedSecrets(account.address, mekBytes, [{ title, content: sentinel }])
          : await seedSeals(account.address, mekBytes, [{ title, content: sentinel }]);
      // A real historical row uses the same valid payload/key as its head.
      // Selecting it catches stale decrypted versions even if the Seal head
      // itself is re-encrypted when the vault soft-locks.
      await testDb()
        .insert(tier === 'Secret' ? secretNoteVersions : sealNoteVersions)
        .values({
          noteId: note.id,
          title: 'Historical snapshot',
          encryptedBody: note.encryptedBody,
          createdAt: new Date(Date.now() - 3600_000),
        });
      const model = tier === 'Secret' ? new SecretsPage(page) : new SealsPage(page);
      await model.signInDirectly(account.address);
      await model.unlock();
      await page.getByTestId('secret-card').filter({ hasText: title }).click();
      if (tier === 'Seal') await page.getByTestId('decrypt-btn').click();
      await expect(page.getByTestId('tiptap-editor')).toContainText(sentinel);
      await settleModal(page);
      await page.getByTestId('more-actions-btn').click();
      await page.getByTestId('version-history-item').click();
      await expect(page.getByTestId('version-row')).toHaveCount(2);
      await page.getByTestId('version-row').last().click();
      await expect(page.getByTestId('version-title')).toHaveText('Historical snapshot');
      await expect(page.getByTestId('version-content')).toBeVisible();
      await expect(page.getByTestId('version-content')).toContainText(sentinel);

      await model.simulateTabHidden();
      await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');
      await expect
        .soft(page.getByTestId('version-content'), 'locked history must not display plaintext')
        .not.toBeVisible();
      await expect.soft(page.getByTestId('version-sidebar'), 'soft lock must exit history').not.toBeVisible();
      await expect(page.getByTestId('note-modal')).toBeVisible();
      await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();
      if (tier === 'Seal') {
        // The lock re-encrypted the head, so the seal is back to its own
        // placeholder and "Decrypt to view" — nothing left for a cover to hide.
        await expect(page.getByTestId('note-content-veil')).not.toBeVisible();
        await page.getByTestId('decrypt-btn').click();
      } else {
        await expect(page.getByTestId('note-content-veil')).toBeVisible();
        await page.getByTestId('reveal-content-btn').click();
      }
      await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('version-sidebar')).not.toBeVisible();
      await expect(page.getByTestId('tiptap-editor')).toContainText(sentinel);
    });
  }
});

// ─── Soft Lock ──────────────────────────────────────────────────────────────

test.describe('soft lock', () => {
  test('hiding tab triggers soft lock — grid shows placeholders', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'SoftLock Secret', content: 'classified info' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    // Verify decrypted preview is visible
    await expect(page.getByTestId('secret-card')).toBeVisible();
    await expect(page.getByText('classified info')).toBeVisible();

    // Simulate tab hidden
    await secretsPage.simulateTabHidden();

    // Should show Unlock button (soft locked) and encrypted placeholder
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('classified info')).not.toBeVisible();
  });

  test('clicking secret card after soft lock does not require passphrase', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'CardClick Secret', content: 'card click test' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    // Soft lock
    await secretsPage.simulateTabHidden();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });

    // Click the card — should NOT show passphrase modal, modal opens directly
    await page.getByTestId('secret-card').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByTestId('tiptap-editor').getByText('card click test')).toBeVisible({ timeout: 10000 });
  });

  test('soft unlock does not require passphrase', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'ReUnlock Secret', content: 'soft unlock test' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    // Soft lock
    await secretsPage.simulateTabHidden();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });

    // Click Unlock — should NOT show passphrase modal
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();

    // Should be unlocked without passphrase input
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('soft unlock test')).toBeVisible({ timeout: 10000 });
  });

  test('save secret after soft lock does not require passphrase', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'SaveSoftLock Secret', content: 'save after soft lock' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    // Open the secret modal and enter editing mode
    await page.getByTestId('secret-card').click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();

    // Soft lock while in editing mode
    await secretsPage.simulateTabHidden();

    // Click Save — should NOT show passphrase modal
    await page.getByTestId('save-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    // Editing mode should exit after save
    await expect(page.getByTestId('save-btn')).not.toBeVisible({ timeout: 10000 });
  });
});

// ─── Soft Lock — Seals ──────────────────────────────────────────────────────

test.describe('soft lock — seals', () => {
  test('soft lock re-encrypts an open decrypted seal', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    await seedSeals(account.address, mekBytes, [{ title: 'SoftLock Seal', content: 'sealed secret' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    // Open the seal and decrypt it
    await sealsPage.sealCard('SoftLock Seal').click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByText('sealed secret')).toBeVisible({ timeout: 10000 });

    // Simulate tab hidden — soft lock fires
    await sealsPage.simulateTabHidden();

    // Modal should re-encrypt: content hidden, Decrypt button visible again
    await expect(page.getByTestId('decrypt-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('sealed secret')).not.toBeVisible();
  });

  test('decrypt after soft lock does not require passphrase', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    await seedSeals(account.address, mekBytes, [{ title: 'ReDecrypt Seal', content: 'soft decrypt test' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    // Open the seal and decrypt it
    await sealsPage.sealCard('ReDecrypt Seal').click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByText('soft decrypt test')).toBeVisible({ timeout: 10000 });

    // Simulate tab hidden — soft lock fires
    await sealsPage.simulateTabHidden();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible({ timeout: 5000 });

    // Click Decrypt — should NOT show passphrase modal, content appears directly
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByText('soft decrypt test')).toBeVisible({ timeout: 10000 });
  });

  test('save seal after soft lock does not require passphrase', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    await seedSeals(account.address, mekBytes, [{ title: 'SaveSoftLock Seal', content: 'save seal after soft lock' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    // Open the seal, decrypt, and enter editing mode
    await sealsPage.sealCard('SaveSoftLock Seal').click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByText('save seal after soft lock')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();

    // Soft lock while in editing mode
    await sealsPage.simulateTabHidden();

    // Click Save — should NOT show passphrase modal
    await page.getByTestId('save-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    // Editing mode should exit after save
    await expect(page.getByTestId('save-btn')).not.toBeVisible({ timeout: 10000 });
  });
});

// ─── Hard Lock ──────────────────────────────────────────────────────────────

test.describe('hard lock', () => {
  test('hard lock closes open seal modal, and seal can be reopened afterwards', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    await seedSeals(account.address, mekBytes, [{ title: 'HardLock Seal', content: 'secret content' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    // Open the seal modal
    await sealsPage.sealCard('HardLock Seal').click();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();

    // Simulate 5-minute inactivity hard lock firing while the modal is open.
    await sealsPage.simulateHardLock();

    // Modal should close and vault should be locked
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('decrypt-btn')).not.toBeVisible();

    // Clicking the seal card should open the modal again
    await sealsPage.sealCard('HardLock Seal').click();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible({ timeout: 5000 });
  });

  test('manual lock (hard lock) clears deviceShare and requires passphrase', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await secretsPage.unlock();

    // Lock via button (this is effectively a hard lock)
    await secretsPage.lock();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();

    // Unlock should now require passphrase
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  });

  test('after hard lock (Lock button), unlock requires passphrase', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await secretsPage.unlock();

    // Lock via button
    await secretsPage.lock();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();

    // Clicking Unlock should show passphrase modal (not silent rehydrate)
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  });
});

// ─── Open modals must not outlive the lock ──────────────────────────────────

/**
 * The grid swaps to placeholders the moment a lock fires; a modal already on
 * screen used to keep rendering its plaintext, so a tab switch hid every note
 * except the one actually open. The cover closes that, and unlike closing the
 * modal it also works mid-edit, where the buffer is unsaved and cannot be
 * thrown away.
 */
test.describe('locking covers an open modal', () => {
  test('soft lock covers an open secret in view mode', async ({ page }) => {
    const sentinel = 'soft lock view body';
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'Cover view', content: sentinel }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    await secretsPage.secretCard('Cover view').click();
    await expect(page.getByTestId('tiptap-editor')).toContainText(sentinel, { timeout: 10000 });

    await secretsPage.simulateTabHidden();

    await expect(page.getByTestId('note-content-veil')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();
  });

  test('soft lock covers a secret being edited, and Reveal restores it unsaved', async ({ page }) => {
    const typed = 'unsaved words that must survive';
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'Cover edit', content: 'original' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    await secretsPage.secretCard('Cover edit').click();
    await page.getByTestId('edit-btn').click();
    await page.locator('.ProseMirror[contenteditable="true"]').fill(typed);

    await secretsPage.simulateTabHidden();

    await expect(page.getByTestId('note-content-veil')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();

    // Soft lock, so Reveal costs a click and not a passphrase — and the edit
    // is still there, which is the whole reason the modal is covered rather
    // than closed.
    await page.getByTestId('reveal-content-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByTestId('tiptap-editor')).toContainText(typed, { timeout: 10000 });
    await expect(page.getByTestId('save-btn')).toBeVisible();
  });

  test('hard lock covers a secret being edited and Reveal asks for the passphrase', async ({ page }) => {
    const sentinel = 'hard lock edit body';
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'Hard cover', content: sentinel }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    await secretsPage.secretCard('Hard cover').click();
    await page.getByTestId('edit-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toContainText(sentinel, { timeout: 10000 });

    // The modal stays open — discarding an unsaved edit is not the lock's job —
    // but the body must not stay readable.
    await secretsPage.simulateHardLock();

    await expect(page.getByTestId('note-content-veil')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('tiptap-editor')).not.toBeVisible();

    await page.getByTestId('reveal-content-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  });

  /**
   * A seal is decrypted per-note, on demand, so a locked vault is its ordinary
   * resting state — the modal already renders a placeholder behind "Decrypt to
   * view". Covering that put a second placeholder and a "Reveal" button on top
   * of the first, offering to reveal a body nobody had decrypted.
   */
  test('opening a seal on a locked vault shows no cover', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    await seedSeals(account.address, mekBytes, [{ title: 'Never unlocked', content: 'sealed body' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');

    await sealsPage.sealCard('Never unlocked').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();
    await expect(page.getByTestId('note-content-veil')).not.toBeVisible();
    await expect(page.getByTestId('reveal-content-btn')).not.toBeVisible();

    // The single button that is offered is the one that works.
    await page.getByTestId('decrypt-btn').click();
    await page.getByPlaceholder('Your passphrase').fill(SealsPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock', exact: true }).last().click();
    await expect(page.getByTestId('tiptap-editor')).toContainText('sealed body', { timeout: 10000 });
    await expect(page.getByTestId('note-content-veil')).not.toBeVisible();
  });

  test('opening a seal after a soft lock shows no cover', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    await seedSeals(account.address, mekBytes, [{ title: 'Soft locked seal', content: 'sealed body' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();
    await sealsPage.simulateTabHidden();
    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');

    await sealsPage.sealCard('Soft locked seal').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page.getByTestId('decrypt-btn')).toBeVisible();
    await expect(page.getByTestId('note-content-veil')).not.toBeVisible();

    // A soft lock costs a click and no passphrase, here as everywhere else.
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByTestId('tiptap-editor')).toContainText('sealed body', { timeout: 10000 });
  });

  test('soft lock covers a seal being edited', async ({ page }) => {
    const sentinel = 'sealed words being edited';
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    await seedSeals(account.address, mekBytes, [{ title: 'Cover seal edit', content: sentinel }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard('Cover seal edit').click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByText(sentinel)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();

    await sealsPage.simulateTabHidden();

    await expect(page.getByTestId('note-content-veil')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(sentinel)).not.toBeVisible();
  });
});
