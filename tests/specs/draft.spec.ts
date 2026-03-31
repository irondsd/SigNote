import { test, expect, type Page } from '@playwright/test';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';

test.describe.configure({ mode: 'parallel' });

const DRAFT_KEY = 'sn_draft';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getDraft = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, DRAFT_KEY);

const seedDraft = (
  page: Page,
  data: { type: 'note' | 'secret' | 'seal'; title: string; content: string; encrypted: boolean },
) =>
  page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() })), {
    key: DRAFT_KEY,
    draft: data,
  });

// ─── Group 1: Draft saving ────────────────────────────────────────────────────

test.describe('draft saving', () => {
  test('saves note draft to localStorage after typing content', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByTestId('note-title-input').fill('My Draft');
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('Draft body here');

    await page.waitForTimeout(700); // debounce is 500ms

    const draft = await getDraft(page);
    expect(draft).not.toBeNull();
    expect(draft.type).toBe('note');
    expect(draft.title).toBe('My Draft');
    expect(draft.encrypted).toBe(false);
    expect(draft.content).toContain('Draft body here');
    expect(draft.savedAt).toBeGreaterThan(0);
  });

  test('does not save draft when content is empty', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    // Only fill in the title — leave content empty
    await page.getByTestId('note-title-input').fill('Title only, no content');
    await page.waitForTimeout(700);

    expect(await getDraft(page)).toBeNull();
  });

  test('new draft overwrites old draft', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    // First modal session — type content A
    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill('First draft');
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('Content A');
    await expect
      .poll(() => getDraft(page), { timeout: 5000 })
      .toMatchObject({
        title: 'First draft',
        type: 'note',
      });

    // Close modal (without saving) — confirm discard, then open a new one
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('note-title-input')).toHaveCount(0); // wait for modal to fully close
    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByTestId('note-title-input').fill('Second draft');
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('Content B');
    await expect
      .poll(() => getDraft(page), { timeout: 5000 })
      .toMatchObject({
        title: 'Second draft',
        type: 'note',
      });

    const draft = await getDraft(page);
    expect(draft?.content).toContain('Content B');
    expect(draft?.content).not.toContain('Content A');
  });

  test('saves encrypted draft for secrets with encrypted content', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await secretsPage.unlock();

    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByTestId('note-title-input').fill('Secret Draft');
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('My private secret body');
    await page.waitForTimeout(700);

    const draft = await getDraft(page);
    expect(draft).not.toBeNull();
    expect(draft.type).toBe('secret');
    expect(draft.title).toBe('Secret Draft'); // title is plaintext
    expect(draft.encrypted).toBe(true);
    // Content is encrypted JSON — must not contain the plaintext
    expect(draft.content).not.toContain('My private secret body');
    const payload = JSON.parse(draft.content);
    expect(payload).toHaveProperty('ciphertext');
    expect(payload).toHaveProperty('iv');
  });

  test('saves encrypted draft for seals with encrypted content', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInWithWallet();
    await sealsPage.unlock();

    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByTestId('note-title-input').fill('Seal Draft');
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('My private seal body');
    await page.waitForTimeout(700);

    const draft = await getDraft(page);
    expect(draft).not.toBeNull();
    expect(draft.type).toBe('seal');
    expect(draft.title).toBe('Seal Draft');
    expect(draft.encrypted).toBe(true);
    expect(draft.content).not.toContain('My private seal body');
    const payload = JSON.parse(draft.content);
    expect(payload).toHaveProperty('ciphertext');
  });
});

// ─── Group 2: Draft toast ────────────────────────────────────────────────────

