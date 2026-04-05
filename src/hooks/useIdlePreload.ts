'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { buildTierPrefetchOptions } from './internal/useNoteTier';
import { SECRETS_CONFIG } from './useSecrets';
import { SEALS_CONFIG } from './useSeals';
import type { CachedSecretNote } from './useSecretMutations';
import type { CachedSealNote } from './useSealMutations';

function scheduleIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback !== 'undefined') {
    const id = requestIdleCallback(fn, { timeout: 5000 });
    return () => cancelIdleCallback(id);
  }
  // Safari fallback
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}

export function useIdlePreload(): void {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;

    return scheduleIdle(() => {
      queryClient.prefetchInfiniteQuery(buildTierPrefetchOptions<CachedSecretNote>(SECRETS_CONFIG, userId));
      queryClient.prefetchInfiniteQuery(buildTierPrefetchOptions<CachedSealNote>(SEALS_CONFIG, userId));
    });
  }, [userId, queryClient]);
}
