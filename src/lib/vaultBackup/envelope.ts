import sodium from 'libsodium-wrappers-sumo';

import {
  decodeVaultBackupHeader,
  encodeVaultBackupHeader,
  VAULT_BACKUP_DEFAULT_CHUNK_BYTES,
  VAULT_BACKUP_DEFAULT_KDF,
  VAULT_BACKUP_HEADER_BYTES,
  VAULT_BACKUP_LIMITS,
  VAULT_BACKUP_SALT_BYTES,
  validateVaultBackupChunkBytes,
  validateVaultBackupKdf,
  VaultBackupFormatError,
  type VaultBackupKdfParams,
} from './format';
import { ByteQueue, chunkSource, collectChunks, readableStreamFromChunks, type VaultBackupChunkSource } from './stream';

export type VaultBackupEncryptionOptions = VaultBackupKdfParams & {
  chunkBytes: number;
};

export const DEFAULT_VAULT_BACKUP_ENCRYPTION: VaultBackupEncryptionOptions = {
  ...VAULT_BACKUP_DEFAULT_KDF,
  chunkBytes: VAULT_BACKUP_DEFAULT_CHUNK_BYTES,
};

export class VaultBackupAuthenticationError extends Error {
  constructor() {
    super('The archive password is incorrect or the archive has been damaged');
    this.name = 'VaultBackupAuthenticationError';
  }
}

type SecretstreamState = ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_pull>;

function encodePassword(password: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(password) as Uint8Array<ArrayBuffer>;
  if (bytes.length === 0) throw new VaultBackupFormatError('Archive password must not be empty');
  if (bytes.length > VAULT_BACKUP_LIMITS.maxPasswordBytes) {
    throw new VaultBackupFormatError('Archive password is too long');
  }
  return bytes;
}

