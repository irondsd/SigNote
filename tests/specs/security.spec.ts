import { test, expect, type Page } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { trpcMutate, trpcQuery } from '../utils/trpc';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });
const secretCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

// ─── XSS helpers ────────────────────────────────────────────────────────────

const setupWithPayload = async (page: Page, title: string, content: string) => {
  const { account } = makeAccount();
  await seedNotes(account.address, [{ title, content }]);

  const token = await createTestSession(account.address);
  await injectSession(page, token);
  await page.goto('/');

  await noteCard(page, title).waitFor({ state: 'visible' });
};

// ─── Auth helper ─────────────────────────────────────────────────────────────

const signInFresh = async (page: Page) => {
  const { account } = makeAccount();
  const token = await createTestSession(account.address);
  await injectSession(page, token);
  await page.goto('/');
  return { account };
};

// ─── XSS sanitization in NoteCard ────────────────────────────────────────────

test.describe('XSS sanitization in NoteCard', () => {
  test('img onerror payload should be stripped from DOM', async ({ page }) => {
    const title = `XSS img ${Date.now()}`;

    await setupWithPayload(page, title, '<img src="x" onerror="window.__xssExecuted=true">');

    await expect(noteCard(page, title).locator('img[onerror]')).toHaveCount(0);
  });

  test('svg onload payload should be stripped from DOM', async ({ page }) => {
    const title = `XSS svg ${Date.now()}`;

    await setupWithPayload(page, title, '<svg onload="window.__xssExecuted=true"></svg>');

    await expect(noteCard(page, title).locator('svg[onload]')).toHaveCount(0);
  });

  test('iframe should be stripped from DOM', async ({ page }) => {
    const title = `XSS iframe ${Date.now()}`;

    await setupWithPayload(page, title, '<iframe src="javascript:parent.__xssExecuted=true"></iframe>');

    await expect(noteCard(page, title).locator('iframe')).toHaveCount(0);
  });

  test('safe HTML formatting is preserved after sanitization', async ({ page }) => {
    const title = `Safe HTML ${Date.now()}`;

    await setupWithPayload(page, title, '<p>Hello <strong>world</strong> <em>from</em> a note</p>');

    await expect(noteCard(page, title)).toContainText('Hello');
    await expect(noteCard(page, title)).toContainText('world');
  });
});

// ─── XSS sanitization in EncryptedNoteCard ───────────────────────────────────

test.describe('XSS sanitization in EncryptedNoteCard', () => {
  const setupSecretWithPayload = async (page: Page, title: string, content: string) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title, content }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/secrets');

    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();
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

// ─── HTTP security headers ────────────────────────────────────────────────────

test.describe('HTTP security headers', () => {
  test('includes X-Content-Type-Options: nosniff', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('includes X-Frame-Options: DENY', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.headers()['x-frame-options']).toBe('DENY');
  });

  test('includes Referrer-Policy: strict-origin-when-cross-origin', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('includes Permissions-Policy header', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.headers()['permissions-policy']).toBeDefined();
  });
});

// ─── Invalid ObjectId → 400 (Zod input validation) ──────────────────────────

test.describe('invalid ObjectId returns 400', () => {
  test('notes.update with invalid id returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'notes.update', { id: 'not-a-valid-id', title: 'test' });
    expect(res.status()).toBe(400);
  });

  test('notes.delete with invalid id returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'notes.delete', { id: 'not-a-valid-id' });
    expect(res.status()).toBe(400);
  });

  test('secrets.update with invalid id returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'secrets.update', { id: 'not-a-valid-id', title: 'test' });
    expect(res.status()).toBe(400);
  });

  test('secrets.delete with invalid id returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'secrets.delete', { id: 'not-a-valid-id' });
    expect(res.status()).toBe(400);
  });

  test('seals.update with invalid id returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'seals.update', { id: 'not-a-valid-id', title: 'test' });
    expect(res.status()).toBe(400);
  });

  test('seals.delete with invalid id returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'seals.delete', { id: 'not-a-valid-id' });
    expect(res.status()).toBe(400);
  });
});

// ─── Payload size limits → 400 (Zod max) ────────────────────────────────────

