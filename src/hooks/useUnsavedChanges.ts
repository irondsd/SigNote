'use client';

import { useCallback, useRef, useState } from 'react';

export function useUnsavedChanges(isDirty: boolean) {
  const [showConfirm, setShowConfirm] = useState(false);
  const pendingCloseRef = useRef<(() => void) | null>(null);

  const confirmClose = useCallback(
    (actualClose: () => void) => {
      if (isDirty) {
        pendingCloseRef.current = actualClose;
        setShowConfirm(true);
      } else {
        actualClose();
      }
    },
    [isDirty],
  );

  const onConfirmDiscard = useCallback(() => {
    setShowConfirm(false);
    pendingCloseRef.current?.();
    pendingCloseRef.current = null;
  }, []);

  const onCancelClose = useCallback(() => {
    setShowConfirm(false);
    pendingCloseRef.current = null;
  }, []);

  return { showConfirm, confirmClose, onConfirmDiscard, onCancelClose };
}
