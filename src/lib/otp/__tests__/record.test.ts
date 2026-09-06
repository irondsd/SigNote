/**
 * The encryption side of an authenticator record: domain separation from the
 * note tiers, and the AAD that pins a ciphertext to its row.
 */
import { getOtpRecordAad } from '@/config/constants';
import {
  decryptAesGcm,
  decryptSecretBody,
  deriveFileEncKey,
  deriveOtpVaultKey,
  deriveSealWrapKey,
  deriveSecretBodyKey,
  encryptAesGcm,
  encryptSecretBody,
  importMEK,
} from '@/lib/crypto';
import {
  codeForRecord,
  decryptOtpRecord,
  encryptOtpRecord,
  isSameCredential,
  OtpRecordError,
  toOtpSecrets,
} from '../record';
import { Base32Error } from '../base32';

const mekBytes = () => crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;

const draft = {
  issuer: 'ACME Co',
  account: 'alice@example.com',
  secret: 'JBSWY3DPEHPK3PXP',
} as const;

describe('toOtpSecrets', () => {
  it('normalizes a draft and fills the defaults', () => {
    expect(toOtpSecrets({ ...draft, secret: 'jbswy3dp ehpk3pxp' })).toEqual({
      v: 1,
      type: 'totp',
      issuer: 'ACME Co',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  it('trims the identity fields and drops an empty note', () => {
    const secrets = toOtpSecrets({ ...draft, issuer: '  ACME  ', account: ' alice ', note: '   ' });
    expect(secrets.issuer).toBe('ACME');
    expect(secrets.account).toBe('alice');
    expect(secrets).not.toHaveProperty('note');
  });

  it('rejects a malformed seed', () => {
    expect(() => toOtpSecrets({ ...draft, secret: 'NOT!BASE32' })).toThrow(Base32Error);
  });

  it('rejects an over-long field', () => {
    expect(() => toOtpSecrets({ ...draft, issuer: 'x'.repeat(200) })).toThrow(OtpRecordError);
  });
});

describe('deriveOtpVaultKey', () => {
  it('is deterministic for a given MEK', async () => {
    const bytes = mekBytes();
    const a = await deriveOtpVaultKey(await importMEK(bytes));
    const b = await deriveOtpVaultKey(await importMEK(bytes));

    const payload = await encryptAesGcm(a, 'hello');
    await expect(decryptAesGcm(b, payload)).resolves.toBe('hello');
  });

  it('is non-extractable', async () => {
    const key = await deriveOtpVaultKey(await importMEK(mekBytes()));
    expect(key.extractable).toBe(false);
    expect(key.usages.sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('differs per MEK', async () => {
    const a = await deriveOtpVaultKey(await importMEK(mekBytes()));
    const b = await deriveOtpVaultKey(await importMEK(mekBytes()));
    const payload = await encryptAesGcm(a, 'hello');
    await expect(decryptAesGcm(b, payload)).rejects.toThrow();
  });

  /**
   * Security invariant 3: the key a trusted device persists must not reach the
   * note vault. HKDF is one-way, so this is really asserting the info strings
   * are distinct — a copy-paste in constants.ts is exactly the mistake that
   * would silently collapse the domains.
   */
  it('cannot decrypt any other domain', async () => {
    const mek = await importMEK(mekBytes());
    const otpKey = await deriveOtpVaultKey(mek);

    const others = [
      await deriveSecretBodyKey(mek),
      await deriveFileEncKey(mek),
      await deriveSealWrapKey(mek, 'seal-1'),
    ];

    for (const other of others) {
      const sealed = await encryptAesGcm(other, 'note body');
      await expect(decryptAesGcm(otpKey, sealed)).rejects.toThrow();
    }
  });

  it('does not let a secret body decrypt with the OTP key', async () => {
    const mek = await importMEK(mekBytes());
    const body = await encryptSecretBody(mek, 'a secret');
    await expect(decryptSecretBody(mek, body)).resolves.toBe('a secret');
    await expect(decryptAesGcm(await deriveOtpVaultKey(mek), body)).rejects.toThrow();
  });
});

describe('encryptOtpRecord / decryptOtpRecord', () => {
  const vaultKey = async () => deriveOtpVaultKey(await importMEK(mekBytes()));

  it('round-trips a record', async () => {
    const key = await vaultKey();
    const secrets = toOtpSecrets({ ...draft, algorithm: 'SHA256', digits: 8, period: 60, note: 'work laptop' });
    const payload = await encryptOtpRecord(key, 'rec-1', secrets);

    expect(payload.alg).toBe('A256GCM');
    await expect(decryptOtpRecord(key, 'rec-1', payload)).resolves.toEqual(secrets);
  });

  it('keeps the issuer and account out of the ciphertext envelope', async () => {
    // Invariant: identity metadata is inside the sealed body, never beside it.
    const payload = await encryptOtpRecord(await vaultKey(), 'rec-1', toOtpSecrets(draft));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('ACME');
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('JBSWY3DP');
  });

  /** Security invariant 11 — the whole point of the AAD. */
  it('refuses to decrypt under a different record id', async () => {
    const key = await vaultKey();
    const payload = await encryptOtpRecord(key, 'rec-1', toOtpSecrets(draft));
    await expect(decryptOtpRecord(key, 'rec-2', payload)).rejects.toThrow();
  });

  it('binds with the documented AAD string', async () => {
    const key = await vaultKey();
    const secrets = toOtpSecrets(draft);
    const payload = await encryptOtpRecord(key, 'rec-1', secrets);
    // Decrypting by hand with the same AAD proves the binding is the record id
    // and not something incidental.
    await expect(decryptAesGcm(key, payload, getOtpRecordAad('rec-1'))).resolves.toBe(JSON.stringify(secrets));
    expect(getOtpRecordAad('rec-1')).toBe('otp-record:v1:rec-1');
  });

  it('rejects a payload that decrypts to the wrong shape', async () => {
    const key = await vaultKey();
    const payload = await encryptAesGcm(key, JSON.stringify({ v: 1, type: 'totp' }), getOtpRecordAad('rec-1'));
    await expect(decryptOtpRecord(key, 'rec-1', payload)).rejects.toThrow(OtpRecordError);
  });

  it('rejects a payload that is not JSON', async () => {
    const key = await vaultKey();
    const payload = await encryptAesGcm(key, 'not json', getOtpRecordAad('rec-1'));
    await expect(decryptOtpRecord(key, 'rec-1', payload)).rejects.toThrow(OtpRecordError);
  });
});

describe('codeForRecord', () => {
  it('generates from the record parameters at a corrected time', async () => {
    // RFC 6238 SHA-1 vector at t=59 with the ASCII seed, 8 digits.
    const secrets = toOtpSecrets({
      issuer: '',
      account: 'rfc',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', // "12345678901234567890"
      digits: 8,
    });
    await expect(codeForRecord(secrets, 59_000)).resolves.toBe('94287082');
  });
});

describe('isSameCredential', () => {
  const base = toOtpSecrets(draft);

  it('matches the same seed and identity regardless of case or spacing', () => {
    const other = toOtpSecrets({ issuer: 'acme co', account: 'ALICE@example.com', secret: 'jbswy3dp ehpk3pxp' });
    expect(isSameCredential(base, other)).toBe(true);
  });

  it('does not match a different seed or a different account', () => {
    expect(isSameCredential(base, toOtpSecrets({ ...draft, secret: 'MZXW6YTBOI======' }))).toBe(false);
    expect(isSameCredential(base, toOtpSecrets({ ...draft, account: 'bob@example.com' }))).toBe(false);
  });
});
