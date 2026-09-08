'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deriveDraftKey, encryptDraftContent } from '@/lib/crypto';
import {
  clearDraft,
  saveDraft,
  saveWithRecovery,
  setDraftActive,
  type DraftContent,
  type DraftData,
  type StoredDraft,
} from '@/lib/draft';
import type { EncryptedPayload } from '@/types/crypto';

/** One durable slot per editor, with synchronous flushes before saves/backgrounding. */
export function useDraftRecovery(
  type: DraftData['type'],
  content: DraftContent,
  dirty: boolean,
  /**
   * Required for Secrets and Seals, whose checkpoints are encrypted. Read once,
   * as soon as it is non-null — see `keyRef`.
   */
  mek?: CryptoKey | null,
) {
  const [draftId] = useState(() => content.draftId ?? crypto.randomUUID());
  const latest = useRef({ type, content, dirty });
  useLayoutEffect(() => {
    latest.current = { type, content, dirty };
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef<DraftData | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);

  const encrypted = type !== 'note';

  // Derived once, then held for the editor's lifetime. This is what makes an
  // auto-lock survivable: the MEK can vanish mid-edit — a hidden tab soft-locks,
  // five idle minutes hard-lock — and checkpoints keep working, because after
  // this the editor never needs the MEK again to write one.
  const keyRef = useRef<CryptoKey | null>(null);
  useEffect(() => {
    if (!encrypted || keyRef.current || !mek) return;
    let live = true;
    void deriveDraftKey(mek).then((key) => {
      if (live) keyRef.current = key;
    });
    return () => {
      live = false;
    };
  }, [encrypted, mek]);

  /**
   * The effect above is what guarantees a key exists *before* a lock; this
   * covers the moments before it has settled — a save in the first few
   * milliseconds of an editor's life. It derives only while the MEK is still
   * offered: the MEK itself is never captured, or a lock would not be a lock.
   */
  const draftKey = useCallback(async (): Promise<CryptoKey | null> => {
    if (keyRef.current) return keyRef.current;
    if (!mek) return null;
    const key = await deriveDraftKey(mek);
    keyRef.current = key;
    return key;
  }, [mek]);

  /** The last content we encrypted, and its ciphertext. */
  const cipher = useRef<{ content: string; enc: EncryptedPayload } | null>(null);
  // Bumped whenever the slot is deliberately emptied, so an encryption still in
  // flight cannot resurrect a draft that was discarded or successfully saved.
  const generation = useRef(0);

  const snapshot = useCallback(
    (): DraftData => ({
      ...latest.current.content,
      type: latest.current.type,
      draftId,
      savedAt: Date.now(),
    }),
    [draftId],
  );

  const envelope = useCallback((draft: DraftData, enc: EncryptedPayload): StoredDraft => {
    const rest: StoredDraft = { ...draft, enc };
    delete rest.content;
    return rest;
  }, []);

  /** What this draft should look like on disk. Null when no key has arrived. */
  const checkpoint = useCallback(
    async (draft: DraftData): Promise<StoredDraft | null> => {
      if (!encrypted) return draft;
      const key = await draftKey();
      if (!key) return null;
      const enc = await encryptDraftContent(key, draft.content);
      cipher.current = { content: draft.content, enc };
      return envelope(draft, enc);
    },
    [draftKey, encrypted, envelope],
  );

  const stopTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /**
   * Writes what can be written *now*, then upgrades it if the page survives.
   *
   * `pagehide` cannot await Web Crypto, so the synchronous write reuses the
   * ciphertext from the last checkpoint — the keystrokes since then are the
   * cost of encrypting at all. Everywhere else the page is still alive (a modal
   * closing, a tab switch), the async pass lands a moment later and nothing is
   * lost.
   */
  const flush = useCallback(() => {
    stopTimer();
    const previous = submitted.current;
    const current = snapshot();
    if (!latest.current.dirty) return;
    if (previous && current.title === previous.title && current.content === previous.content) return;

    if (!encrypted) {
      saveDraft(current);
      return;
    }
    const ready = cipher.current;
    if (ready) saveDraft(envelope(current, ready.enc));

    const era = generation.current;
    void checkpoint(current)
      .then((fresh) => {
        if (fresh && era === generation.current) saveDraft(fresh);
      })
      .catch(() => {});
  }, [checkpoint, encrypted, envelope, snapshot, stopTimer]);

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
    generation.current += 1;
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
      generation.current += 1;
      // Keep this promise detached from the modal's lifetime.
      // Notes stay on the synchronous path they have always used; only the
      // encrypted tiers pay a microtask to produce their ciphertext.
      void saveWithRecovery(draft, encrypted ? checkpoint(draft) : draft, request).then(
        () => {
          if (mounted.current && attempt === sequence.current) onSuccess?.();
        },
        () => {
          if (mounted.current && attempt === sequence.current) onError?.();
        },
      );
    },
    [checkpoint, encrypted, snapshot, stopTimer],
  );

  return useMemo(() => ({ save, discard, flush }), [save, discard, flush]);
}