test.describe('draft toast', () => {
  test('shows toast on app load when a note draft exists', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();
    await seedDraft(page, { type: 'note', title: 'My Saved Draft', content: '<p>Body</p>', encrypted: false });

    // Hard reload so DraftToast remounts and detects the draft in localStorage
    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('You have an unsaved note draft')).toBeVisible();
    await expect(page.getByText('"My Saved Draft"')).toBeVisible();
  });

  test('shows Untitled when draft title is empty', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();
    await seedDraft(page, { type: 'note', title: '', content: '<p>Some body</p>', encrypted: false });

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('You have an unsaved note draft')).toBeVisible();
    await expect(page.getByText('"Untitled"')).toBeVisible();
  });

  test('does not show toast when no draft in localStorage', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('You have an unsaved')).not.toBeVisible();
  });

  test('Dismiss clears localStorage and removes the toast', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();
    await seedDraft(page, { type: 'note', title: 'Draft to dismiss', content: '<p>Body</p>', encrypted: false });

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('You have an unsaved note draft')).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Toast gone
    await expect(page.getByText('You have an unsaved note draft')).not.toBeVisible();
    // Draft removed from localStorage
    expect(await getDraft(page)).toBeNull();
  });

  test('toast shows correct type label for secrets', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await page.goto('/');
    await seedDraft(page, {
      type: 'secret',
      title: 'My Secret',
      content: JSON.stringify({ alg: 'AES-GCM', iv: 'abc', ciphertext: 'xyz' }),
      encrypted: true,
    });

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('You have an unsaved secret draft')).toBeVisible();
    await expect(page.getByText('"My Secret"')).toBeVisible();
  });
});

// ─── Group 3: Note draft restore ─────────────────────────────────────────────

test.describe('note draft restore', () => {
  test('Continue navigates to notes page and opens modal with draft content', async ({ page }) => {
    // Start on /archive so clicking Continue causes a navigation to /
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();
    await page.goto('/archive');

    const title = 'Restored Title';
    const content = 'Restored body content';
    await seedDraft(page, { type: 'note', title, content: `<p>${content}</p>`, encrypted: false });

    // Hard reload — DraftToast remounts on /archive and shows toast
    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('You have an unsaved note draft')).toBeVisible();

    // Continue soft-navigates to / and opens modal with draft content
    await page.getByRole('button', { name: 'Continue' }).click();

    // Modal opens with draft content pre-filled
    await expect(page.getByTestId('note-title-input')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('note-title-input')).toHaveValue(title);
    await expect(page.getByTestId('tiptap-editor')).toContainText(content);
  });

  test('draft is cleared from localStorage after saving the restored note', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();
    await page.goto('/archive');

    const title = 'Draft to save';
    const content = 'Content that should be saved';
    await seedDraft(page, { type: 'note', title, content: `<p>${content}</p>`, encrypted: false });

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('You have an unsaved note draft')).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible({ timeout: 10000 });

    // Save the note
    const postPromise = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'POST');
    await page.getByTestId('save-note-btn').click();
    await postPromise;

    // Draft should be cleared
    await expect.poll(() => getDraft(page)).toBeNull();
  });
});

// ─── Group 4: Encrypted draft restore ────────────────────────────────────────

