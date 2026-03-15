import mongoose from 'mongoose';
import type { Address } from 'viem';
import { EncryptionProfileModel } from '../../src/models/EncryptionProfile';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';

const ENC_PBKDF2_ITERATIONS = 600_000;
const ENC_PBKDF2_LENGTH = 32;
const ENC_VERSION = 1;
const HKDF_INFO_VERIFY_KEY = 'key-verify:v1';
const KEY_CHECK_PLAINTEXT = 'notes-key-check:v1';

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf)));
}

function xor32(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = a[i] ^ b[i];
  return out;
}

const kdf = {
  name: 'PBKDF2' as const,
  hash: 'SHA-256' as const,
  iterations: ENC_PBKDF2_ITERATIONS,
  length: ENC_PBKDF2_LENGTH,
};

export const seedEncryptionProfile = async (
  address: Address,
  passphrase: string,
): Promise<{ mekBytes: Uint8Array }> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const subtle = globalThis.crypto.subtle;

  // Generate random salt and server share
  const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const serverShareBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const salt = toBase64(saltBytes);
  const serverShare = toBase64(serverShareBytes);

  // Derive device share via PBKDF2
  const keyMaterial = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const deviceShareBits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: ENC_PBKDF2_ITERATIONS },
    keyMaterial,
    ENC_PBKDF2_LENGTH * 8,
  );
  const deviceShare = new Uint8Array(deviceShareBits);

  // Compute MEK = XOR(deviceShare, serverShare)
  const mekBytes = xor32(deviceShare, serverShareBytes);

  // Import MEK as HKDF base key
  const mek = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);

  // Derive verify key via HKDF
  const verifyKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO_VERIFY_KEY),
    },
    mek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // Create key check: encrypt KEY_CHECK_PLAINTEXT with verifyKey
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    verifyKey,
    new TextEncoder().encode(KEY_CHECK_PLAINTEXT),
  );
  const keyCheck = {
    alg: 'A256GCM' as const,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };

  await EncryptionProfileModel.create({
    walletAddress: address.toLowerCase(),
    version: ENC_VERSION,
    serverShare,
    salt,
    kdf,
    keyCheck,
  });

  return { mekBytes };
};
