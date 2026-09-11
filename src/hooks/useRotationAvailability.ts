'use client';

import { useQuery } from '@tanstack/react-query';

import { trpcClient } from '@/lib/trpcClient';

export type RotationAvailability = {
  generation: number;
  rotationInProgress: boolean;
  rotationAvailable: boolean;
};

/**
 * Whether the account may start a key rotation, and whether one is already
 * under way.
 *
 * The two are deliberately separate. Turning the feature off stops new
 * operations only — an operation already in flight keeps its status, resume and
 * cancel paths, because the alternative is an account frozen mid-rotation with
 * no way out. So the entry point is offered when the feature is available *or*
 * when there is something to go back to.
 */
export function useRotationAvailability() {
  return useQuery<RotationAvailability>({
    queryKey: ['encryption-generation'],
    queryFn: () => trpcClient.encryption.generation.query(),
    staleTime: 60_000,
  });
}
