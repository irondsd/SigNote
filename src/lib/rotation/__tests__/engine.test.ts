/**
 * Full engine runs against a staging server that enforces the real rules, with
 * real Web Crypto throughout. Assertions compare decrypted plaintext and file
 * bytes — never a success flag — because "the call returned" is exactly what a
 * broken re-encryption would also do.
 */

import { getOtpRecordAad, getSealKeyString } from '@/config/constants';
import {
  decryptBytesAesGcm,
  decryptSealBody,
  decryptSecretBody,
  deriveFileEncKey,
  deriveOtpVaultKey,
  deriveSealWrapKey,
  encryptSealBody,
  encryptSealBodyWithExistingKey,
  encryptSecretBody,
  fromBase64,
  importMEK,
  toBase64,
} from '@/lib/crypto';
import { encryptOtpRecord, decryptOtpRecord, type OtpSecrets } from '@/lib/otp/record';
import { createRotationEngine, RotationItemError, type RotationProgress } from '@/lib/rotation/engine';
import { createFakeRotationServer, type SeedItem } from '@/test/rotationServer';

const freshMek = () => importMEK(crypto.getRandomValues(new Uint8Array(32)));

const SECRET_ID = 'secret-1';
const SEAL_ID = 'seal-1';
const AUTH_ID = 'auth-1';
const TOMBSTONE_ID = 'auth-2';
const FILE_ID = 'file-1';

const secrets: OtpSecrets = {
  v: 1,
  type: 'totp',
  secret: 'JBSWY3DPEHPK3PXP',
  issuer: 'Example',
  account: 'alice@example.com',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
};

/** A vault with every kind in it, built with the app's own encryption. */
async function mixedVault(sourceMek: CryptoKey) {
  const objects = new Map<string, ArrayBuffer>();

  const secretHead = await encryptSecretBody(sourceMek, 'secret head');
  const secretVersion = await encryptSecretBody(sourceMek, 'secret version');

  const seal = await encryptSealBody(sourceMek, 'seal head', SEAL_ID);
  const sealVersionA = await encryptSealBodyWithExistingKey(
    sourceMek,
    'seal version one',
    SEAL_ID,
    seal.wrappedNoteKey,
  );
  const sealVersionB = await encryptSealBodyWithExistingKey(
    sourceMek,
    'seal version two',
    SEAL_ID,
    seal.wrappedNoteKey,
  );

  const authPayload = await encryptOtpRecord(await deriveOtpVaultKey(sourceMek), AUTH_ID, secrets);

  const plainFile = crypto.getRandomValues(new Uint8Array(4096));
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const fileCipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: fileIv },
    await deriveFileEncKey(sourceMek),
    plainFile,
  );
  objects.set('source/file-1', fileCipher);

  const seed: SeedItem[] = [
    { kind: 'secret', resourceId: SECRET_ID, source: secretHead },
    { kind: 'secret-version', resourceId: 'secret-1-v1', parentId: SECRET_ID, source: secretVersion },
    { kind: 'seal-wrapper', resourceId: SEAL_ID, source: seal.wrappedNoteKey },
    { kind: 'seal', resourceId: SEAL_ID, parentId: SEAL_ID, source: seal.encryptedBody },
    { kind: 'seal-version', resourceId: 'seal-1-v1', parentId: SEAL_ID, source: sealVersionA.encryptedBody },
    { kind: 'seal-version', resourceId: 'seal-1-v2', parentId: SEAL_ID, source: sealVersionB.encryptedBody },
    { kind: 'auth', resourceId: AUTH_ID, source: authPayload },
    { kind: 'auth', resourceId: TOMBSTONE_ID, source: null },
    {
      kind: 'file',
      resourceId: FILE_ID,
      source: { key: 'source/file-1', iv: toBase64(fileIv), bytes: fileCipher.byteLength, checksum: '' },
    },
  ];

  return { seed, objects, plainFile };
}

