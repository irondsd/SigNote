import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });
const secretCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

// Seeds a note with the given XSS payload as content, signs in, and waits
// for the note card to render — at which point dangerouslySetInnerHTML fires.
const setupWithPayload = async (page: Page, title: string, content: string) => {
  const { privateKey, account } = makeAccount();
  await seedNotes(account.address, [{ title, content }]);

  await mockProvider(page);
  await page.goto('/');
  await changeAccount(page, privateKey);
  await signIn(page);

  await noteCard(page, title).waitFor({ state: 'visible' });
};

test.describe('XSS sanitization in NoteCard', () => {
  test('img onerror payload should be stripped from DOM', async ({ page }) => {
    const title = `XSS img ${Date.now()}`;

    await setupWithPayload(page, title, '<img src="x" onerror="window.__xssExecuted=true">');

    // DOMPurify strips event handler attributes — the img should have no onerror attribute
    await expect(noteCard(page, title).locator('img[onerror]')).toHaveCount(0);
  });

  test('svg onload payload should be stripped from DOM', async ({ page }) => {
    const title = `XSS svg ${Date.now()}`;

    await setupWithPayload(page, title, '<svg onload="window.__xssExecuted=true"></svg>');

    // DOMPurify strips onload from svg elements
    await expect(noteCard(page, title).locator('svg[onload]')).toHaveCount(0);
  });

  test('iframe should be stripped from DOM', async ({ page }) => {
    const title = `XSS iframe ${Date.now()}`;

    await setupWithPayload(page, title, '<iframe src="javascript:parent.__xssExecuted=true"></iframe>');

    // DOMPurify removes iframe elements entirely
    await expect(noteCard(page, title).locator('iframe')).toHaveCount(0);
  });

  test('safe HTML formatting is preserved after sanitization', async ({ page }) => {
    const title = `Safe HTML ${Date.now()}`;

    await setupWithPayload(page, title, '<p>Hello <strong>world</strong> <em>from</em> a note</p>');

    // The card preview should still contain the text content
    await expect(noteCard(page, title)).toContainText('Hello');
    await expect(noteCard(page, title)).toContainText('world');
  });
});

test.describe('XSS sanitization in EncryptedNoteCard', () => {
  const setupSecretWithPayload = async (page: Page, title: string, content: string) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title, content }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Unlock encryption
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();
    // PBKDF2 at 600k iterations can be slow
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });

    await secretCard(page, title).waitFor({ state: 'visible' });
  };

  test('img onerror payload should be stripped from DOM', async ({ page }) => {
    const title = `XSS Secret img ${Date.now()}`;

    await setupSecretWithPayload(page, title, '<img src="x" onerror="window.__xssExecuted=true">');

    await expect(secretCard(page, title).locator('img[onerror]')).toHaveCount(0);
  });

  test('svg onload payload should be stripped from DOM', async ({ page }) => {
    const title = `XSS Secret svg ${Date.now()}`;

    await setupSecretWithPayload(page, title, '<svg onload="window.__xssExecuted=true"></svg>');

    await expect(secretCard(page, title).locator('svg[onload]')).toHaveCount(0);
  });

  test('iframe should be stripped from DOM', async ({ page }) => {
    const title = `XSS Secret iframe ${Date.now()}`;

    await setupSecretWithPayload(page, title, '<iframe src="javascript:parent.__xssExecuted=true"></iframe>');

    await expect(secretCard(page, title).locator('iframe')).toHaveCount(0);
  });

  test('safe HTML formatting is preserved after sanitization', async ({ page }) => {
    const title = `Safe Secret HTML ${Date.now()}`;

    await setupSecretWithPayload(page, title, '<p>Hello <strong>world</strong> <em>from</em> a note</p>');

    await expect(secretCard(page, title)).toContainText('Hello');
    await expect(secretCard(page, title)).toContainText('world');
  });
});
