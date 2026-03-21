import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';

test.describe.configure({ mode: 'parallel' });

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });

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

  // Give the browser a moment to process any async event handlers (e.g. onerror)
  // that would fire immediately after the element is mounted in the DOM.
  await page.waitForTimeout(500);
};

test.describe('XSS sanitization in NoteCard', () => {
  test('img onerror payload should not execute', async ({ page }) => {
    const title = `XSS img ${Date.now()}`;

    await setupWithPayload(page, title, '<img src="x" onerror="window.__xssExecuted=true">');

    const xssExecuted = await page.evaluate(() => (window as { __xssExecuted?: boolean }).__xssExecuted);
    expect(xssExecuted).toBeFalsy();
  });

  test('svg onload payload should not execute', async ({ page }) => {
    const title = `XSS svg ${Date.now()}`;

    await setupWithPayload(page, title, '<svg onload="window.__xssExecuted=true"></svg>');

    const xssExecuted = await page.evaluate(() => (window as { __xssExecuted?: boolean }).__xssExecuted);
    expect(xssExecuted).toBeFalsy();
  });

  test('iframe src payload should not execute', async ({ page }) => {
    const title = `XSS iframe ${Date.now()}`;

    await setupWithPayload(
      page,
      title,
      '<iframe src="javascript:parent.__xssExecuted=true"></iframe>',
    );

    const xssExecuted = await page.evaluate(() => (window as { __xssExecuted?: boolean }).__xssExecuted);
    expect(xssExecuted).toBeFalsy();
  });

  test('safe HTML formatting is preserved after sanitization', async ({ page }) => {
    const title = `Safe HTML ${Date.now()}`;

    await setupWithPayload(
      page,
      title,
      '<p>Hello <strong>world</strong> <em>from</em> a note</p>',
    );

    // The card preview should still contain the text content
    await expect(noteCard(page, title)).toContainText('Hello');
    await expect(noteCard(page, title)).toContainText('world');
  });
});
