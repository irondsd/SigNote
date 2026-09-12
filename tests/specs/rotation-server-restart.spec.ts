import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { RotationPage } from '../pages/RotationPage';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedEncryptedFile, decryptStoredFile } from '../fixtures/seedEncryptedFile';
import { testDb } from '../fixtures/db';
import { encryptionRotations, rotationItems } from '../../src/db/schema';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { decryptSecretHead, mekFromPassphrase } from '../utils/vaultCrypto';

test.setTimeout(180_000);

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function stop(server: ChildProcess | undefined) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
  // Abrupt process loss, not a graceful request drain. The test owns this process.
  server.kill('SIGKILL');
  await exited;
}

test('staging survives actual app-server process loss and resumes in a fresh browser', async ({ browser }) => {
  // A private Next.js process shares only the suite's disposable DB/object store.
  // Killing it cannot interrupt the server other parallel specs use.
  const port = await freePort();
  const baseURL = `http://localhost:${port}`;
  let server: ChildProcess | undefined;
  const start = async () => {
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], {
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'ignore',
    });
    await expect
      .poll(
        async () => {
          if (server?.exitCode !== null) throw new Error('Owned Next.js server exited');
          return fetch(`${baseURL}/api/auth/session`)
            .then((response) => response.ok)
            .catch(() => false);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  };
  const first = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  let second: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await start();
    const page = await first.newPage();
    const wizard = new RotationPage(page);
    const { address, mekBytes } = await wizard.signInWithProfile({ navigate: false });
    const userId = await getOrCreateUserId(address);
    const [secret] = await seedSecrets(address, mekBytes, [{ title: 'Restart', content: 'durable staged content' }]);
    const file = await seedEncryptedFile(page.request, mekBytes, { bytes: 65536 });
    await wizard.goto();
    await wizard.runUntilActivation();
    const [before] = await testDb().select().from(encryptionRotations).where(eq(encryptionRotations.userId, userId));
    const stagedBefore = await testDb().select().from(rotationItems).where(eq(rotationItems.operationId, before.id));
    expect(stagedBefore.every((item) => item.replacementDigest && item.verifiedDigest === item.replacementDigest)).toBe(
      true,
    );
    await stop(server);
    await first.close();
    await start();
    second = await browser.newContext({ baseURL, serviceWorkers: 'block' });
    const fresh = await second.newPage();
    await injectSession(fresh, await createTestSession(address));
    const resumed = new RotationPage(fresh);
    await resumed.goto();
    await resumed.expectStep('sessions');
    await resumed.revokeOtherSessions();
    await resumed.continueStep();
    await resumed.acknowledgeDrafts();
    await resumed.continueStep();
    await resumed.enterPassphrases(RotationPage.PASSPHRASE, RotationPage.NEW_PASSPHRASE);
    await resumed.expectStep('confirm');
    await resumed.begin();
    await resumed.processAll();
    const stagedAfter = await testDb().select().from(rotationItems).where(eq(rotationItems.operationId, before.id));
    for (const item of stagedBefore) {
      expect(
        stagedAfter.find((row) => row.kind === item.kind && row.resourceId === item.resourceId)?.replacement,
      ).toEqual(item.replacement);
    }
    await resumed.saveAndConfirmRecoveryFile();
    await resumed.expectStep('commit');
    await resumed.activate();
    const target = await mekFromPassphrase(userId, RotationPage.NEW_PASSPHRASE);
    expect(await decryptSecretHead(secret.id, target)).toBe('durable staged content');
    expect(Buffer.from(await decryptStoredFile(fresh.request, file.fileId, target, 1))).toEqual(
      Buffer.from(file.plaintext),
    );
    const operations = await testDb().select().from(encryptionRotations).where(eq(encryptionRotations.userId, userId));
    expect(operations).toHaveLength(1);
    expect(operations[0].id).toBe(before.id);
    expect(operations[0].phase).toBe('committed');
  } finally {
    await first.close();
    await second?.close();
    await stop(server);
  }
});