async function readySodium(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

/** Exposed for published KDF vectors and cross-implementation compatibility tests. */
export async function deriveVaultBackupKey(
  password: string,
  salt: Uint8Array,
  params: VaultBackupKdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  validateVaultBackupKdf(params);
  if (salt.length !== VAULT_BACKUP_SALT_BYTES) {
    throw new VaultBackupFormatError(`Archive salt must be exactly ${VAULT_BACKUP_SALT_BYTES} bytes`);
  }

  const passwordBytes = encodePassword(password);
  const crypto = await readySodium();
  try {
    return crypto.crypto_pwhash(
      crypto.crypto_secretstream_xchacha20poly1305_KEYBYTES,
      passwordBytes,
      salt,
      params.opsLimit,
      params.memLimit,
      crypto.crypto_pwhash_ALG_ARGON2ID13,
    ) as Uint8Array<ArrayBuffer>;
  } finally {
    crypto.memzero(passwordBytes);
  }
}

function freeSecretstreamState(crypto: typeof sodium, state: SecretstreamState): void {
  // libsodium.js allocates secretstream state in the WASM heap. Its generated
  // wrapper does not currently expose `free`, so keep the one low-level call
  // isolated here and cover repeated cancellation/finalisation in tests.
  const runtime = (crypto as unknown as { libsodium: { _free(address: number): void } }).libsodium;
  // 0.8.x types describe an object with an address while the current runtime
  // returns the address directly. Support both shapes until the bindings agree.
  const address = typeof state === 'number' ? state : state.address;
  runtime._free(address);
}

export async function* encryptVaultBackupChunks(
  source: VaultBackupChunkSource,
  password: string,
  options: VaultBackupEncryptionOptions = DEFAULT_VAULT_BACKUP_ENCRYPTION,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  validateVaultBackupKdf(options);
  validateVaultBackupChunkBytes(options.chunkBytes);

  const crypto = await readySodium();
  const salt = crypto.randombytes_buf(VAULT_BACKUP_SALT_BYTES) as Uint8Array<ArrayBuffer>;
  const key = await deriveVaultBackupKey(password, salt, options);
  const initialized = (() => {
    try {
      return crypto.crypto_secretstream_xchacha20poly1305_init_push(key);
    } finally {
      crypto.memzero(key);
    }
  })();
  const pending = new ByteQueue();

  try {
    const header = encodeVaultBackupHeader({
      ...options,
      salt,
      streamHeader: initialized.header,
    });
    yield header;

    for await (const input of chunkSource(source)) {
      pending.push(input);
      while (pending.length >= options.chunkBytes) {
        const frame = pending.take(options.chunkBytes);
        let cipher: Uint8Array<ArrayBuffer>;
        try {
          cipher = crypto.crypto_secretstream_xchacha20poly1305_push(
            initialized.state,
            frame,
            header,
            crypto.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
          ) as Uint8Array<ArrayBuffer>;
        } finally {
          crypto.memzero(frame);
        }
        yield cipher;
      }
    }

    const finalFrame = pending.take(pending.length);
    let finalCipher: Uint8Array<ArrayBuffer>;
    try {
      finalCipher = crypto.crypto_secretstream_xchacha20poly1305_push(
        initialized.state,
        finalFrame,
        header,
        crypto.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
      ) as Uint8Array<ArrayBuffer>;
    } finally {
      crypto.memzero(finalFrame);
    }
    yield finalCipher;
  } finally {
    freeSecretstreamState(crypto, initialized.state);
  }
}

export async function encryptVaultBackupStream(
  source: VaultBackupChunkSource,
  password: string,
  options: VaultBackupEncryptionOptions = DEFAULT_VAULT_BACKUP_ENCRYPTION,
): Promise<ReadableStream<Uint8Array>> {
  return readableStreamFromChunks(encryptVaultBackupChunks(source, password, options));
}

function pullAuthenticated(
  crypto: typeof sodium,
  state: SecretstreamState,
  cipher: Uint8Array,
  header: Uint8Array,
): { message: Uint8Array; tag: number } {
  try {
    const result = crypto.crypto_secretstream_xchacha20poly1305_pull(state, cipher, header);
    if (!result) throw new VaultBackupAuthenticationError();
    return result;
  } catch (error) {
    if (error instanceof VaultBackupAuthenticationError) throw error;
    throw new VaultBackupAuthenticationError();
  }
}

export async function* decryptVaultBackupChunks(
  source: VaultBackupChunkSource,
  password: string,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const crypto = await readySodium();
  const queue = new ByteQueue();
  let headerBytes: Uint8Array<ArrayBuffer> | null = null;
  let state: SecretstreamState | null = null;
  let fullCipherChunkBytes = 0;

  try {
    for await (const input of chunkSource(source)) {
      queue.push(input);

      if (!headerBytes && queue.length >= VAULT_BACKUP_HEADER_BYTES) {
        headerBytes = queue.take(VAULT_BACKUP_HEADER_BYTES);
        const header = decodeVaultBackupHeader(headerBytes);
        const key = await deriveVaultBackupKey(password, header.salt, header);
        try {
          state = crypto.crypto_secretstream_xchacha20poly1305_init_pull(header.streamHeader, key);
        } finally {
          crypto.memzero(key);
        }
        fullCipherChunkBytes = header.chunkBytes + crypto.crypto_secretstream_xchacha20poly1305_ABYTES;
      }

      if (headerBytes && state !== null) {
        while (queue.length > fullCipherChunkBytes) {
          const result = pullAuthenticated(crypto, state, queue.take(fullCipherChunkBytes), headerBytes);
          if (result.tag !== crypto.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE) {
            throw new VaultBackupAuthenticationError();
          }
          yield result.message as Uint8Array<ArrayBuffer>;
        }
      }
    }

    if (!headerBytes || state === null) throw new VaultBackupFormatError('Archive header is truncated');
    if (queue.length < crypto.crypto_secretstream_xchacha20poly1305_ABYTES || queue.length > fullCipherChunkBytes) {
      throw new VaultBackupAuthenticationError();
    }

    const final = pullAuthenticated(crypto, state, queue.take(queue.length), headerBytes);
    if (final.tag !== crypto.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
      throw new VaultBackupAuthenticationError();
    }
    yield final.message as Uint8Array<ArrayBuffer>;
  } finally {
    if (state !== null) freeSecretstreamState(crypto, state);
  }
}

export async function decryptVaultBackupStream(
  source: VaultBackupChunkSource,
  password: string,
): Promise<ReadableStream<Uint8Array>> {
  return readableStreamFromChunks(decryptVaultBackupChunks(source, password));
}

/** Small-payload convenience for tests, vectors, and metadata—not attachment paths. */
export async function encryptVaultBackupBytes(
  bytes: Uint8Array,
  password: string,
  options: VaultBackupEncryptionOptions = DEFAULT_VAULT_BACKUP_ENCRYPTION,
): Promise<Uint8Array<ArrayBuffer>> {
  return collectChunks(encryptVaultBackupChunks([bytes], password, options));
}

/** Small-payload convenience for tests, vectors, and metadata—not attachment paths. */
export async function decryptVaultBackupBytes(bytes: Uint8Array, password: string): Promise<Uint8Array<ArrayBuffer>> {
  return collectChunks(decryptVaultBackupChunks([bytes], password));
}
