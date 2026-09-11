/** Browser/worker primitives only. No storage, network, or active-vault writes. */
import { getOtpRecordAad, getSealKeyString } from '@/config/constants';
import {
  createKeyCheck,
  decryptBytesAesGcm,
  deriveDeviceShare,
  deriveFileEncKey,
  deriveOtpVaultKey,
  deriveSealWrapKey,
  deriveSecretBodyKey,
  encryptBytesAesGcm,
  fromBase64,
  generateSalt,
  getDefaultKdfParams,
  getEncVersion,
  importMEK,
  toBase64,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';
import type { EncryptedPayload, KdfParams } from '@/types/crypto';
import { otpSecretsSchema } from '@/lib/otp/record';

export type RotationMaterial = {
  version: number;
  salt: string;
  kdf: KdfParams;
  serverShare: string;
  keyCheck: EncryptedPayload;
};

function decodeCanonical(value: string, size?: number): Uint8Array<ArrayBuffer> {
  const bytes = fromBase64(value);
  if (toBase64(bytes) !== value || (size !== undefined && bytes.length !== size)) {
    throw new Error('Invalid rotation encoding');
  }
  return bytes;
}

export function validateRotationPayload(payload: EncryptedPayload): void {
  if (payload.alg !== 'A256GCM') throw new Error('Unsupported rotation algorithm');
  decodeCanonical(payload.iv, 12);
  if (decodeCanonical(payload.ciphertext).length < 16) throw new Error('Invalid rotation ciphertext');
}

/** Always uses the production KDF policy, even when the passphrase is unchanged. */
export async function createRotationMaterial(passphrase: string) {
  const salt = generateSalt();
  const kdf = getDefaultKdfParams();
  const deviceShare = await deriveDeviceShare(passphrase, salt, kdf);
  const rawMek = crypto.getRandomValues(new Uint8Array(32));
  try {
    const mek = await importMEK(rawMek);
    const material: RotationMaterial = {
      version: getEncVersion(),
      salt,
      kdf,
      serverShare: toBase64(xor32(rawMek, deviceShare)),
      keyCheck: await createKeyCheck(mek),
    };
    // Only material is safe to stage. deviceShare belongs in the recovery file.
    return { material, mek, deviceShare };
  } finally {
    rawMek.fill(0);
  }
}

/**
 * Reconstruct either generation from fresh server material after browser loss,
 * keeping the device share.
 *
 * Resuming needs both halves: the key, to carry on re-encrypting, and the
 * device share, because the pending recovery file is made of it. Minting fresh
 * material instead would produce a key that opens nothing already staged.
 */
export async function reopenRotationMaterial(
  passphrase: string,
  material: RotationMaterial,
): Promise<{ mek: CryptoKey; deviceShare: Uint8Array }> {
  const policy = getDefaultKdfParams();
  if (
    material.version !== getEncVersion() ||
    material.kdf.name !== policy.name ||
    material.kdf.hash !== policy.hash ||
    material.kdf.length !== policy.length ||
    material.kdf.iterations !== policy.iterations
  ) {
    throw new Error('Unsupported rotation material');
  }
  decodeCanonical(material.salt, 32);
  const serverShare = decodeCanonical(material.serverShare, 32);
  validateRotationPayload(material.keyCheck);
  const deviceShare = await deriveDeviceShare(passphrase, material.salt, material.kdf);
  const rawMek = xor32(deviceShare, serverShare);
  try {
    const mek = await importMEK(rawMek);
    if (!(await verifyKeyCheck(mek, material.keyCheck))) {
      deviceShare.fill(0);
      throw new Error('Invalid rotation credentials');
    }
    return { mek, deviceShare };
  } finally {
    rawMek.fill(0);
  }
}

/** The same check when only the key is wanted; the share is zeroed on the way out. */
export async function unlockRotationMaterial(passphrase: string, material: RotationMaterial): Promise<CryptoKey> {
  const { mek, deviceShare } = await reopenRotationMaterial(passphrase, material);
  deviceShare.fill(0);
  return mek;
}

export type RotationBody =
  | { kind: 'secret' }
  | { kind: 'auth'; recordId: string }
  | { kind: 'seal'; recordId: string; wrappedNoteKey: EncryptedPayload };

async function bodyKey(mek: CryptoKey, body: RotationBody): Promise<{ key: CryptoKey; aad?: string }> {
  if (body.kind === 'secret') return { key: await deriveSecretBodyKey(mek) };
  if (!body.recordId) throw new Error('Missing rotation record identity');
  if (body.kind === 'auth') return { key: await deriveOtpVaultKey(mek), aad: getOtpRecordAad(body.recordId) };
  validateRotationPayload(body.wrappedNoteKey);
  const aad = getSealKeyString(body.recordId);
  const raw = await decryptBytesAesGcm(await deriveSealWrapKey(mek, body.recordId), body.wrappedNoteKey, aad);
  try {
    if (raw.length !== 32) throw new Error('Invalid Seal key');
    return { key: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']), aad };
  } finally {
    raw.fill(0);
  }
}

/** Stage this once, then fetch/reuse the accepted wrapper for every head/version. */
export async function createRotationSealWrapper(targetMek: CryptoKey, sealId: string): Promise<EncryptedPayload> {
  if (!sealId) throw new Error('Missing rotation record identity');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    return await encryptBytesAesGcm(await deriveSealWrapKey(targetMek, sealId), raw, getSealKeyString(sealId));
  } finally {
    raw.fill(0);
  }
}

function checkBodyIdentity(source: RotationBody, target: RotationBody) {
  if (
    source.kind !== target.kind ||
    (source.kind !== 'secret' && (target.kind === 'secret' || source.recordId !== target.recordId))
  ) {
    throw new Error('Rotation identity mismatch');
  }
}

function validatePlainBody(body: RotationBody, bytes: Uint8Array) {
  if (body.kind !== 'auth') return;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (otpSecretsSchema.safeParse(value).success) return;
  } catch {
    // Do not include JSON parser errors: they can contain plaintext snippets.
  }
  throw new Error('Unsupported rotation Auth payload');
}

