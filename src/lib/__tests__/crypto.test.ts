import {
  xor32,
  toBase64,
  fromBase64,
  encodeUtf8,
  decodeUtf8,
  encryptAesGcm,
  decryptAesGcm,
  importMEK,
  deriveSecretBodyKey,
  encryptSecretBody,
  decryptSecretBody,
  createKeyCheck,
  verifyKeyCheck,
  encryptSealBody,
  decryptSealBody,
  encryptFileBytes,
  decryptFileBytes,
  deriveDeviceShare,
  getDefaultKdfParams,
  generateSalt,
  generateServerShare,
  getEncVersion,
} from '@/lib/crypto';
import type { KdfParams } from '@/types/crypto';

async function freshMek(): Promise<CryptoKey> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return importMEK(bytes as Uint8Array<ArrayBuffer>);
}

describe('encoding helpers', () => {
  describe('toBase64 / fromBase64', () => {
    it('roundtrips Uint8Array', () => {
      const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
      const encoded = toBase64(original);
      const decoded = fromBase64(encoded);
      expect(decoded).toEqual(original);
    });

    it('encodes known value', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      expect(toBase64(bytes)).toBe('SGVsbG8=');
    });

    it('decodes known value', () => {
      const decoded = fromBase64('SGVsbG8=');
      expect(Array.from(decoded)).toEqual([72, 101, 108, 108, 111]);
    });

    it('handles empty input', () => {
      expect(toBase64(new Uint8Array(0))).toBe('');
      expect(fromBase64('')).toEqual(new Uint8Array(0));
    });
  });

  describe('encodeUtf8 / decodeUtf8', () => {
    it('roundtrips ASCII', () => {
      const str = 'Hello, world!';
      expect(decodeUtf8(encodeUtf8(str).buffer)).toBe(str);
    });

    it('roundtrips unicode', () => {
      const str = '你好世界 🌍';
      expect(decodeUtf8(encodeUtf8(str).buffer)).toBe(str);
    });

    it('handles empty string', () => {
      expect(decodeUtf8(encodeUtf8('').buffer)).toBe('');
    });
  });
});

describe('xor32', () => {
  it('XORs two 32-byte arrays', () => {
    const a = new Uint8Array(32).fill(0xff);
    const b = new Uint8Array(32).fill(0xaa);
    const result = xor32(a, b);
    expect(result.every((byte) => byte === 0x55)).toBe(true);
  });

  it('XOR with zeros returns original', () => {
    const a = new Uint8Array(32);
    for (let i = 0; i < 32; i++) a[i] = i;
    const zeros = new Uint8Array(32);
    expect(xor32(a, zeros)).toEqual(a);
  });

  it('XOR with self returns zeros', () => {
    const a = new Uint8Array(32).fill(0x42);
    const result = xor32(a, a);
    expect(result.every((byte) => byte === 0)).toBe(true);
  });

  it('throws on wrong length', () => {
    const short = new Uint8Array(16);
    const correct = new Uint8Array(32);
    expect(() => xor32(short, correct)).toThrow('xor32: both inputs must be 32 bytes');
    expect(() => xor32(correct, short)).toThrow('xor32: both inputs must be 32 bytes');
  });
});