const engineFor = (
  server: ReturnType<typeof createFakeRotationServer>,
  sourceMek: CryptoKey,
  targetMek: CryptoKey,
  extra: Partial<Parameters<typeof createRotationEngine>[0]> = {},
) =>
  createRotationEngine({
    api: server.api,
    transfer: server.transfer,
    token: server.token,
    sourceMek,
    targetMek,
    itemCount: server.rows.size,
    fileBytes: 4096 + 16,
    retry: { attempts: 1 },
    ...extra,
  });

/** Unwraps a Seal's note key from a wrapper payload under the given MEK. */
async function noteKeyOf(mek: CryptoKey, sealId: string, wrapper: { alg: string; iv: string; ciphertext: string }) {
  return decryptBytesAesGcm(await deriveSealWrapKey(mek, sealId), wrapper as never, getSealKeyString(sealId));
}

describe('a complete run over a mixed vault', () => {
  it('replaces every ciphertext while preserving the plaintext exactly', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects, plainFile } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });

    await engineFor(server, sourceMek, targetMek).process();
    await expect(engineFor(server, sourceMek, targetMek).commit()).resolves.toMatchObject({ phase: 'committed' });

    const wrapper = server.row('seal-wrapper', SEAL_ID).replacement as never;
    await expect(decryptSecretBody(targetMek, server.row('secret', SECRET_ID).replacement as never)).resolves.toBe(
      'secret head',
    );
    await expect(
      decryptSecretBody(targetMek, server.row('secret-version', 'secret-1-v1').replacement as never),
    ).resolves.toBe('secret version');
    await expect(
      decryptSealBody(targetMek, server.row('seal', SEAL_ID).replacement as never, wrapper, SEAL_ID),
    ).resolves.toBe('seal head');
    await expect(
      decryptSealBody(targetMek, server.row('seal-version', 'seal-1-v1').replacement as never, wrapper, SEAL_ID),
    ).resolves.toBe('seal version one');
    await expect(
      decryptSealBody(targetMek, server.row('seal-version', 'seal-1-v2').replacement as never, wrapper, SEAL_ID),
    ).resolves.toBe('seal version two');
    await expect(
      decryptOtpRecord(await deriveOtpVaultKey(targetMek), AUTH_ID, server.row('auth', AUTH_ID).replacement as never),
    ).resolves.toEqual(secrets);

    const stored = server.row('file', FILE_ID).replacement as { key: string; iv: string };
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(stored.iv) },
      await deriveFileEncKey(targetMek),
      server.objects.get(stored.key)!,
    );
    expect(new Uint8Array(plain)).toEqual(plainFile);
  });

  it('leaves the old keys unable to read anything it produced', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });

    await engineFor(server, sourceMek, targetMek).process();

    await expect(decryptSecretBody(sourceMek, server.row('secret', SECRET_ID).replacement as never)).rejects.toThrow();
    await expect(
      decryptSealBody(
        sourceMek,
        server.row('seal', SEAL_ID).replacement as never,
        server.row('seal-wrapper', SEAL_ID).replacement as never,
        SEAL_ID,
      ),
    ).rejects.toThrow();
  });

  it('replaces the Seal note key itself, not just its wrapping', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });
    const sourceWrapper = server.row('seal-wrapper', SEAL_ID).source as never;

    await engineFor(server, sourceMek, targetMek).process();

    const before = await noteKeyOf(sourceMek, SEAL_ID, sourceWrapper);
    const after = await noteKeyOf(targetMek, SEAL_ID, server.row('seal-wrapper', SEAL_ID).replacement as never);
    expect(after).toHaveLength(32);
    expect(Buffer.from(after)).not.toEqual(Buffer.from(before));
  });

  it('keeps a tombstone a tombstone', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });

    await engineFor(server, sourceMek, targetMek).process();

    const tombstone = server.row('auth', TOMBSTONE_ID);
    expect(tombstone.replacement).toBeNull();
    expect(tombstone.verifiedDigest).toBe(tombstone.replacementDigest);
  });

  it('verifies every item durably before commit is allowed', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });

    await engineFor(server, sourceMek, targetMek).process();

    for (const row of server.rows.values()) {
      expect(row.replacementDigest).not.toBeNull();
      expect(row.verifiedDigest).toBe(row.replacementDigest);
    }
  });

  it('reports progress against durable acceptance, not local encryption', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });
    const updates: RotationProgress[] = [];

    await engineFor(server, sourceMek, targetMek, { onProgress: (p) => updates.push({ ...p }) }).process();

    expect(updates.at(-1)?.processed).toBe(seed.length);
    expect(updates.at(-1)?.total).toBe(seed.length);
    expect(updates.some((update) => update.kind === 'file' && update.bytesProcessed > 0)).toBe(true);
    // Monotonic: an item is counted once, when the server has accepted it.
    expect(updates.map((u) => u.processed)).toEqual([...updates.map((u) => u.processed)].sort((a, b) => a - b));
  });
});

