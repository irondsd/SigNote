import { trpcClient } from '@/lib/trpcClient';
import { resolveMaterial, type MaterialCachePolicy, type StoredMaterial } from '@/lib/encryptionMaterialStore';

export const UNLOCK_MATERIAL_PRELOAD_TTL_MS = 60_000;

export class EncryptionMaterialUnavailableError extends Error {
  constructor(readonly cause?: unknown) {
    super(
      "We couldn't load the encryption data needed to unlock your notes. Your passphrase wasn't checked. Check your connection and try again.",
    );
    this.name = 'EncryptionMaterialUnavailableError';
  }
}

/**
 * The one call that fetches unlock material, bound to the storage policy.
 *
 * Its own module because both `EncryptionContext` and the Security preference
 * hook need it and the context imports that hook — and because keeping the
 * store itself free of the tRPC client leaves it testable against nothing but
 * a fake IndexedDB.
 */
export async function fetchEncryptionMaterial(policy: MaterialCachePolicy): Promise<StoredMaterial> {
  try {
    return await resolveMaterial(
      async () => (await trpcClient.encryption.material.query()) as unknown as StoredMaterial,
      policy,
    );
  } catch (error) {
    throw new EncryptionMaterialUnavailableError(error);
  }
}

type PreparedMaterial = {
  userId: string;
  startedAt: number;
  request: Promise<StoredMaterial>;
};

/**
 * Keeps one short-lived material request in memory while an unlock prompt is
 * open. Nothing is added to TanStack Query, whose cache is persisted to IDB,
 * and the caller can discard the reference as soon as the prompt closes.
 */
export function createEncryptionMaterialPreloader(
  fetcher: (policy: MaterialCachePolicy) => Promise<StoredMaterial> = fetchEncryptionMaterial,
  ttlMs = UNLOCK_MATERIAL_PRELOAD_TTL_MS,
  now: () => number = Date.now,
) {
  let prepared: PreparedMaterial | null = null;

  const load = (policy: MaterialCachePolicy): Promise<StoredMaterial> => {
    const userId = policy.userId;
    if (!userId) return fetcher(policy);

    if (prepared && prepared.userId === userId && now() - prepared.startedAt < ttlMs) {
      return prepared.request;
    }

    const candidate: PreparedMaterial = {
      userId,
      startedAt: now(),
      request: fetcher(policy),
    };
    prepared = candidate;

    // A failed speculative request must not poison the later submit. Keeping a
    // rejection handler here also prevents a background preload from becoming
    // an unhandled promise rejection when the user closes the modal.
    void candidate.request.catch(() => {
      if (prepared === candidate) prepared = null;
    });

    return candidate.request;
  };

  return {
    load,
    preload(policy: MaterialCachePolicy): void {
      void load(policy).catch(() => undefined);
    },
    clear(): void {
      prepared = null;
    },
  };
}
