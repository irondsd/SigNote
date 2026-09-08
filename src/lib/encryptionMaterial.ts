import { trpcClient } from '@/lib/trpcClient';
import { resolveMaterial, type MaterialCachePolicy, type StoredMaterial } from '@/lib/encryptionMaterialStore';

/**
 * The one call that fetches unlock material, bound to the storage policy.
 *
 * Its own module because both `EncryptionContext` and the Security preference
 * hook need it and the context imports that hook — and because keeping the
 * store itself free of the tRPC client leaves it testable against nothing but
 * a fake IndexedDB.
 */
export const fetchEncryptionMaterial = (policy: MaterialCachePolicy): Promise<StoredMaterial> =>
  resolveMaterial(async () => (await trpcClient.encryption.material.query()) as unknown as StoredMaterial, policy);
