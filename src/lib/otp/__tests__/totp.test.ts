import { decodeBase32, encodeBase32 } from '../base32';
import {
  counterToBytes,
  hotp,
  msUntilNextStep,
  secondsRemaining,
  totp,
  totpCounter,
  truncateHmac,
  type OtpAlgorithm,
} from '../totp';

/** RFC 4226 Appendix D: the ASCII seed "12345678901234567890". */
const RFC4226_SECRET = new TextEncoder().encode('12345678901234567890') as Uint8Array<ArrayBuffer>;

/**
 * RFC 6238 Appendix B. The published table is generated with a *different* seed
 * per algorithm — the ASCII string repeated to the hash's key length — which is
 * the detail most reimplementations get wrong and then quietly ship broken
 * SHA-256/SHA-512 support.
 */
const RFC6238_SECRETS: Record<OtpAlgorithm, Uint8Array<ArrayBuffer>> = {
  SHA1: new TextEncoder().encode('12345678901234567890') as Uint8Array<ArrayBuffer>,
  SHA256: new TextEncoder().encode('12345678901234567890123456789012') as Uint8Array<ArrayBuffer>,
  SHA512: new TextEncoder().encode(
    '1234567890123456789012345678901234567890123456789012345678901234',
  ) as Uint8Array<ArrayBuffer>,
};

describe('counterToBytes', () => {
  it('encodes big-endian into 8 bytes', () => {
    expect(Array.from(counterToBytes(0))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(counterToBytes(1))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(counterToBytes(255))).toEqual([0, 0, 0, 0, 0, 0, 0, 255]);
    expect(Array.from(counterToBytes(256))).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it('carries past 32 bits', () => {
    // 0x0000000100000000
    expect(Array.from(counterToBytes(0x1_0000_0000))).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    // RFC 6238's largest test time, 20000000000s / 30 = 666666666
    expect(Array.from(counterToBytes(666_666_666))).toEqual([0, 0, 0, 0, 0x27, 0xbc, 0x86, 0xaa]);
  });
});

describe('truncateHmac', () => {
  // RFC 4226 §5.4 worked example.
  const HMAC = Uint8Array.from([
    0x1f, 0x86, 0x98, 0x69, 0x0e, 0x02, 0xca, 0x16, 0x61, 0x85, 0x50, 0xef, 0x7f, 0x19, 0xda, 0x8e, 0x94, 0x5b, 0x55,
    0x5a,
  ]);

  it('reproduces the RFC 4226 worked example', () => {
    expect(truncateHmac(HMAC, 6)).toBe('872921');
  });

  it('pads short codes with leading zeros', () => {
    // 0x00000000 truncates to 0 — the classic bug is rendering "0" not "000000".
    const zeroed = Uint8Array.from([...new Array(19).fill(0), 0x00]);
    expect(truncateHmac(zeroed, 6)).toBe('000000');
    expect(truncateHmac(zeroed, 8)).toBe('00000000');
  });
});

describe('hotp — RFC 4226 Appendix D', () => {
  const EXPECTED = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

  it.each(EXPECTED.map((code, counter) => [counter, code]))('counter %i → %s', async (counter, expected) => {
    await expect(hotp(RFC4226_SECRET, counter as number)).resolves.toBe(expected);
  });
});

describe('totp — RFC 6238 Appendix B', () => {
  const VECTORS: [number, OtpAlgorithm, string][] = [
    [59, 'SHA1', '94287082'],
    [59, 'SHA256', '46119246'],
    [59, 'SHA512', '90693936'],
    [1111111109, 'SHA1', '07081804'],
    [1111111109, 'SHA256', '68084774'],
    [1111111109, 'SHA512', '25091201'],
    [1111111111, 'SHA1', '14050471'],
    [1111111111, 'SHA256', '67062674'],
    [1111111111, 'SHA512', '99943326'],
    [1234567890, 'SHA1', '89005924'],
    [1234567890, 'SHA256', '91819424'],
    [1234567890, 'SHA512', '93441116'],
    [2000000000, 'SHA1', '69279037'],
    [2000000000, 'SHA256', '90698825'],
    [2000000000, 'SHA512', '38618901'],
    [20000000000, 'SHA1', '65353130'],
    [20000000000, 'SHA256', '77737706'],
    [20000000000, 'SHA512', '47863826'],
  ];

  it.each(VECTORS)('t=%i %s → %s', async (seconds, algorithm, expected) => {
    await expect(
      totp(RFC6238_SECRETS[algorithm], { algorithm, digits: 8, period: 30, now: seconds * 1000 }),
    ).resolves.toBe(expected);
  });
});

describe('step boundaries', () => {
  it('holds the same code for the whole step and changes on the next', async () => {
    const params = { period: 30, now: 0 };
    const atStart = await totp(RFC4226_SECRET, { ...params, now: 30_000 });
    const justBefore = await totp(RFC4226_SECRET, { ...params, now: 59_999 });
    const atNext = await totp(RFC4226_SECRET, { ...params, now: 60_000 });

    expect(justBefore).toBe(atStart);
    expect(atNext).not.toBe(atStart);
  });

  it('counts steps from the Unix epoch', () => {
    expect(totpCounter(0, 30)).toBe(0);
    expect(totpCounter(29_999, 30)).toBe(0);
    expect(totpCounter(30_000, 30)).toBe(1);
    expect(totpCounter(59_000 * 1000, 60)).toBe(983);
  });

  it('reports the time left in the step', () => {
    expect(msUntilNextStep(0, 30)).toBe(30_000);
    expect(msUntilNextStep(1_000, 30)).toBe(29_000);
    expect(msUntilNextStep(29_999, 30)).toBe(1);

    expect(secondsRemaining(0, 30)).toBe(30);
    expect(secondsRemaining(1_000, 30)).toBe(29);
    // Anything inside the final second still reads as 1, never 0.
    expect(secondsRemaining(29_999, 30)).toBe(1);
  });

  it('honours a non-default period', async () => {
    const a = await totp(RFC4226_SECRET, { period: 60, now: 0 });
    const b = await totp(RFC4226_SECRET, { period: 60, now: 59_999 });
    const c = await totp(RFC4226_SECRET, { period: 60, now: 60_000 });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});

describe('digit counts', () => {
  it('always renders exactly `digits` characters', async () => {
    for (const digits of [6, 7, 8] as const) {
      const code = await totp(RFC4226_SECRET, { digits, now: 1234567890_000 });
      expect(code).toHaveLength(digits);
      expect(code).toMatch(/^\d+$/);
    }
  });

  it('agrees with the RFC vector truncated to 6 digits', async () => {
    // The Appendix B 8-digit SHA1 value at t=59 is 94287082.
    await expect(totp(RFC6238_SECRETS.SHA1, { digits: 6, now: 59_000 })).resolves.toBe('287082');
  });
});

describe('base32 round trip into code generation', () => {
  it('generates the same code from an encoded seed', async () => {
    const b32 = encodeBase32(RFC4226_SECRET);
    const decoded = decodeBase32(b32);
    expect(Array.from(decoded)).toEqual(Array.from(RFC4226_SECRET));
    await expect(totp(decoded, { digits: 8, now: 59_000 })).resolves.toBe('94287082');
  });
});