/** Null Auth tombstones stay null; rotation must never resurrect them. */
export async function rotateAuth(
  sourceMek: CryptoKey,
  targetMek: CryptoKey,
  recordId: string,
  payload: EncryptedPayload | null,
): Promise<EncryptedPayload | null> {
  if (payload === null) return null;
  const body = { kind: 'auth' as const, recordId };
  return rotateBody(sourceMek, targetMek, body, body, payload);
}

export async function rotateBody(
  sourceMek: CryptoKey,
  targetMek: CryptoKey,
  source: RotationBody,
  target: RotationBody,
  payload: EncryptedPayload,
): Promise<EncryptedPayload> {
  checkBodyIdentity(source, target);
  validateRotationPayload(payload);
  const oldKey = await bodyKey(sourceMek, source);
  const nextKey = await bodyKey(targetMek, target);
  const plain = await decryptBytesAesGcm(oldKey.key, payload, oldKey.aad);
  try {
    validatePlainBody(source, plain);
    return await encryptBytesAesGcm(nextKey.key, plain, nextKey.aad);
  } finally {
    plain.fill(0);
  }
}

/** Pass ciphertext fetched back from staging, never the local encrypt result. */
export async function verifyRotatedBody(
  sourceMek: CryptoKey,
  targetMek: CryptoKey,
  source: RotationBody,
  target: RotationBody,
  original: EncryptedPayload,
  staged: EncryptedPayload,
): Promise<void> {
  checkBodyIdentity(source, target);
  validateRotationPayload(original);
  validateRotationPayload(staged);
  const oldKey = await bodyKey(sourceMek, source);
  const nextKey = await bodyKey(targetMek, target);
  const plain = await decryptBytesAesGcm(oldKey.key, original, oldKey.aad);
  let replacement: Uint8Array | undefined;
  try {
    validatePlainBody(source, plain);
    replacement = await decryptBytesAesGcm(nextKey.key, staged, nextKey.aad);
    if (plain.length !== replacement.length || plain.some((byte, i) => byte !== replacement![i])) {
      throw new Error('Rotation verification mismatch');
    }
  } finally {
    plain.fill(0);
    replacement?.fill(0);
  }
}

export type RotationFile = { iv: string; cipherBytes: ArrayBuffer };
async function decryptFile(mek: CryptoKey, file: RotationFile) {
  const iv = decodeCanonical(file.iv, 12);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await deriveFileEncKey(mek), file.cipherBytes),
  );
}

export async function rotateFile(
  sourceMek: CryptoKey,
  targetMek: CryptoKey,
  source: RotationFile,
): Promise<RotationFile> {
  const plain = await decryptFile(sourceMek, source);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return {
      iv: toBase64(iv),
      cipherBytes: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveFileEncKey(targetMek), plain),
    };
  } finally {
    plain.fill(0);
  }
}

export async function verifyRotatedFile(
  sourceMek: CryptoKey,
  targetMek: CryptoKey,
  source: RotationFile,
  staged: RotationFile,
) {
  const plain = await decryptFile(sourceMek, source);
  let replacement: Uint8Array | undefined;
  try {
    replacement = await decryptFile(targetMek, staged);
    if (plain.length !== replacement.length || plain.some((byte, i) => byte !== replacement![i])) {
      throw new Error('Rotation verification mismatch');
    }
  } finally {
    plain.fill(0);
    replacement?.fill(0);
  }
}
