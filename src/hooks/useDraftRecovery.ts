'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  clearDraft,
  saveDraft,
  saveWithRecovery,
  setDraftActive,
  type DraftContent,
  type DraftData,
} from '@/lib/draft';

/** One durable slot per editor, with synchronous flushes before saves/backgrounding. */
export function useDraftRecovery(type: DraftData['type'], content: DraftContent, dirty: boolean) {
  const [draftId] = useState(() => content.draftId ?? crypto.randomUUID());
  const latest = useRef({ type, content, dirty });
  useLayoutEffect(() => {
    latest.current = { type, content, dirty };
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef<DraftData | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const snapshot = useCallback(
    (): DraftData => ({
      ...latest.current.content,
      type: latest.current.type,
      draftId,
      savedAt: Date.now(),
    }),
    [draftId],
  );
  const stopTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flush = useCallback(() => {
    stopTimer();
    const previous = submitted.current;
    const current = snapshot();
    if (latest.current.dirty && (!previous || current.title !== previous.title || current.content !== previous.content))
      saveDraft(current);
  }, [snapshot, stopTimer]);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      mounted.current = false;
      flush();
      setDraftActive(draftId, false);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [draftId, flush, stopTimer]);

  useEffect(() => {
    setDraftActive(draftId, dirty);
    stopTimer();
    if (dirty) timer.current = setTimeout(flush, 500);
    return stopTimer;
  }, [content.title, content.content, content.color, content.pattern, content.tags, dirty, draftId, flush, stopTimer]);

  const discard = useCallback(() => {
    stopTimer();
    clearDraft(draftId);
    latest.current = { ...latest.current, dirty: false };
    submitted.current = null;
  }, [draftId, stopTimer]);

  const save = useCallback(
    <T>(request: () => Promise<T>, onError?: () => void, onSuccess?: () => void, override?: Partial<DraftContent>) => {
      stopTimer();
      const draft = { ...snapshot(), ...override };
      submitted.current = draft;
      const attempt = ++sequence.current;
      // Keep this promise detached from the modal's lifetime.
      void saveWithRecovery(draft, request).then(
        () => {
          if (mounted.current && attempt === sequence.current) onSuccess?.();
        },
        () => {
          if (mounted.current && attempt === sequence.current) onError?.();
        },
      );
    },
    [snapshot, stopTimer],
  );

  return useMemo(() => ({ save, discard, flush }), [save, discard, flush]);
}
