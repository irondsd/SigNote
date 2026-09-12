import {
  decryptAesGcm,
  decryptBytesAesGcm,
  decryptFileBytes,
  decryptSealBody,
  decryptSecretBody,
  deriveOtpVaultKey,
  deriveSealWrapKey,
  encryptAesGcm,
  encryptFileBytes,
  encryptSealBody,
  encryptSealBodyWithExistingKey,
  encryptSecretBody,
  fromBase64,
  importMEK,
  toBase64,
} from '@/lib/crypto';
import { getOtpRecordAad, getSealKeyString } from '@/config/constants';
import { codeForRecord, decryptOtpRecord, encryptOtpRecord, toOtpSecrets } from '@/lib/otp/record';
import {
  createRotationMaterial,
  createRotationSealWrapper,
  rotateBody,
  rotateAuth,
  rotateFile,
  unlockRotationMaterial,
  validateRotationPayload,
  verifyRotatedBody,
  verifyRotatedFile,
} from '../crypto';

const freshMek = () => importMEK(crypto.getRandomValues(new Uint8Array(32)));

it('restarts with the same passphrase and production KDF, with independently replaced material', async () => {
  const old = await createRotationMaterial('same passphrase');
  const next = await createRotationMaterial('same passphrase');
  expect(next.material.salt).not.toBe(old.material.salt);
  expect(next.material.serverShare).not.toBe(old.material.serverShare);
  expect(next.deviceShare).not.toEqual(old.deviceShare);
  expect(next.mek.extractable).toBe(false);
  const resumed = await unlockRotationMaterial('same passphrase', JSON.parse(JSON.stringify(next.material)));
  const payload = await encryptSecretBody(next.mek, 'resumed');
  await expect(decryptSecretBody(resumed, payload)).resolves.toBe('resumed');
  await expect(decryptSecretBody(old.mek, payload)).rejects.toThrow();
  await expect(unlockRotationMaterial('wrong', next.material)).rejects.toThrow('Invalid rotation credentials');
  await expect(unlockRotationMaterial('same passphrase', { ...next.material, version: 999 })).rejects.toThrow(
    'Unsupported',
  );
  await expect(
    unlockRotationMaterial('same passphrase', { ...next.material, keyCheck: old.material.keyCheck }),
  ).rejects.toThrow('Invalid rotation credentials');
});

it.each(['', '你好 🌍', 'large🙂'.repeat(45000)])(
  'rotates Secret bytes without changing content (%#. fixture)',
  async (text) => {
    const old = await freshMek();
    const next = await freshMek();
    const source = await encryptSecretBody(old, text);
    const staged = await rotateBody(old, next, { kind: 'secret' }, { kind: 'secret' }, source);
    await expect(decryptSecretBody(next, staged)).resolves.toBe(text);
    await expect(decryptSecretBody(old, staged)).rejects.toThrow();
    await expect(decryptSecretBody(next, source)).rejects.toThrow();
    expect(staged.iv).not.toBe(source.iv);
    await expect(
      verifyRotatedBody(old, next, { kind: 'secret' }, { kind: 'secret' }, source, staged),
    ).resolves.toBeUndefined();
    const wrongContent = await encryptSecretBody(next, `${text}changed`);
    await expect(
      verifyRotatedBody(old, next, { kind: 'secret' }, { kind: 'secret' }, source, wrongContent),
    ).rejects.toThrow('mismatch');
  },
);

it('replaces the Seal NEK and resumes head/history processing from the accepted wrapper', async () => {
  const old = await freshMek();
  const next = await freshMek();
  const sealId = 'legacy-seal-id';
  const head = await encryptSealBody(old, 'head', sealId);
  const version = await encryptSealBodyWithExistingKey(old, 'older version', sealId, head.wrappedNoteKey);
  const wrapper = await createRotationSealWrapper(next, sealId);
  const oldRaw = await decryptBytesAesGcm(
    await deriveSealWrapKey(old, sealId),
    head.wrappedNoteKey,
    getSealKeyString(sealId),
  );
  const nextRaw = await decryptBytesAesGcm(await deriveSealWrapKey(next, sealId), wrapper, getSealKeyString(sealId));
  expect(nextRaw).not.toEqual(oldRaw);
  const oldNek = await crypto.subtle.importKey('raw', oldRaw, 'AES-GCM', false, ['decrypt']);
  const source = { kind: 'seal' as const, recordId: sealId, wrappedNoteKey: head.wrappedNoteKey };
  for (const [payload, text] of [
    [head.encryptedBody, 'head'],
    [version.encryptedBody, 'older version'],
  ] as const) {
    // Each iteration loads only the durable wrapper; no process-local NEK survives.
    const target = { ...source, wrappedNoteKey: JSON.parse(JSON.stringify(wrapper)) };
    const staged = await rotateBody(old, next, source, target, payload);
    await expect(decryptSealBody(next, staged, wrapper, sealId)).resolves.toBe(text);
    await expect(decryptAesGcm(oldNek, staged, getSealKeyString(sealId))).rejects.toThrow();
    await expect(verifyRotatedBody(old, next, source, target, payload, staged)).resolves.toBeUndefined();
    await expect(rotateBody(old, next, source, { ...target, recordId: 'wrong' }, payload)).rejects.toThrow('identity');
    await expect(decryptSealBody(next, staged, wrapper, 'wrong')).rejects.toThrow();
  }
});

