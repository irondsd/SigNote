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
  getDefaultKdfParams,
  getEncVersion,
} from '@/lib/crypto';

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
