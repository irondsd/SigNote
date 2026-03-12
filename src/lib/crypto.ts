'use client';

import {
  ENC_PBKDF2_ITERATIONS,
  ENC_PBKDF2_LENGTH,
  ENC_SESSION_KEY,
  ENC_VERSION,
  HKDF_INFO_SECRET_BODY,
  HKDF_INFO_VERIFY_KEY,
  KEY_CHECK_PLAINTEXT,
  getSealKeyString,
} from '@/config/constants';
import { EncryptedPayload, KdfParams } from '@/types/crypto';

// ─── Encoding helpers ────────────────────────────────────────────────────────

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf)));
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

function encodeUtf8(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str) as Uint8Array<ArrayBuffer>;
}

function decodeUtf8(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

// ─── Core primitives ─────────────────────────────────────────────────────────

export function xor32(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (a.length !== 32 || b.length !== 32) throw new Error('xor32: both inputs must be 32 bytes');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = a[i] ^ b[i];
  return out;
}

export async function deriveDeviceShare(
  passphrase: string,
  saltB64: string,
  kdfParams: KdfParams,
): Promise<Uint8Array> {
  const salt = fromBase64(saltB64);
  const keyMaterial = await crypto.subtle.importKey('raw', encodeUtf8(passphrase), 'PBKDF2', false, ['deriveBits']);

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: kdfParams.hash,
      salt,
      iterations: kdfParams.iterations,
    },
    keyMaterial,
    kdfParams.length * 8, // bits
  );

  return new Uint8Array(bits);
}

/** Import raw MEK bytes as an HKDF base key */
export async function importMEK(mekBytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', mekBytes, 'HKDF', false, ['deriveKey']);
}

// ─── HKDF derivations ────────────────────────────────────────────────────────

async function hkdfDeriveAesKey(baseMek: CryptoKey, info: string): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // empty salt — info provides domain separation
      info: encodeUtf8(info),
    },
    baseMek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function deriveSecretBodyKey(mek: CryptoKey): Promise<CryptoKey> {
  return hkdfDeriveAesKey(mek, HKDF_INFO_SECRET_BODY);
}

export async function deriveVerifyKey(mek: CryptoKey): Promise<CryptoKey> {
  return hkdfDeriveAesKey(mek, HKDF_INFO_VERIFY_KEY);
}

export async function deriveSealWrapKey(mek: CryptoKey, sealId: string): Promise<CryptoKey> {
  return hkdfDeriveAesKey(mek, getSealKeyString(sealId));
}

// ─── AES-GCM primitives ──────────────────────────────────────────────────────

export async function encryptAesGcm(key: CryptoKey, plaintext: string, aad?: string): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = aad ? encodeUtf8(aad) : undefined;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, ...(additionalData && { additionalData }) },
    key,
    encodeUtf8(plaintext),
  );

  return {
    alg: 'A256GCM',
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

export async function decryptAesGcm(key: CryptoKey, payload: EncryptedPayload, aad?: string): Promise<string> {
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const additionalData = aad ? encodeUtf8(aad) : undefined;

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, ...(additionalData && { additionalData }) },
    key,
    ciphertext,
  );

  return decodeUtf8(plaintext);
}

/** Raw encrypt of Uint8Array bytes (for wrapping note keys) */
async function encryptBytesAesGcm(
  key: CryptoKey,
  plaintextBytes: Uint8Array<ArrayBuffer>,
  aad?: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = aad ? encodeUtf8(aad) : undefined;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, ...(additionalData && { additionalData }) },
    key,
    plaintextBytes,
  );

  return {
    alg: 'A256GCM',
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

async function decryptBytesAesGcm(
  key: CryptoKey,
  payload: EncryptedPayload,
  aad?: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const additionalData = aad ? encodeUtf8(aad) : undefined;

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, ...(additionalData && { additionalData }) },
    key,
    ciphertext,
  );

  return new Uint8Array(plaintext);
}

