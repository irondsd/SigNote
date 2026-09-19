import sodium from 'libsodium-wrappers-sumo';

import {
  decryptVaultBackupBytes,
  decryptVaultBackupChunks,
  deriveVaultBackupKey,
  encryptVaultBackupBytes,
  encryptVaultBackupChunks,
  VaultBackupAuthenticationError,
} from '../envelope';
import { VAULT_BACKUP_HEADER_BYTES, VaultBackupFormatError } from '../format';
import { collectChunks } from '../stream';

const TEST_KDF = { opsLimit: 2, memLimit: 19 * 1024 * 1024 } as const;
const TEST_OPTIONS = { ...TEST_KDF, chunkBytes: 64 * 1024 } as const;
const PASSWORD = 'correct horse battery staple';

function bytes(length: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff) as Uint8Array<ArrayBuffer>;
}

function fragments(input: Uint8Array, sizes: number[]): Uint8Array[] {
  const output: Uint8Array[] = [];
  let offset = 0;
  let sizeIndex = 0;
  while (offset < input.length) {
    const size = sizes[sizeIndex++ % sizes.length];
    output.push(input.subarray(offset, Math.min(input.length, offset + size)));
    offset += size;
  }
  return output;
}

describe('vault backup password envelope', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  it('matches the published Argon2id key vector', async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const key = await deriveVaultBackupKey(PASSWORD, salt, TEST_KDF);

    expect(sodium.to_hex(key)).toBe('818259b6310026a8e0dbac5d2e6927abcfdb07b32258fac4f61b18b80f929085');
  });

  it('decrypts the published complete-envelope vector', async () => {
    const encoded =
      'U05WQVVMVAAAAQBEAQEAAAAAAAIBMAAAAAEAAGd88rTQw+5fp3/4hlPD2EIv9axnT1UgtZfXibk5SBikCyjTealXojjk84o4zwJDs8/Hha7B20AWTdj1Ph3aFeKSfrE0rPHDTQIXiFnMtCww9zgOmKY9oODm7A==';
    const encrypted = Uint8Array.from(Buffer.from(encoded, 'base64'));

    await expect(decryptVaultBackupBytes(encrypted, PASSWORD)).resolves.toEqual(
      new TextEncoder().encode('SigNote portable vault format v1\n'),
    );
  });

  it('round-trips empty input with an authenticated final frame', async () => {
    const encrypted = await encryptVaultBackupBytes(new Uint8Array(), PASSWORD, TEST_OPTIONS);
    const decrypted = await decryptVaultBackupBytes(encrypted, PASSWORD);

    expect(encrypted.length).toBe(VAULT_BACKUP_HEADER_BYTES + sodium.crypto_secretstream_xchacha20poly1305_ABYTES);
    expect(decrypted).toHaveLength(0);
  });

  it('round-trips irregular input and transport chunks with bounded crypto frames', async () => {
    const plaintext = bytes(TEST_OPTIONS.chunkBytes * 2 + 12_345);
    const inputFragments = fragments(plaintext, [1, 8191, 37, 65_536, 5]);
    const encrypted = await collectChunks(encryptVaultBackupChunks(inputFragments, PASSWORD, TEST_OPTIONS));
    const transportFragments = fragments(encrypted, [1, 2, 67, 13_337, 3, 65_553]);
    const decrypted = await collectChunks(decryptVaultBackupChunks(transportFragments, PASSWORD));

    expect(decrypted).toEqual(plaintext);
  });

  it('preserves an exact full final plaintext chunk', async () => {
    const plaintext = bytes(TEST_OPTIONS.chunkBytes * 2);
    const encrypted = await encryptVaultBackupBytes(plaintext, PASSWORD, TEST_OPTIONS);

    await expect(decryptVaultBackupBytes(encrypted, PASSWORD)).resolves.toEqual(plaintext);
  });

  it('fails closed for the wrong password', async () => {
    const encrypted = await encryptVaultBackupBytes(bytes(1024), PASSWORD, TEST_OPTIONS);

    await expect(decryptVaultBackupBytes(encrypted, 'not the password')).rejects.toBeInstanceOf(
      VaultBackupAuthenticationError,
    );
  });

  it('fails closed when ciphertext is modified or truncated', async () => {
    const encrypted = await encryptVaultBackupBytes(bytes(100_000), PASSWORD, TEST_OPTIONS);
    const modified = Uint8Array.from(encrypted);
    modified[VAULT_BACKUP_HEADER_BYTES + 100] ^= 0x80;

    await expect(decryptVaultBackupBytes(modified, PASSWORD)).rejects.toBeInstanceOf(VaultBackupAuthenticationError);
    await expect(decryptVaultBackupBytes(encrypted.subarray(0, -1), PASSWORD)).rejects.toBeInstanceOf(
      VaultBackupAuthenticationError,
    );
  });

  it('authenticates the public header as associated data', async () => {
    const encrypted = await encryptVaultBackupBytes(bytes(1024), PASSWORD, TEST_OPTIONS);
    const modifiedSalt = Uint8Array.from(encrypted);
    modifiedSalt[28] ^= 0x01;

    await expect(decryptVaultBackupBytes(modifiedSalt, PASSWORD)).rejects.toBeInstanceOf(
      VaultBackupAuthenticationError,
    );
  });

  it('rejects weak or excessive parameters before encryption', async () => {
    await expect(
      encryptVaultBackupBytes(bytes(1), PASSWORD, { ...TEST_OPTIONS, memLimit: 1024 }),
    ).rejects.toBeInstanceOf(VaultBackupFormatError);
  });

  it('propagates encryption cancellation to its plaintext source', async () => {
    let sourceClosed = false;
    async function* source() {
      try {
        while (true) yield bytes(TEST_OPTIONS.chunkBytes);
      } finally {
        sourceClosed = true;
      }
    }

    const encrypted = encryptVaultBackupChunks(source(), PASSWORD, TEST_OPTIONS);
    await encrypted.next(); // public header
    await encrypted.next(); // first authenticated data frame
    await encrypted.return(undefined);

    expect(sourceClosed).toBe(true);
  });

  it('propagates decryption cancellation to its ciphertext source', async () => {
    const encrypted = await encryptVaultBackupBytes(bytes(TEST_OPTIONS.chunkBytes * 2), PASSWORD, TEST_OPTIONS);
    let sourceClosed = false;
    async function* source() {
      try {
        for (const fragment of fragments(encrypted, [1024, 17_000])) yield fragment;
      } finally {
        sourceClosed = true;
      }
    }

    const decrypted = decryptVaultBackupChunks(source(), PASSWORD);
    await decrypted.next();
    await decrypted.return(undefined);

    expect(sourceClosed).toBe(true);
  });
});
