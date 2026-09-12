'use client';

/**
 * Binds the framework-free wizard (`lib/rotation/wizard.ts`) to React.
 *
 * Everything interesting is in the controller; this supplies its dependencies
 * — the rotation transport, the ordinary clients for sessions and encryption
 * material, and a UUID source — and republishes its state through
 * `useSyncExternalStore` so the page re-renders when a step advances.
 *
 * It also owns what happens *after* activation on the device that performed it.
 * Everywhere else, an advanced generation means "purge and reload"; here the
 * device locks and clears its live and persisted caches before recording the
 * marker, and tells the other tabs — which is why this path deliberately keeps
 * the Authenticator's own decision separate: the vault key it holds was derived
 * from the old MEK and has to be re-enrolled, not silently kept.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { v7 as uuidv7 } from 'uuid';

import { rotationWorkerReady } from '@/lib/rotation/serviceWorker';
import { createRotationApi } from '@/lib/rotation/api';
import { createRotationWizard, RotationWizardError, type WizardState } from '@/lib/rotation/wizard';
import { trpcClient } from '@/lib/trpcClient';
import { announceGeneration, observeGeneration } from '@/lib/encryptionGeneration';
import { reconcileToGeneration } from '@/lib/encryptionReconcile';
import { useEncryption } from '@/contexts/EncryptionContext';

export type RotationWizard = ReturnType<typeof createRotationWizard>;

export function useRotationWizard(): { wizard: RotationWizard | null; state: WizardState | null } {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const { lock } = useEncryption();

  const wizard = useMemo(() => {
    if (!userId) return null;
    return createRotationWizard({
      userId,
      afterCommit: async (generation) => {
        // Changing persistent shares does not replace the MEK in React context.
        // Lock first, then drop both live and persisted old-generation queries.
        observeGeneration(userId, generation);
        lock();
        if (!(await reconcileToGeneration({ userId, generation }))) {
          throw new RotationWizardError(
            'Your keys were rotated, but this device could not finish refreshing its local data. Retry activation to finish cleanup; your rotation will not run twice.',
          );
        }
        announceGeneration(userId, generation);
      },
      prepareClient: async () => {
        if (!(await rotationWorkerReady())) {
          void navigator.serviceWorker
            .getRegistration()
            .then((registration) => registration?.update())
            .catch(() => undefined);
          throw new RotationWizardError(
            'An older offline app is still running. Close all SigNote tabs and reopen the app before rotating keys.',
          );
        }
      },
      // The rotation transport, not the app's batching client. See client.ts.
      rotation: createRotationApi(),
      sessions: {
        list: () => trpcClient.sessions.list.query(),
        revokeOthers: () => trpcClient.sessions.revokeOthers.mutate(),
      },
      // Always online: an offline copy of the material cannot be trusted to
      // describe the generation this rotation is about to replace.
      material: () => trpcClient.encryption.material.query() as never,
      profile: () => trpcClient.encryption.profile.query() as never,
      newOperationId: () => uuidv7(),
    });
  }, [userId, lock]);

  const subscribe = useCallback(
    (listener: () => void) => (wizard ? wizard.subscribe(listener) : () => undefined),
    [wizard],
  );
  const getSnapshot = useCallback(() => wizard?.getState() ?? null, [wizard]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => () => wizard?.dispose(), [wizard]);

  return { wizard, state };
}
