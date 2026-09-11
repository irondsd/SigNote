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
 * new keys are already in hand, so the device reconciles in place, records the
 * marker, and tells the other tabs — which is why this path deliberately keeps
 * the Authenticator's own decision separate: the vault key it holds was derived
 * from the old MEK and has to be re-enrolled, not silently kept.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { v7 as uuidv7 } from 'uuid';

import { createRotationApi } from '@/lib/rotation/api';
import { createRotationWizard, type WizardState } from '@/lib/rotation/wizard';
import { trpcClient } from '@/lib/trpcClient';
import { announceGeneration, observeGeneration } from '@/lib/encryptionGeneration';
import { reconcileToGeneration } from '@/lib/encryptionReconcile';

export type RotationWizard = ReturnType<typeof createRotationWizard>;

export function useRotationWizard(): { wizard: RotationWizard | null; state: WizardState | null } {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const reconciled = useRef(false);

  const wizard = useMemo(() => {
    if (!userId) return null;
    return createRotationWizard({
      userId,
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
  }, [userId]);

  const subscribe = useCallback(
    (listener: () => void) => (wizard ? wizard.subscribe(listener) : () => undefined),
    [wizard],
  );
  const getSnapshot = useCallback(() => wizard?.getState() ?? null, [wizard]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => () => wizard?.dispose(), [wizard]);

  // Post-commit reconciliation, once, on the device that activated the keys.
  useEffect(() => {
    if (!wizard || !userId || reconciled.current) return;
    const generation = state?.step === 'done' ? (state.operation?.targetGeneration ?? null) : null;
    if (generation === null) return;
    reconciled.current = true;
    void (async () => {
      // Record before purging: an interruption then leaves the marker dirty and
      // the next launch redoes the work, rather than rendering mixed-key data.
      observeGeneration(userId, generation);
      await reconcileToGeneration({ userId, generation });
      announceGeneration(userId, generation);
    })();
  }, [wizard, userId, state?.step, state?.operation?.targetGeneration]);

  return { wizard, state };
}