describe('empty Seals', () => {
  it('verifies null wrappers and bodies even when the vault has no existing Seal key', async () => {
    const server = createFakeRotationServer(
      [
        { kind: 'seal-wrapper', resourceId: 'empty', source: null },
        { kind: 'seal', resourceId: 'empty', parentId: 'empty', source: null },
      ],
      { pageSize: 1 },
    );
    await engineFor(server, await freshMek(), await freshMek()).process();
    for (const row of server.rows.values()) {
      expect(row.replacement).toBeNull();
      expect(row.replacementDigest).not.toBeNull();
      expect(row.verifiedDigest).toBe(row.replacementDigest);
    }
  });
});

describe('paging', () => {
  it('walks a vault that does not fit in one page', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects, pageSize: 2 });

    await engineFor(server, sourceMek, targetMek).process();

    expect(server.calls.filter((call) => call === 'inventory').length).toBeGreaterThan(2);
    for (const row of server.rows.values()) expect(row.verifiedDigest).toBe(row.replacementDigest);
  });

  it('re-reads only the Seal range on the second pass', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects, pageSize: 1 });

    await engineFor(server, sourceMek, targetMek).process();

    // Nine items, one per page, plus the Seal bodies re-read once. A pass that
    // re-walked the whole inventory would need far more.
    expect(server.calls.filter((call) => call === 'inventory').length).toBeLessThan(seed.length * 2);
  });
});

describe('resuming', () => {
  it('keeps a half-processed Seal on the same new note key', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const faults = new Map([['stage:seal-version:seal-1-v2', new Error('network died')]]);
    const server = createFakeRotationServer(seed, { objects, faults });

    await expect(engineFor(server, sourceMek, targetMek).process()).rejects.toBeInstanceOf(RotationItemError);
    const wrapperAfterFault = server.row('seal-wrapper', SEAL_ID).replacementDigest;
    expect(server.row('seal-version', 'seal-1-v2').replacementDigest).toBeNull();

    // A fresh engine: no in-memory state survives, exactly as after a reload.
    await engineFor(server, sourceMek, targetMek).process();

    expect(server.row('seal-wrapper', SEAL_ID).replacementDigest).toBe(wrapperAfterFault);
    const wrapper = server.row('seal-wrapper', SEAL_ID).replacement as never;
    for (const [id, text] of [
      ['seal-1-v1', 'seal version one'],
      ['seal-1-v2', 'seal version two'],
    ] as const) {
      await expect(
        decryptSealBody(targetMek, server.row('seal-version', id).replacement as never, wrapper, SEAL_ID),
      ).resolves.toBe(text);
    }
  });

  it('never re-encrypts an item the server already accepted', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });

    await engineFor(server, sourceMek, targetMek).process();
    const digests = new Map([...server.rows].map(([id, row]) => [id, row.replacementDigest]));
    server.calls.length = 0;

    // Re-running is how a resumed wizard catches up. A fresh IV here would
    // produce a different digest for the same plaintext, which the server
    // rightly refuses under the same idempotency key.
    await engineFor(server, sourceMek, targetMek).process();

    expect(server.calls.filter((call) => call.startsWith('stage:'))).toEqual([]);
    for (const [id, row] of server.rows) expect(row.replacementDigest).toBe(digests.get(id));
  });

  it('retries a transient storage fault without involving the caller', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    // A provider hiccup on a multi-megabyte body is the most likely transient
    // fault in a run, and the least useful one to hand back to the user.
    const faults = new Map([['upload', new TypeError('Failed to fetch')]]);
    const server = createFakeRotationServer(seed, { objects, faults });

    await engineFor(server, sourceMek, targetMek, { retry: { attempts: 3, sleep: async () => undefined } }).process();

    expect(server.calls.filter((call) => call === `reserveFile:${FILE_ID}`)).toHaveLength(2);
    expect(server.row('file', FILE_ID).fileVerified).toBe(true);
    expect(server.row('file', FILE_ID).verifiedDigest).toBe(server.row('file', FILE_ID).replacementDigest);
  });

  it('recovers a file whose upload response was lost', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const faults = new Map([['finalizeFile:file-1', new Error('response lost')]]);
    const server = createFakeRotationServer(seed, { objects, faults });

    await expect(engineFor(server, sourceMek, targetMek).process()).rejects.toBeInstanceOf(RotationItemError);
    // The object is already in the store, so the retry's PUT is refused by
    // conditional create; finalize has to resolve it from the stored bytes.
    await engineFor(server, sourceMek, targetMek).process();

    expect(server.row('file', FILE_ID).fileVerified).toBe(true);
    expect(server.row('file', FILE_ID).verifiedDigest).toBe(server.row('file', FILE_ID).replacementDigest);
  });
});