describe('AES-GCM encrypt/decrypt roundtrip', () => {
  it('encrypts and decrypts text', async () => {
    const mekBytes = new Uint8Array(32);
    crypto.getRandomValues(mekBytes);
    const mek = await importMEK(mekBytes);
    const key = await deriveSecretBodyKey(mek);

    const plaintext = 'secret message 🔐';
    const encrypted = await encryptAesGcm(key, plaintext);
    const decrypted = await decryptAesGcm(key, encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts with AAD', async () => {
    const mekBytes = new Uint8Array(32);
    crypto.getRandomValues(mekBytes);
    const mek = await importMEK(mekBytes);
    const key = await deriveSecretBodyKey(mek);

    const plaintext = 'authenticated data';
    const aad = 'context-string';
    const encrypted = await encryptAesGcm(key, plaintext, aad);
    const decrypted = await decryptAesGcm(key, encrypted, aad);

    expect(decrypted).toBe(plaintext);
  });

  it('fails to decrypt with wrong AAD', async () => {
    const mekBytes = new Uint8Array(32);
    crypto.getRandomValues(mekBytes);
    const mek = await importMEK(mekBytes);
    const key = await deriveSecretBodyKey(mek);

    const encrypted = await encryptAesGcm(key, 'test', 'correct-aad');
    await expect(decryptAesGcm(key, encrypted, 'wrong-aad')).rejects.toThrow();
  });
});

describe('utility exports', () => {
  it('getDefaultKdfParams returns expected shape', () => {
    const params = getDefaultKdfParams();
    expect(params.name).toBe('PBKDF2');
    expect(params.hash).toBe('SHA-256');
    expect(params.iterations).toBe(600_000);
    expect(params.length).toBe(32);
  });

  it('getEncVersion returns a number', () => {
    expect(getEncVersion()).toBe(1);
  });
});

describe('secret body encryption', () => {
  it('round-trips a string with encryptSecretBody/decryptSecretBody', async () => {
    const mek = await freshMek();
    const plaintext = 'top secret 🤐';
    const encrypted = await encryptSecretBody(mek, plaintext);
    expect(await decryptSecretBody(mek, encrypted)).toBe(plaintext);
  });

  it('fails to decrypt secret body with a different MEK', async () => {
    const mek1 = await freshMek();
    const mek2 = await freshMek();
    const encrypted = await encryptSecretBody(mek1, 'hello');
    await expect(decryptSecretBody(mek2, encrypted)).rejects.toThrow();
  });
});

describe('key check', () => {
  it('verifyKeyCheck returns true with the original MEK', async () => {
    const mek = await freshMek();
    const kc = await createKeyCheck(mek);
    expect(await verifyKeyCheck(mek, kc)).toBe(true);
  });

  it('verifyKeyCheck returns false with a different MEK', async () => {
    const mek = await freshMek();
    const other = await freshMek();
    const kc = await createKeyCheck(mek);
    expect(await verifyKeyCheck(other, kc)).toBe(false);
  });

  it('verifyKeyCheck returns false on a tampered key check payload', async () => {
    const mek = await freshMek();
    const kc = await createKeyCheck(mek);
    const tamperedBytes = fromBase64(kc.ciphertext);
    tamperedBytes[0] ^= 0x01;
    const tampered = { ...kc, ciphertext: toBase64(tamperedBytes) };
    expect(await verifyKeyCheck(mek, tampered)).toBe(false);
  });
});

describe('seal body encryption', () => {
  it('round-trips a string via NEK wrapping', async () => {
    const mek = await freshMek();
    const sealId = 'seal-123';
    const plaintext = 'sealed content';
    const { encryptedBody, wrappedNoteKey } = await encryptSealBody(mek, plaintext, sealId);
    const decrypted = await decryptSealBody(mek, encryptedBody, wrappedNoteKey, sealId);
    expect(decrypted).toBe(plaintext);
  });

  it('throws on decrypt with the wrong sealId (AAD mismatch)', async () => {
    const mek = await freshMek();
    const sealId = 'seal-123';
    const { encryptedBody, wrappedNoteKey } = await encryptSealBody(mek, 'x', sealId);
    await expect(decryptSealBody(mek, encryptedBody, wrappedNoteKey, 'seal-different')).rejects.toThrow();
  });

  it('throws on decrypt with the wrong MEK', async () => {
    const mek = await freshMek();
    const other = await freshMek();
    const sealId = 'seal-123';
    const { encryptedBody, wrappedNoteKey } = await encryptSealBody(mek, 'x', sealId);
    await expect(decryptSealBody(other, encryptedBody, wrappedNoteKey, sealId)).rejects.toThrow();
  });
});

describe('file bytes encryption', () => {
  it('round-trips a Uint8Array via encryptFileBytes/decryptFileBytes', async () => {
    const mek = await freshMek();
    const plain = new Uint8Array(256);
    crypto.getRandomValues(plain);
    const { iv, cipherBytes } = await encryptFileBytes(mek, plain as Uint8Array<ArrayBuffer>);
    const decrypted = await decryptFileBytes(mek, iv, cipherBytes);
    expect(decrypted).toEqual(plain);
  });

  it('throws when ciphertext is tampered', async () => {
    const mek = await freshMek();
    const plain = new Uint8Array([1, 2, 3, 4, 5]);
    const { iv, cipherBytes } = await encryptFileBytes(mek, plain as Uint8Array<ArrayBuffer>);
    const view = new Uint8Array(cipherBytes);
    view[0] ^= 0x01;
    await expect(decryptFileBytes(mek, iv, view.buffer as ArrayBuffer)).rejects.toThrow();
  });
});

describe('deriveDeviceShare', () => {
  const fastParams: KdfParams = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 1000,
    length: 32,
  };
  const salt = toBase64(new Uint8Array(32).fill(7));

  it('is deterministic for the same passphrase + salt + params', async () => {
    const a = await deriveDeviceShare('passphrase-1', salt, fastParams);
    const b = await deriveDeviceShare('passphrase-1', salt, fastParams);
    expect(a).toEqual(b);
  });

  it('produces different bytes for different passphrases', async () => {
    const a = await deriveDeviceShare('passphrase-1', salt, fastParams);
    const b = await deriveDeviceShare('passphrase-2', salt, fastParams);
    expect(a).not.toEqual(b);
  });

  it('returns kdfParams.length bytes', async () => {
    const out = await deriveDeviceShare('passphrase', salt, fastParams);
    expect(out.length).toBe(32);
  });
});

describe('salt and server share generators', () => {
  it('generateSalt returns 32 bytes encoded as base64', () => {
    const salt = generateSalt();
    expect(fromBase64(salt).length).toBe(32);
  });

  it('generateServerShare returns 32 bytes encoded as base64', () => {
    const share = generateServerShare();
    expect(fromBase64(share).length).toBe(32);
  });

  it('generateSalt returns different values across calls', () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });
});
