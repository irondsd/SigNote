import {
  decodeVaultBackupHeader,
  encodeVaultBackupHeader,
  VAULT_BACKUP_DEFAULT_CHUNK_BYTES,
  VAULT_BACKUP_DEFAULT_KDF,
  VAULT_BACKUP_HEADER_BYTES,
  VaultBackupFormatError,
} from '../format';

const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
const streamHeader = Uint8Array.from({ length: 24 }, (_, index) => 255 - index);

describe('vault backup v1 header', () => {
  it('round-trips the fixed-width public header', () => {
    const encoded = encodeVaultBackupHeader({
      ...VAULT_BACKUP_DEFAULT_KDF,
      chunkBytes: VAULT_BACKUP_DEFAULT_CHUNK_BYTES,
      salt,
      streamHeader,
    });

    expect(encoded).toHaveLength(VAULT_BACKUP_HEADER_BYTES);
    expect(decodeVaultBackupHeader(encoded)).toEqual({
      version: 1,
      kdf: 1,
      cipher: 1,
      flags: 0,
      ...VAULT_BACKUP_DEFAULT_KDF,
      chunkBytes: VAULT_BACKUP_DEFAULT_CHUNK_BYTES,
      salt,
      streamHeader,
    });
  });

  it.each([
    ['magic', 0, 0],
    ['version', 9, 2],
    ['header length', 11, 1],
    ['KDF id', 12, 2],
    ['cipher id', 13, 2],
    ['flags', 15, 1],
  ])('rejects an unsupported %s', (_name, offset, value) => {
    const encoded = encodeVaultBackupHeader({
      ...VAULT_BACKUP_DEFAULT_KDF,
      chunkBytes: VAULT_BACKUP_DEFAULT_CHUNK_BYTES,
      salt,
      streamHeader,
    });
    encoded[offset] = value;
    expect(() => decodeVaultBackupHeader(encoded)).toThrow(VaultBackupFormatError);
  });

  it('rejects expensive KDF parameters before any KDF work', () => {
    const encoded = encodeVaultBackupHeader({
      ...VAULT_BACKUP_DEFAULT_KDF,
      chunkBytes: VAULT_BACKUP_DEFAULT_CHUNK_BYTES,
      salt,
      streamHeader,
    });
    new DataView(encoded.buffer).setUint32(20, 0xffffffff);

    expect(() => decodeVaultBackupHeader(encoded)).toThrow(
      'Archive Argon2id memory limit is outside the supported range',
    );
  });
});
