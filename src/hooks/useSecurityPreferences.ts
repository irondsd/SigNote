import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

import { fetchEncryptionMaterial } from '@/lib/encryptionMaterial';
import { clearStoredMaterial } from '@/lib/encryptionMaterialStore';
import { trpcClient } from '@/lib/trpcClient';

export type SecurityPreferences = {
  cacheServerShare: boolean;
  blurAuthCodes: boolean;
};

export type SecurityPatch = Partial<SecurityPreferences>;

export const securityPreferencesKey = (userId: string | undefined) => ['security-preferences', userId];

export const useSecurityPreferences = () => {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useQuery({
    queryKey: securityPreferencesKey(userId),
    queryFn: async () => (await trpcClient.security.get.query()) as unknown as SecurityPreferences,
    enabled: userId !== undefined,
  });
};

/**
 * Optimistic: a switch that waits for a round trip before moving reads as
 * broken. The snapshot is restored on failure and the toast explains why the
 * switch flicked back.
 *
 * The `cacheServerShare` switch also carries out what it promises, in both
 * directions. Nothing else would: the stored share is otherwise written as a
 * side effect of unlocking, and this switch lives on `/profile`, outside the
 * vault layout that mounts `EncryptionProvider`. A user who turned it on here
 * and then went offline would find it had done nothing.
 *
 * The setting is account-wide, so a device that was never the one toggled
 * clears its own copy the next time `EncryptionProvider` reads these.
 */
export const useUpdateSecurityPreferences = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const key = securityPreferencesKey(userId);

  return useMutation({
    mutationFn: (patch: SecurityPatch) => trpcClient.security.set.mutate(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SecurityPreferences>(key);
      if (previous) queryClient.setQueryData<SecurityPreferences>(key, { ...previous, ...patch });
      if (patch.cacheServerShare === false && userId) void clearStoredMaterial(userId).catch(() => undefined);
      return { previous };
    },
    onSuccess: (_data, patch) => {
      // Fetch once so the share is there before the network goes away. Failure
      // is fine and expected for an account with no encryption profile —
      // `material` 404s, and there is nothing to store.
      if (patch.cacheServerShare === true && userId) {
        void fetchEncryptionMaterial({ userId, allowed: true }).catch(() => undefined);
      }
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error('Could not save that. Please try again.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
};