it('preserves Auth fields and fixed-time TOTP with record AAD and domain separation', async () => {
  const old = await freshMek();
  const next = await freshMek();
  const recordId = 'auth-id';
  const secrets = toOtpSecrets({
    issuer: 'Example',
    account: 'me',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA256',
    digits: 8,
    period: 60,
    note: 'Unicode 🔐',
  });
  const source = await encryptOtpRecord(await deriveOtpVaultKey(old), recordId, secrets);
  const identity = { kind: 'auth' as const, recordId };
  const staged = await rotateBody(old, next, identity, identity, source);
  const result = await decryptOtpRecord(await deriveOtpVaultKey(next), recordId, staged);
  expect(result).toEqual(secrets);
  expect(await codeForRecord(result, 1234567890000)).toBe(await codeForRecord(secrets, 1234567890000));
  await expect(decryptOtpRecord(await deriveOtpVaultKey(old), recordId, staged)).rejects.toThrow();
  await expect(decryptOtpRecord(await deriveOtpVaultKey(next), 'wrong', staged)).rejects.toThrow();
  await expect(decryptSecretBody(next, staged)).rejects.toThrow();
});

it('preserves Auth tombstones and rejects unknown decrypted formats without leaking parser input', async () => {
  const old = await freshMek();
  const next = await freshMek();
  await expect(rotateAuth(old, next, 'auth', null)).resolves.toBeNull();
  for (const text of ['private malformed plaintext', JSON.stringify({ v: 999, secret: 'private seed' })]) {
    const payload = await encryptAesGcm(await deriveOtpVaultKey(old), text, getOtpRecordAad('auth'));
    await expect(rotateAuth(old, next, 'auth', payload)).rejects.toThrow('Unsupported rotation Auth payload');
  }
});

it.each([0, 5 * 1024 * 1024 - 16])('rotates and verifies binary file bytes at size %i', async (size) => {
  const old = await freshMek();
  const next = await freshMek();
  const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251);
  const source = await encryptFileBytes(old, bytes);
  const staged = await rotateFile(old, next, source);
  expect(Buffer.from(await decryptFileBytes(next, staged.iv, staged.cipherBytes)).equals(Buffer.from(bytes))).toBe(
    true,
  );
  expect(staged.iv).not.toBe(source.iv);
  await expect(verifyRotatedFile(old, next, source, staged)).resolves.toBeUndefined();
  await expect(decryptFileBytes(old, staged.iv, staged.cipherBytes)).rejects.toThrow();
  const changed = await encryptFileBytes(next, new Uint8Array([42]));
  await expect(verifyRotatedFile(old, next, source, changed)).rejects.toThrow('mismatch');
});

it('rejects malformed encodings, unsupported algorithms and authenticated corruption', async () => {
  const old = await freshMek();
  const next = await freshMek();
  const source = await encryptSecretBody(old, 'sensitive');
  for (const invalid of [
    { ...source, alg: 'unknown' },
    { ...source, iv: 'bad' },
    { ...source, ciphertext: 'not base64!' },
    { ...source, ciphertext: '' },
    { ...source, iv: `${source.iv}\n` },
  ]) {
    expect(() => validateRotationPayload(invalid as typeof source)).toThrow();
  }
  for (const field of ['ciphertext', 'iv'] as const) {
    const bytes = fromBase64(source[field]);
    bytes[0] ^= 1;
    await expect(
      rotateBody(old, next, { kind: 'secret' }, { kind: 'secret' }, { ...source, [field]: toBase64(bytes) }),
    ).rejects.toThrow();
  }
  const unrelated = await encryptAesGcm(await deriveOtpVaultKey(old), 'auth');
  await expect(rotateBody(old, next, { kind: 'secret' }, { kind: 'secret' }, unrelated)).rejects.toThrow();
});
