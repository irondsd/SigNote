import { useEffect, useRef } from 'react';

type UseBurnArmingArgs = {
  initialBurn: boolean;
  expiresAt: Date | string | null;
  isReady: boolean;
  onArm: () => void;
};

/**
 * Burn-after-reading "arm on open" logic shared by Note/Secret/Seal modals.
 *
 * Fires `onArm` exactly once, only if the note had `burnAfterReading` already
 * set when the modal opened (toggling it on in this session takes effect on
 * the *next* read). Gated by `isReady` so Seal modals can wait until decrypt.
 *
 * `onArm` should set `expiresAt = now` on the server; the list filter
 * (`expiresAt > now`) hides the doc immediately on next refetch, and the TTL
 * sweep handles physical deletion within the 1h grace — leaving room for
 * in-modal undo via PATCH `{ expiresAt: null, burnAfterReading: false }`.
 */
export function useBurnArming({ initialBurn, expiresAt, isReady, onArm }: UseBurnArmingArgs) {
  const initialBurnRef = useRef(initialBurn);
  const armedRef = useRef(false);
  const onArmRef = useRef(onArm);
  onArmRef.current = onArm;

  useEffect(() => {
    if (armedRef.current) return;
    if (!initialBurnRef.current) return;
    if (expiresAt) return;
    if (!isReady) return;
    armedRef.current = true;
    onArmRef.current();
  }, [expiresAt, isReady]);

  return { wasInitiallyBurning: initialBurnRef.current };
}
