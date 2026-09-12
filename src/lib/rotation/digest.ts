/**
 * The browser's half of the staged-item digest.
 *
 * Byte-for-byte the same function as `digest()` in
 * `src/server/rotation/contracts.ts`: keys sorted, dates as ISO strings, JSON,
 * SHA-256, lowercase hex. It exists separately rather than being imported
 * because that module is server-only, and because the point of the digest is
 * that the client computes it independently — acknowledging a hash the server
 * handed back would only prove the server can hash its own data.
 *
 * What it establishes is narrow and worth stating: the digest binds the exact
 * replacement bytes this device verified to the row the server will activate.
 * Plaintext correctness is established by decrypting the staged ciphertext and
 * comparing it in memory, which no server-side checksum can do.
 */

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export async function rotationDigest(value: unknown): Promise<string> {
  const json = JSON.stringify(canonical(value));
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)));
}

/** The canonical serialization itself, for byte budgeting before a request. */
export const rotationSerializedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;
