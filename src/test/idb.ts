/**
 * Browser storage shims for the jsdom test environment.
 *
 * jsdom provides neither Web Crypto, `TextEncoder` nor `structuredClone`, and
 * fake-indexeddb clones every value on write. Import this once, before the
 * module under test.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// jsdom ships neither, and `lib/crypto.ts` encodes every passphrase and AAD
// through them, so anything touching real encryption needs them present.
if (typeof globalThis.TextEncoder !== 'function') {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

/**
 * A structured clone that is faithful for what these tests need: plain data is
 * deep-copied, and a `CryptoKey` passes through by reference.
 *
 * Node's own `structuredClone` flattens a webcrypto `CryptoKey` into a bare
 * object, losing `extractable` and `usages` — which is precisely the property
 * the vault store exists to preserve. Real browsers clone a `CryptoKey` into a
 * key that is still non-extractable and still usable, so passing the instance
 * through models the browser more accurately than Node's does.
 */
/**
 * Brand check rather than `instanceof`: jsdom defines its own `CryptoKey`
 * class, so a key minted by Node's webcrypto is not an instance of the global
 * one and an `instanceof` test silently misses it.
 */
const isCryptoKey = (value: object): boolean => Object.prototype.toString.call(value) === '[object CryptoKey]';

function cloneForIdb<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (isCryptoKey(value)) return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;

  const existing = seen.get(value as object);
  if (existing) return existing as T;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value as object, out);
    for (const item of value) out.push(cloneForIdb(item, seen));
    return out as T;
  }

  const out: Record<string, unknown> = {};
  seen.set(value as object, out);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = cloneForIdb(item, seen);
  }
  return out as T;
}

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = cloneForIdb as typeof globalThis.structuredClone;
}
