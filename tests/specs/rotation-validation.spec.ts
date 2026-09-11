import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { RotationPage } from '../pages/RotationPage';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedEncryptedFile, decryptStoredFile } from '../fixtures/seedEncryptedFile';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { testDb } from '../fixtures/db';
import { encryptionRotations, sealNotes } from '../../src/db/schema';
import { decryptSecretHead, mekFromPassphrase } from '../utils/vaultCrypto';

test.setTimeout(600_000);

test('an empty Seal preserves its null body and wrapper through activation', async ({ page }) => {
  const wizard = new RotationPage(page);
  const { address } = await wizard.signInWithProfile({ navigate: false });
  const userId = await getOrCreateUserId(address);
  const [seal] = await testDb().insert(sealNotes).values({ userId, title: 'Empty', position: 1024 }).returning();
  await wizard.goto();
  await wizard.runUntilActivation();
  await wizard.activate();
  const [after] = await testDb().select().from(sealNotes).where(eq(sealNotes.id, seal.id));
  expect(after.encryptedBody).toBeNull();
  expect(after.wrappedNoteKey).toBeNull();
  expect(after.updatedAt).toEqual(seal.updatedAt);
});

test('the HTTP boundary refuses oversized and batched rotation requests', async ({ request }) => {
  const oversized = await request.post('/api/trpc/rotation.stage', {
    data: 'x'.repeat(3_000_001),
    headers: { 'content-type': 'application/json' },
  });
  expect(oversized.status()).toBe(413);
  expect(oversized.headers()['cache-control']).toContain('no-store');
  const batched = await request.get('/api/trpc/rotation.status,rotation.status?batch=1');
  expect(batched.status()).toBe(400);
});

test('the browser completes 500 items and 100 MiB of encrypted files with byte-identical results', async ({
  page,
}, testInfo) => {
  const wizard = new RotationPage(page);
  const { address, mekBytes } = await wizard.signInWithProfile({ navigate: false });
  const userId = await getOrCreateUserId(address);
  const content = 'large retained ciphertext '.repeat(2000).trimEnd();
  const secrets = await seedSecrets(
    address,
    mekBytes,
    Array.from({ length: 480 }, (_, index) => ({
      title: `Capacity ${index}`,
      content: `${index}:${content}`,
    })),
  );
  const files = [];
  for (let index = 0; index < 20; index++) {
    files.push(
      await seedEncryptedFile(page.request, mekBytes, {
        bytes: 5 * 1024 * 1024 - 16,
        filename: `capacity-${index}.bin`,
      }),
    );
  }
  await wizard.goto();
  const started = Date.now();
  await wizard.runUntilActivation();
  await wizard.activate();
  const [operation] = await testDb().select().from(encryptionRotations).where(eq(encryptionRotations.userId, userId));
  expect(operation.itemCount).toBe(500);
  expect(operation.fileBytes).toBe(100 * 1024 * 1024);
  const target = await mekFromPassphrase(userId, RotationPage.NEW_PASSPHRASE);
  for (const [index, secret] of secrets.entries())
    expect(await decryptSecretHead(secret.id, target)).toBe(`${index}:${content}`);
  for (const file of files)
    expect(Buffer.from(await decryptStoredFile(page.request, file.fileId, target, 1))).toEqual(
      Buffer.from(file.plaintext),
    );
  await testInfo.attach('capacity', {
    body: JSON.stringify({
      elapsedMs: Date.now() - started,
      sourceBytes: operation.sourceBytes,
      fileBytes: operation.fileBytes,
      items: operation.itemCount,
    }),
    contentType: 'application/json',
  });
});