test.describe('encrypted draft restore', () => {
  test('Continue for a locked secret draft shows passphrase modal', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await secretsPage.unlock();

    // Type in New Secret modal to create a draft
    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill('Locked Secret Draft');
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('Sensitive content');
    await page.waitForTimeout(700);

    // Close modal without saving — confirm discard
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();

    // Clear sessionStorage to simulate a locked session on next page load
    await page.evaluate(() => sessionStorage.clear());

    // Hard reload on /secrets — DraftToast remounts; phase transitions to 'locked'
    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    // Wait for Unlock button so phaseRef is settled before clicking Continue
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('You have an unsaved secret draft')).toBeVisible();

    // Click Continue — session is locked, so PassphraseModal should appear
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  });

  test('unlocking via Continue opens the secret modal with decrypted content', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await secretsPage.unlock();

    const title = 'Restored Secret';
    const content = 'Decrypted draft content';

    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(content);
    await page.waitForTimeout(700);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.evaluate(() => sessionStorage.clear());

    // Hard reload — DraftToast shows; phase = 'locked'
    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('You have an unsaved secret draft')).toBeVisible();

    // Continue → PassphraseModal → unlock → soft nav to /secrets?draft=true
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByPlaceholder('Your passphrase').fill(SecretsPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    // Modal opens with decrypted content
    await expect(page.getByTestId('note-title-input')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('note-title-input')).toHaveValue(title);
    await expect(page.getByTestId('tiptap-editor')).toContainText(content, { timeout: 5000 });
  });

  test('unlocking via Continue opens the seal modal with decrypted content', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInWithWallet();
    await sealsPage.unlock();

    const title = 'Restored Seal';
    const content = 'Decrypted seal content';

    await page.getByRole('button', { name: 'New Seal' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(content);
    await page.waitForTimeout(700);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.evaluate(() => sessionStorage.clear());

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('You have an unsaved seal draft')).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByPlaceholder('Your passphrase').fill(SealsPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    // Modal opens with decrypted content
    await expect(page.getByTestId('note-title-input')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('note-title-input')).toHaveValue(title);
    await expect(page.getByTestId('tiptap-editor')).toContainText(content, { timeout: 5000 });
  });

  test('Continue for already-unlocked session navigates directly without passphrase modal', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await secretsPage.unlock();

    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill('Unlocked Secret Draft');
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('Unlocked body');
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();

    // Do NOT clear sessionStorage — MEK is still rehydratable on next load
    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    // Wait for Lock button to confirm MEK reconstructed before clicking Continue
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('You have an unsaved secret draft')).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();

    // Passphrase modal should NOT appear
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();

    // Modal opens directly with draft content
    await expect(page.getByTestId('note-title-input')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('note-title-input')).toHaveValue('Unlocked Secret Draft');
  });
});

// ─── Unsaved Changes Confirmation ───────────────────────────────────────────

test.describe('unsaved changes confirmation', () => {
  test('closing note modal with unsaved edits shows confirmation', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    await seedNotes(account.address, [{ title: 'Unsaved Test', content: 'original' }]);
    await page.reload();

    // Open note modal and edit
    await notesPage.noteCard('Unsaved Test').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(' modified');

    // Try to close via X — should show confirmation
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();

    // Cancel keeps editing
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
  });

  test('discard button closes modal and discards changes', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    await seedNotes(account.address, [{ title: 'Discard Test', content: 'original content' }]);
    await page.reload();

    // Open, edit, close, discard
    await notesPage.noteCard('Discard Test').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(' extra');

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();

    // Modal should be closed
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('closing note modal without changes does NOT show confirmation', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    await seedNotes(account.address, [{ title: 'NoConfirm Test' }]);
    await page.reload();

    // Open note modal in view mode (no edits)
    await notesPage.noteCard('NoConfirm Test').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Close — should NOT show confirmation dialog
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).not.toBeVisible();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('new note modal with content shows confirmation on cancel', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill('Draft title');

    // Cancel — should show confirmation
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();

    // Discard closes
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('new note modal with empty content does NOT show confirmation', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    // Cancel with no content — should close immediately
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Discard unsaved changes?')).not.toBeVisible();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('new secret modal with content shows confirmation on cancel', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await secretsPage.unlock();

    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill('Secret draft');

    // Cancel — should show confirmation
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  });

  test('clicking checkbox in view mode in a secret does NOT trigger discard dialog on close', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    const { account, mekBytes } = await secretsPage.signInWithWallet();
    const checkboxContent =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Secret task</p></li></ul>';
    await seedSecrets(account.address, mekBytes, [{ title: 'Secret Checkbox Test', content: checkboxContent }]);
    await page.reload();
    await secretsPage.unlock();

    await secretsPage.secretCard('Secret Checkbox Test').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Click the checkbox in view mode (not editing)
    await page.getByTestId('tiptap-editor').getByRole('checkbox').click();

    // Close — should NOT show confirmation dialog
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).not.toBeVisible();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('clicking checkbox in view mode does NOT trigger discard dialog on close', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    const checkboxContent =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task item</p></li></ul>';
    await seedNotes(account.address, [{ title: 'Checkbox Test', content: checkboxContent }]);
    await page.reload();

    await notesPage.noteCard('Checkbox Test').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Click the checkbox in view mode (not editing)
    await page.getByTestId('tiptap-editor').getByRole('checkbox').click();

    // Close — should NOT show confirmation dialog
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).not.toBeVisible();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });
});