// ─── Key check ───────────────────────────────────────────────────────────────

export async function createKeyCheck(mek: CryptoKey): Promise<EncryptedPayload> {
  const verifyKey = await deriveVerifyKey(mek);
  return encryptAesGcm(verifyKey, KEY_CHECK_PLAINTEXT);
}

/** Returns true if passphrase is correct (key check decrypts to known constant) */
export async function verifyKeyCheck(mek: CryptoKey, keyCheck: EncryptedPayload): Promise<boolean> {
  try {
    const verifyKey = await deriveVerifyKey(mek);
    const plaintext = await decryptAesGcm(verifyKey, keyCheck);
    return plaintext === KEY_CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

// ─── Secret body encryption ──────────────────────────────────────────────────

export async function encryptSecretBody(mek: CryptoKey, plaintext: string): Promise<EncryptedPayload> {
  const secretBodyKey = await deriveSecretBodyKey(mek);
  return encryptAesGcm(secretBodyKey, plaintext);
}

export async function decryptSecretBody(mek: CryptoKey, payload: EncryptedPayload): Promise<string> {
  const secretBodyKey = await deriveSecretBodyKey(mek);
  return decryptAesGcm(secretBodyKey, payload);
}

// ─── Seal body encryption ────────────────────────────────────────────────────

type SealEncryptResult = {
  encryptedBody: EncryptedPayload;
  wrappedNoteKey: EncryptedPayload;
};

export async function encryptSealBody(mek: CryptoKey, plaintext: string, sealId: string): Promise<SealEncryptResult> {
  const aad = getSealKeyString(sealId);

  // Generate random Note Encryption Key (NEK)
  const nek = crypto.getRandomValues(new Uint8Array(32));

  // Import NEK as AES-GCM key for body encryption
  const nekKey = await crypto.subtle.importKey('raw', nek, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);

  // Encrypt body with NEK
  const encryptedBody = await encryptAesGcm(nekKey, plaintext, aad);

  // Derive seal wrapping key from MEK + sealId
  const sealWrapKey = await deriveSealWrapKey(mek, sealId);

  // Wrap NEK with sealWrapKey
  const wrappedNoteKey = await encryptBytesAesGcm(sealWrapKey, nek, aad);

  return { encryptedBody, wrappedNoteKey };
}

export async function decryptSealBody(
  mek: CryptoKey,
  encryptedBody: EncryptedPayload,
  wrappedNoteKey: EncryptedPayload,
  sealId: string,
): Promise<string> {
  const aad = getSealKeyString(sealId);

  // Derive seal wrapping key
  const sealWrapKey = await deriveSealWrapKey(mek, sealId);

  // Unwrap NEK
  const nekBytes = await decryptBytesAesGcm(sealWrapKey, wrappedNoteKey, aad);

  // Import NEK for decryption
  const nekKey = await crypto.subtle.importKey('raw', nekBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);

  // Decrypt body
  return decryptAesGcm(nekKey, encryptedBody, aad);
}

// ─── Default KDF params ──────────────────────────────────────────────────────

export function getDefaultKdfParams(): KdfParams {
  return {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: ENC_PBKDF2_ITERATIONS,
    length: ENC_PBKDF2_LENGTH,
  };
}

export function generateSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export function generateServerShare(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export function getEncVersion(): number {
  return ENC_VERSION;
}

// ─── Session storage helpers ─────────────────────────────────────────────────

export function saveDeviceShare(deviceShare: Uint8Array): void {
  sessionStorage.setItem(ENC_SESSION_KEY, toBase64(deviceShare));
}

export function loadDeviceShare(): Uint8Array | null {
  const stored = sessionStorage.getItem(ENC_SESSION_KEY);
  if (!stored) return null;
  try {
    return fromBase64(stored);
  } catch {
    return null;
  }
}

export function clearDeviceShare(): void {
  sessionStorage.removeItem(ENC_SESSION_KEY);
}