test.describe('payload size limits', () => {
  test('notes.create with title > 500 chars returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'notes.create', { title: 'A'.repeat(501) });
    expect(res.status()).toBe(400);
  });

  test('notes.create with content > 500k chars returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'notes.create', { title: 'ok', content: 'B'.repeat(500_001) });
    expect(res.status()).toBe(400);
  });

  test('notes.update with content > 500k chars returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const [note] = await seedNotes(account.address, [{ title: 'Size Test' }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');

    const res = await trpcMutate(page.request, 'notes.update', {
      id: note._id.toString(),
      content: 'C'.repeat(500_001),
    });
    expect(res.status()).toBe(400);
  });

  test('secrets.create with title > 500 chars returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'secrets.create', { title: 'A'.repeat(501) });
    expect(res.status()).toBe(400);
  });

  test('secrets.create with ciphertext > 750k chars returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'secrets.create', {
      title: 'ok',
      encryptedBody: { alg: 'A256GCM', iv: 'aaaaaa', ciphertext: 'D'.repeat(750_001) },
    });
    expect(res.status()).toBe(400);
  });

  test('seals.create with ciphertext > 750k chars returns 400', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcMutate(page.request, 'seals.create', {
      title: 'ok',
      encryptedBody: { alg: 'A256GCM', iv: 'aaaaaa', ciphertext: 'E'.repeat(750_001) },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── Color enum validation → 400 ─────────────────────────────────────────────

test.describe('color enum validation', () => {
  test('notes.setColor with invalid color returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const [note] = await seedNotes(account.address, [{ title: 'Color Test Note' }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');

    const res = await trpcMutate(page.request, 'notes.setColor', { id: note._id.toString(), color: 'black' });
    expect(res.status()).toBe(400);
  });

  test('secrets.setColor with invalid color returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const fakeMek = new Uint8Array(32);
    const [secret] = await seedSecrets(account.address, fakeMek, [{ title: 'Color Test Secret' }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');

    const res = await trpcMutate(page.request, 'secrets.setColor', { id: secret._id.toString(), color: 'black' });
    expect(res.status()).toBe(400);
  });

  test('seals.setColor with invalid color returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const fakeMek = new Uint8Array(32);
    const [seal] = await seedSeals(account.address, fakeMek, [{ title: 'Color Test Seal' }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');

    const res = await trpcMutate(page.request, 'seals.setColor', { id: seal._id.toString(), color: 'black' });
    expect(res.status()).toBe(400);
  });
});

// ─── Position Infinity/NaN → 400 ─────────────────────────────────────────────

test.describe('position infinity/NaN rejected', () => {
  // JSON.stringify(Infinity) → null, so we POST a raw JSON body the tRPC handler
  // parses as Infinity; z.number().finite() then rejects it (400).
  const infinityBody = (id: string) => `{"id":"${id}","position":1e309}`;

  test('notes.setPosition with position Infinity returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const [note] = await seedNotes(account.address, [{ title: 'Position Test Note' }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');

    const res = await page.request.post('/api/trpc/notes.setPosition', {
      headers: { 'Content-Type': 'application/json' },
      data: infinityBody(note._id.toString()),
    });
    expect(res.status()).toBe(400);
  });

  test('secrets.setPosition with position Infinity returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const fakeMek = new Uint8Array(32);
    const [secret] = await seedSecrets(account.address, fakeMek, [{ title: 'Position Test Secret' }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');

    const res = await page.request.post('/api/trpc/secrets.setPosition', {
      headers: { 'Content-Type': 'application/json' },
      data: infinityBody(secret._id.toString()),
    });
    expect(res.status()).toBe(400);
  });

  test('seals.setPosition with position Infinity returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const fakeMek = new Uint8Array(32);
    const [seal] = await seedSeals(account.address, fakeMek, [{ title: 'Position Test Seal' }]);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');

    const res = await page.request.post('/api/trpc/seals.setPosition', {
      headers: { 'Content-Type': 'application/json' },
      data: infinityBody(seal._id.toString()),
    });
    expect(res.status()).toBe(400);
  });
});

// ─── Nonce rate limiting ──────────────────────────────────────────────────────

test.describe('nonce rate limiting', () => {
  test('returns 200 for requests under the rate limit', async ({ page }) => {
    const res = await page.request.get('/api/auth/nonce', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.nonce).toBeDefined();
  });

  test('returns 429 after exceeding the rate limit', async ({ page }) => {
    // Use a unique IP so parallel tests don't share the counter
    const ip = '203.0.113.11';
    for (let i = 0; i < 10; i++) {
      const res = await page.request.get('/api/auth/nonce', {
        headers: { 'x-forwarded-for': ip },
      });
      expect(res.status()).toBe(200);
    }
    const res = await page.request.get('/api/auth/nonce', {
      headers: { 'x-forwarded-for': ip },
    });
    expect(res.status()).toBe(429);
  });
});

// ─── Limit cap (clamped, not rejected) ──────────────────────────────────────

test.describe('limit parameter cap', () => {
  test('notes.list with limit=999999 is clamped, not rejected', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcQuery(page.request, 'notes.list', { limit: 999999 });
    expect(res.status()).toBe(200);
  });

  test('secrets.list with limit=999999 is clamped, not rejected', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcQuery(page.request, 'secrets.list', { limit: 999999 });
    expect(res.status()).toBe(200);
  });

  test('seals.list with limit=999999 is clamped, not rejected', async ({ page }) => {
    await signInFresh(page);
    const res = await trpcQuery(page.request, 'seals.list', { limit: 999999 });
    expect(res.status()).toBe(200);
  });
});
