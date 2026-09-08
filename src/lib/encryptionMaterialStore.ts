import { createStore, del, get, set, clear } from 'idb-keyval';

import type { EncryptedPayload, KdfParams } from '@/types/crypto';

/**
 * The device-side copy of `encryption.material`, which exists only when the
 * account has opted in under Security → "Unlock without a network".
 *
 * It is stored explicitly rather than left to the service worker's HTTP cache.
 * That cache took the response as a side effect of fetching it — nobody chose
 * it, batched tRPC URLs made it hard to even name, and it survived sign-out.
 * Here the write is a decision with one call site, and clearing it is a
 * `del()` rather than a guess about which cache keys matched.
 *
 * What it holds is `serverShare`: one half of the MEK. The other half is
 * derived from the passphrase and never stored, so a stolen device still has
 * to brute-force the passphrase — but that is exactly the margin the split was
 * there to avoid spending, which is why this is off by default.
 */
export type StoredMaterial = {
  version: number;
  serverShare: string;
  salt: string;
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
};

// Its own database, not a second store inside `signote-offline`: idb-keyval
// opens a database at version 1 with one object store, so adding a store to an
// existing one would need a manual upgrade path.
let store: ReturnType<typeof createStore> | null = null;
const getMaterialStore = () => (store ??= createStore('signote-encryption', 'material'));

/** Keyed by user so a shared device can't hand one account another's share. */
const keyFor = (userId: string) => `material:${userId}`;

export const saveStoredMaterial = (userId: string, material: StoredMaterial): Promise<void> =>
  set(keyFor(userId), material, getMaterialStore());

export const loadStoredMaterial = (userId: string): Promise<StoredMaterial | null> =>
  get<StoredMaterial>(keyFor(userId), getMaterialStore()).then((value) => value ?? null);

export const clearStoredMaterial = (userId: string): Promise<void> => del(keyFor(userId), getMaterialStore());

/** Sign-out and account erasure: no user id needed, and none is trusted. */
export const clearAllStoredMaterial = (): Promise<void> => clear(getMaterialStore());

/**
 * Whether this device may keep `serverShare`, as far as the caller currently
 * knows. `undefined` is "the preference hasn't loaded yet" and is deliberately
 * distinct from `false`: it must neither store nor delete.
 */
export type MaterialCachePolicy = { userId: string | undefined; allowed: boolean | undefined };

/**
 * Fetches the unlock material and applies the policy to the device copy. The
 * only place that copy is written or read.
 *
 * The server's answer always wins, so a rotated `serverShare` (passphrase
 * change, recovery) replaces the stored one rather than leaving behind a copy
 * that would fail its key check offline. The stored copy is consulted only
 * when the request itself fails — which offline is the whole point, and from
 * here is indistinguishable from any other failure.
 */
export async function resolveMaterial(
  fetchFromServer: () => Promise<StoredMaterial>,
  policy: MaterialCachePolicy,
): Promise<StoredMaterial> {
  const { userId, allowed } = policy;
  try {
    const material = await fetchFromServer();
    if (userId && allowed === true) await saveStoredMaterial(userId, material).catch(() => undefined);
    if (userId && allowed === false) await clearStoredMaterial(userId).catch(() => undefined);
    return material;
  } catch (error) {
    if (!userId) throw error;
    const stored = await loadStoredMaterial(userId).catch(() => null);
    if (!stored) throw error;
    return stored;
  }
}
