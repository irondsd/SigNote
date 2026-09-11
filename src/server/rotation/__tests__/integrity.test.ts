import {
  assertByteBudget,
  assertCompleteManifest,
  assertIdempotentPayload,
  byteBoundedPage,
  ciphertextRequestDigest,
  type RotationManifestItem,
  type RotationReplacement,
} from '../integrity';

const digest = (s: string) => ciphertextRequestDigest(Buffer.from(s));
const source: RotationManifestItem[] = [
  { kind: 'seal', id: 'legacy-id', sourceDigest: digest('head') },
  { kind: 'seal-version', id: 'legacy-id', sourceDigest: digest('version') },
];
const staged: RotationReplacement[] = source.map((item) => ({
  ...item,
  replacementDigest: digest(`new-${item.kind}`),
  verifiedDigest: digest(`new-${item.kind}`),
}));

test('exact manifest equality supports overlapping IDs across resource kinds and arbitrary ordering', () => {
  expect(() => assertCompleteManifest(source, [...staged].reverse())).not.toThrow();
  expect(() => assertCompleteManifest([], [])).not.toThrow();
});

test('rejects omissions, duplicates, substituted identities, changed sources, and stale verification', () => {
  expect(() => assertCompleteManifest(source, staged.slice(1))).toThrow('INCOMPLETE');
  expect(() => assertCompleteManifest(source, [staged[0], staged[0]])).toThrow('INVALID_MANIFEST');
  expect(() => assertCompleteManifest(source, [staged[0], { ...staged[1], id: 'foreign' }])).toThrow(
    'INVALID_MANIFEST',
  );
  expect(() => assertCompleteManifest([source[0], source[0]], staged)).toThrow('INVALID_MANIFEST');
  expect(() => assertCompleteManifest(source, [staged[0], { ...staged[1], sourceDigest: digest('changed') }])).toThrow(
    'SOURCE_CHANGED',
  );
  for (const verifiedDigest of [null, digest('previous')]) {
    expect(() => assertCompleteManifest(source, [staged[0], { ...staged[1], verifiedDigest }])).toThrow('UNVERIFIED');
  }
});

test('idempotency binds exact bytes including a regenerated IV', () => {
  expect(() => assertIdempotentPayload(digest('request'), digest('request'))).not.toThrow();
  expect(() => assertIdempotentPayload(digest('request'), digest('new IV'))).toThrow('PAYLOAD_CONFLICT');
});

test('UTF-8 page budgets count the entire envelope and reject oversized first records', () => {
  const items = ['你好', '🌍'];
  const limit = Buffer.byteLength(JSON.stringify({ items }));
  const full = byteBoundedPage(items, limit);
  expect(full).toEqual({ items, bytes: limit });
  expect(byteBoundedPage(items, limit - 1).items).toEqual([items[0]]);
  expect(() => byteBoundedPage(items, 12)).toThrow('BYTE_LIMIT');
});

test('aggregate budgets reject overflow, invalid values and concurrent callers must supply locked totals', () => {
  expect(() => assertByteBudget(8, 2, 10)).not.toThrow();
  for (const values of [
    [8, 3, 10],
    [-1, 1, 10],
    [0, 1, 0],
    [NaN, 0, 10],
    [Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER],
  ]) {
    expect(() => assertByteBudget(...(values as [number, number, number]))).toThrow('BYTE_LIMIT');
  }
});
