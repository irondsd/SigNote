export const VAULT_BACKUP_CONTAINER_VERSION = 1 as const;

export const VAULT_BACKUP_HEADER_BYTES = 68;
export const VAULT_BACKUP_SALT_BYTES = 16;
export const VAULT_BACKUP_STREAM_HEADER_BYTES = 24;

export const VAULT_BACKUP_KDF_ARGON2ID13 = 1 as const;
export const VAULT_BACKUP_CIPHER_SECRETSTREAM_XCHACHA20POLY1305 = 1 as const;

export const VAULT_BACKUP_DEFAULT_KDF = {
  opsLimit: 3,
  memLimit: 64 * 1024 * 1024,
} as const;

export const VAULT_BACKUP_DEFAULT_CHUNK_BYTES = 1024 * 1024;

export const VAULT_BACKUP_LIMITS = {
  minOpsLimit: 2,
  maxOpsLimit: 10,
  minMemLimit: 19 * 1024 * 1024,
  maxMemLimit: 512 * 1024 * 1024,
  minChunkBytes: 64 * 1024,
  maxChunkBytes: 16 * 1024 * 1024,
  maxPasswordBytes: 1024,
} as const;

const MAGIC = new Uint8Array([0x53, 0x4e, 0x56, 0x41, 0x55, 0x4c, 0x54, 0x00]); // SNVAULT\0

export type VaultBackupKdfParams = {
  opsLimit: number;
  memLimit: number;
};

export type VaultBackupHeader = {
  version: typeof VAULT_BACKUP_CONTAINER_VERSION;
  kdf: typeof VAULT_BACKUP_KDF_ARGON2ID13;
  cipher: typeof VAULT_BACKUP_CIPHER_SECRETSTREAM_XCHACHA20POLY1305;
  flags: 0;
  opsLimit: number;
  memLimit: number;
  chunkBytes: number;
  salt: Uint8Array<ArrayBuffer>;
  streamHeader: Uint8Array<ArrayBuffer>;
};

export class VaultBackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultBackupFormatError';
  }
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function validateVaultBackupKdf(params: VaultBackupKdfParams): void {
  if (!isIntegerInRange(params.opsLimit, VAULT_BACKUP_LIMITS.minOpsLimit, VAULT_BACKUP_LIMITS.maxOpsLimit)) {
    throw new VaultBackupFormatError('Archive Argon2id operations limit is outside the supported range');
  }
  if (!isIntegerInRange(params.memLimit, VAULT_BACKUP_LIMITS.minMemLimit, VAULT_BACKUP_LIMITS.maxMemLimit)) {
    throw new VaultBackupFormatError('Archive Argon2id memory limit is outside the supported range');
  }
}

export function validateVaultBackupChunkBytes(chunkBytes: number): void {
  if (!isIntegerInRange(chunkBytes, VAULT_BACKUP_LIMITS.minChunkBytes, VAULT_BACKUP_LIMITS.maxChunkBytes)) {
    throw new VaultBackupFormatError('Archive chunk size is outside the supported range');
  }
}

function exactBytes(value: Uint8Array, length: number, name: string): Uint8Array<ArrayBuffer> {
  if (value.length !== length) throw new VaultBackupFormatError(`${name} must be exactly ${length} bytes`);
  return Uint8Array.from(value) as Uint8Array<ArrayBuffer>;
}

export function encodeVaultBackupHeader(input: {
  opsLimit: number;
  memLimit: number;
  chunkBytes: number;
  salt: Uint8Array;
  streamHeader: Uint8Array;
}): Uint8Array<ArrayBuffer> {
  validateVaultBackupKdf(input);
  validateVaultBackupChunkBytes(input.chunkBytes);
  const salt = exactBytes(input.salt, VAULT_BACKUP_SALT_BYTES, 'Archive salt');
  const streamHeader = exactBytes(input.streamHeader, VAULT_BACKUP_STREAM_HEADER_BYTES, 'Secretstream header');

  const bytes = new Uint8Array(VAULT_BACKUP_HEADER_BYTES);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(8, VAULT_BACKUP_CONTAINER_VERSION);
  view.setUint16(10, VAULT_BACKUP_HEADER_BYTES);
  view.setUint8(12, VAULT_BACKUP_KDF_ARGON2ID13);
  view.setUint8(13, VAULT_BACKUP_CIPHER_SECRETSTREAM_XCHACHA20POLY1305);
  view.setUint16(14, 0);
  view.setUint32(16, input.opsLimit);
  view.setUint32(20, input.memLimit);
  view.setUint32(24, input.chunkBytes);
  bytes.set(salt, 28);
  bytes.set(streamHeader, 44);
  return bytes;
}

function magicMatches(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  let difference = 0;
  for (let i = 0; i < MAGIC.length; i++) difference |= bytes[i] ^ MAGIC[i];
  return difference === 0;
}

export function decodeVaultBackupHeader(bytes: Uint8Array): VaultBackupHeader {
  if (bytes.length < VAULT_BACKUP_HEADER_BYTES) {
    throw new VaultBackupFormatError('Archive header is truncated');
  }
  if (!magicMatches(bytes)) throw new VaultBackupFormatError('Not a SigNote vault archive');

  const view = new DataView(bytes.buffer, bytes.byteOffset, VAULT_BACKUP_HEADER_BYTES);
  const version = view.getUint16(8);
  const headerBytes = view.getUint16(10);
  const kdf = view.getUint8(12);
  const cipher = view.getUint8(13);
  const flags = view.getUint16(14);
  const opsLimit = view.getUint32(16);
  const memLimit = view.getUint32(20);
  const chunkBytes = view.getUint32(24);

  if (version !== VAULT_BACKUP_CONTAINER_VERSION) {
    throw new VaultBackupFormatError(`Unsupported vault archive version: ${version}`);
  }
  if (headerBytes !== VAULT_BACKUP_HEADER_BYTES) {
    throw new VaultBackupFormatError('Unsupported vault archive header length');
  }
  if (kdf !== VAULT_BACKUP_KDF_ARGON2ID13) {
    throw new VaultBackupFormatError('Unsupported vault archive password KDF');
  }
  if (cipher !== VAULT_BACKUP_CIPHER_SECRETSTREAM_XCHACHA20POLY1305) {
    throw new VaultBackupFormatError('Unsupported vault archive stream cipher');
  }
  if (flags !== 0) throw new VaultBackupFormatError('Unsupported vault archive flags');

  validateVaultBackupKdf({ opsLimit, memLimit });
  validateVaultBackupChunkBytes(chunkBytes);

  return {
    version: VAULT_BACKUP_CONTAINER_VERSION,
    kdf: VAULT_BACKUP_KDF_ARGON2ID13,
    cipher: VAULT_BACKUP_CIPHER_SECRETSTREAM_XCHACHA20POLY1305,
    flags: 0,
    opsLimit,
    memLimit,
    chunkBytes,
    salt: Uint8Array.from(bytes.subarray(28, 44)) as Uint8Array<ArrayBuffer>,
    streamHeader: Uint8Array.from(bytes.subarray(44, 68)) as Uint8Array<ArrayBuffer>,
  };
}