describe('damaged data', () => {
  it('names the item when its source cannot be read', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const corrupted = seed.map((item) =>
      item.kind === 'secret'
        ? {
            ...item,
            source: { ...(item.source as { alg: string; iv: string; ciphertext: string }), ciphertext: 'AAAA' },
          }
        : item,
    );
    const server = createFakeRotationServer(corrupted as SeedItem[], { objects });

    const error = await engineFor(server, sourceMek, targetMek)
      .process()
      .then(() => null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RotationItemError);
    expect((error as RotationItemError).kind).toBe('secret');
    expect((error as RotationItemError).resourceId).toBe(SECRET_ID);
    expect(server.row('secret', SECRET_ID).replacementDigest).toBeNull();
  });

  it('refuses to finish when an encrypted file body is missing', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    objects.delete('source/file-1');
    const server = createFakeRotationServer(seed, { objects });

    await expect(engineFor(server, sourceMek, targetMek).process()).rejects.toBeInstanceOf(RotationItemError);
    await expect(engineFor(server, sourceMek, targetMek).commit()).rejects.toThrow();
  });

  it('stops immediately when the user cancels', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });
    const controller = new AbortController();
    controller.abort();

    await expect(engineFor(server, sourceMek, targetMek, { signal: controller.signal }).process()).rejects.toThrow();
    expect(server.calls).toEqual([]);
  });
});

describe('authenticator payloads', () => {
  it('preserves the seed so codes are unchanged after rotation', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });

    await engineFor(server, sourceMek, targetMek).process();

    const rotated = await decryptOtpRecord(
      await deriveOtpVaultKey(targetMek),
      AUTH_ID,
      server.row('auth', AUTH_ID).replacement as never,
    );
    expect(rotated).toEqual(secrets);
  });

  it('keeps the record binding, so a payload cannot move between records', async () => {
    const sourceMek = await freshMek();
    const targetMek = await freshMek();
    const { seed, objects } = await mixedVault(sourceMek);
    const server = createFakeRotationServer(seed, { objects });

    await engineFor(server, sourceMek, targetMek).process();

    await expect(
      decryptBytesAesGcm(
        await deriveOtpVaultKey(targetMek),
        server.row('auth', AUTH_ID).replacement as never,
        getOtpRecordAad('some-other-record'),
      ),
    ).rejects.toThrow();
  });
});
