/**
 * What a device does once it learns the account's encryption generation moved.
 *
 * Everything this browser derived from the old MEK is now unreadable: the
 * device share in `sessionStorage`, an opted-in copy of `serverShare`, the
 * Authenticator's vault key and its cached rows, encrypted draft checkpoints,
 * decrypted blobs held by the query cache, and whatever the HTTP cache kept of
 * the encrypted tiers. None of it is dangerous to keep — it simply cannot be
 * decrypted any more — but rendering a mix of old plaintext and new ciphertext
 * is, so all of it goes before the app draws the new generation.
 *
 * The order matters in one direction only: the persistent marker is completed
 * *last*. A crash anywhere in between leaves `reconciled: false` on disk, and
 * the next launch runs the whole thing again rather than trusting a half-purged
 * device. Every step is individually failure-tolerant for the same reason —
 * one unavailable storage API must not strand the rest.
 */

import { clearDeviceShare } from '@/lib/crypto';
import { SOFT_LOCK_TS_KEY } from '@/config/constants';
import { clearStoredMaterial } from '@/lib/encryptionMaterialStore';
import { announceVaultRemoval, removeVault } from '@/lib/otpStore';
import { loadDrafts, clearDraft } from '@/lib/draft';
import { queryCacheStorage } from '@/lib/idb';
import { completeReconciliation } from '@/lib/encryptionGeneration';
import { getQueryClient } from '@/utils/getQueryClient';

/** Cache names written by `src/sw.ts` and Serwist's `defaultCache` that can
 * hold a response body belonging to the superseded generation. */
const GENERATION_SCOPED_CACHES = ['apis', 'pages-cache', 'static-data-assets', 'next-data'];

const settle = async (work: Promise<unknown>): Promise<void> => {
  try {
    await work;
  } catch {
    // Reported by the marker staying unreconciled, not by throwing here.
  }
};

/** Locks the vault by removing every key fragment this device holds. */
function dropLocalKeyMaterial(): boolean {
  try {
    clearDeviceShare();
    sessionStorage.removeItem(SOFT_LOCK_TS_KEY);
    return true;
  } catch {
    // sessionStorage can be unavailable; the MEK is dropped from memory by the
    // reload that follows regardless.
    return false;
  }
}

/**
 * Encrypted drafts are ciphertext under the old working key, so they can never
 * be opened again — this is exactly the loss the wizard made the user
 * acknowledge. Plaintext Note drafts are untouched: nothing about them changed.
 */
function dropEncryptedDrafts(): boolean {
  try {
    // Check access explicitly; loadDrafts tolerates unavailable storage.
    void localStorage.length;
    for (const draft of loadDrafts()) {
      if (draft.enc !== undefined) clearDraft(draft);
    }
    return !loadDrafts().some((draft) => draft.enc !== undefined);
  } catch {
    // A malformed draft store is diagnosed in the wizard, not silently wiped.
    return false;
  }
}

async function purgeHttpCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => GENERATION_SCOPED_CACHES.some((scoped) => name.includes(scoped)))
      .map((name) => caches.delete(name)),
  );
}

export type ReconcileOptions = {
  userId: string;
  generation: number;
  /** Skip the Authenticator wipe when the caller re-enrolls it itself, which
   * is what the initiating device does at the end of the wizard. */
  keepAuthenticator?: boolean;
};

/**
 * Purge everything bound to the superseded generation, then record that this
 * device is caught up. Returns false when a step failed, which leaves the
 * marker unreconciled so the next launch retries.
 */
export async function reconcileToGeneration({
  userId,
  generation,
  keepAuthenticator = false,
}: ReconcileOptions): Promise<boolean> {
  if (!userId) return false;
  let ok = true;
  const step = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch {
      ok = false;
    }
  };

  if (!dropLocalKeyMaterial()) ok = false;
  if (!dropEncryptedDrafts()) ok = false;

  // Removing only the IndexedDB snapshot leaves cached ciphertext available
  // during the next mount's background refetch. Cancel first so a pending query
  // cannot restore it, then remove it rather than merely marking it stale.
  const queryClient = getQueryClient();
  await step(queryClient.cancelQueries());
  queryClient.clear();

  await step(clearStoredMaterial(userId));

  if (!keepAuthenticator) {
    // Remove first, announce second: a tab told to disarm before the database
    // is gone could re-read the vault it was just told to forget.
    await step(removeVault(userId));
    try {
      announceVaultRemoval(userId);
    } catch {
      ok = false;
    }
  }

  // The persisted query cache holds whole decrypted list pages under a key with
  // no account or generation in it, so it is dropped wholesale rather than
  // filtered.
  await step(queryCacheStorage.removeItem('signote-query-cache'));
  await step(purgeHttpCaches());

  if (ok) completeReconciliation(userId, generation);
  return ok;
}

/** Best-effort variant for callers that only want the caches gone. */
export const purgeGenerationCaches = () => settle(purgeHttpCaches());
