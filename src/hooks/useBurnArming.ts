import { useEffect, useRef, useState } from 'react';

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
  // Freeze the "was burning when the modal opened" value for the hook's lifetime.
  // useState's initializer captures it once, and it's safe to read during render.
  const [wasInitiallyBurning] = useState(initialBurn);
  const armedRef = useRef(false);
  const onArmRef = useRef(onArm);

  // Keep the latest callback in a ref without making it an arming dependency.
  // Declared before the arming effect so the ref is fresh when that effect runs.
  useEffect(() => {
    onArmRef.current = onArm;
  }, [onArm]);

  useEffect(() => {
    if (armedRef.current) return;
    if (!wasInitiallyBurning) return;
    if (expiresAt) return;
    if (!isReady) return;
    armedRef.current = true;
    onArmRef.current();
  }, [expiresAt, isReady, wasInitiallyBurning]);

  return { wasInitiallyBurning };
}
