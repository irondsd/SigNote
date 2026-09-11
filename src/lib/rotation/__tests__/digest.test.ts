/**
 * The client's digest and the server's are two implementations of one
 * definition, in two runtimes. If they ever drift, every acknowledgement the
 * browser sends becomes a hash of something the server is not about to
 * activate — so they are compared directly rather than each tested alone.
 */

import { digest as serverDigest } from '@/server/rotation/contracts';
import { rotationDigest } from '@/lib/rotation/digest';

const payload = { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'Y2lwaGVydGV4dA==' };

const cases: [string, unknown][] = [
  ['a null tombstone', null],
  ['an encrypted payload', payload],
  [
    'the same payload with its keys written in another order',
    {
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      alg: payload.alg,
    },
  ],
  ['a file receipt', { key: 'rotation/op/object', bytes: 4112, checksum: 'Y2hlY2tzdW0=', iv: 'AAAAAAAAAAAAAAAA' }],
  ['nested structures', { outer: { b: [1, 2, { z: null, a: 'x' }], a: true } }],
  ['an empty object', {}],
  ['non-ASCII text', { note: '你好 🌍' }],
];

it.each(cases)('agrees with the server for %s', async (_name, value) => {
  await expect(rotationDigest(value)).resolves.toBe(serverDigest(value));
});

it('separates values that differ only in key order of a nested object', async () => {
  const a = await rotationDigest({ item: { a: 1, b: 2 } });
  const b = await rotationDigest({ item: { b: 2, a: 1 } });
  expect(a).toBe(b);
  expect(a).not.toBe(await rotationDigest({ item: { a: 2, b: 1 } }));
});

it('produces lowercase hex of a SHA-256', async () => {
  await expect(rotationDigest(payload)).resolves.toMatch(/^[0-9a-f]{64}$/);
});
