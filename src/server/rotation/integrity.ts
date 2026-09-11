/** Persistence-independent checks. Call inside the eventual account transaction.
 * These checks alone do not implement a durable fence or authorize a request.
 */
import { createHash } from 'node:crypto';

export type RotationIdentity = {
  kind: 'secret' | 'secret-version' | 'seal' | 'seal-version' | 'seal-wrapper' | 'auth' | 'file';
  id: string;
};
export type RotationManifestItem = RotationIdentity & { sourceDigest: string };
export type RotationReplacement = RotationManifestItem & {
  replacementDigest: string;
  verifiedDigest: string | null;
};

export class RotationIntegrityError extends Error {
  constructor(
    readonly code:
      'INVALID_MANIFEST' | 'INCOMPLETE' | 'SOURCE_CHANGED' | 'UNVERIFIED' | 'PAYLOAD_CONFLICT' | 'BYTE_LIMIT',
  ) {
    super(code);
    this.name = 'RotationIntegrityError';
  }
}

function identity(item: RotationIdentity): string {
  if (!item.id) throw new RotationIntegrityError('INVALID_MANIFEST');
  return JSON.stringify([item.kind, item.id]);
}
function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

/** Hash exact serialized ciphertext request bytes, never a plaintext hash. */
export function ciphertextRequestDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertIdempotentPayload(acceptedDigest: string, incomingDigest: string): void {
  if (!validDigest(acceptedDigest) || !validDigest(incomingDigest) || acceptedDigest !== incomingDigest) {
    throw new RotationIntegrityError('PAYLOAD_CONFLICT');
  }
}

/** Equal counts are insufficient: duplicates and substituted IDs must fail. */
export function assertCompleteManifest(
  source: readonly RotationManifestItem[],
  staged: readonly RotationReplacement[],
): void {
  const expected = new Map<string, string>();
  for (const item of source) {
    const key = identity(item);
    if (expected.has(key) || !validDigest(item.sourceDigest)) throw new RotationIntegrityError('INVALID_MANIFEST');
    expected.set(key, item.sourceDigest);
  }
  const seen = new Set<string>();
  for (const item of staged) {
    const key = identity(item);
    if (seen.has(key) || !expected.has(key)) throw new RotationIntegrityError('INVALID_MANIFEST');
    seen.add(key);
    if (expected.get(key) !== item.sourceDigest) throw new RotationIntegrityError('SOURCE_CHANGED');
    if (!validDigest(item.replacementDigest) || item.verifiedDigest !== item.replacementDigest) {
      throw new RotationIntegrityError('UNVERIFIED');
    }
  }
  if (seen.size !== expected.size) throw new RotationIntegrityError('INCOMPLETE');
}

/** Explicit caller-provided, measured budgets; no guessed deployment defaults. */
export function assertByteBudget(current: number, additional: number, maximum: number): void {
  if (
    ![current, additional, maximum].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    maximum === 0 ||
    current > maximum ||
    additional > maximum - current
  ) {
    throw new RotationIntegrityError('BYTE_LIMIT');
  }
}

/** Includes JSON punctuation and UTF-8 overhead. Does not silently skip a large item. */
export function byteBoundedPage<T>(items: Iterable<T>, maximumBytes: number): { items: T[]; bytes: number } {
  const page: T[] = [];
  let bytes = Buffer.byteLength('{"items":[]}');
  assertByteBudget(0, bytes, maximumBytes);
  for (const item of items) {
    const serialized = JSON.stringify(item);
    if (serialized === undefined) throw new RotationIntegrityError('INVALID_MANIFEST');
    const extra = Buffer.byteLength(serialized) + (page.length ? 1 : 0);
    if (extra > maximumBytes - bytes) {
      if (!page.length) throw new RotationIntegrityError('BYTE_LIMIT');
      break;
    }
    page.push(item);
    bytes += extra;
  }
  return { items: page, bytes };
}
