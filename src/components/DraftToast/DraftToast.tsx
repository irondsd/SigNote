'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import {
  recoverableDrafts,
  loadDrafts,
  saveDraft,
  clearDraft,
  DRAFT_RECOVERY_EVENT,
  type StoredDraft,
} from '@/lib/draft';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';

export function DraftToast() {
  const router = useRouter();
  const pathname = usePathname();
  const { setDraftRestore } = useDraftRestore();

  useEffect(() => {
    const shown = new Set<string>();
    const show = (draft: StoredDraft) => {
      const id = `draft-${draft.draftId ?? 'legacy'}`;
      shown.add(id);
      const label = draft.sourceId ? `unsaved changes to a ${draft.type}` : `an unsaved ${draft.type} draft`;
      toast(`You have ${label}`, {
        id,
        description: `"${draft.title.trim() || 'Untitled'}"${draft.sourceId ? ' — recover as a new copy.' : ''}`,
        duration: Infinity,
        action: {
          label: 'Continue',
          onClick: () => {
            toast.dismiss(id);
            // The recovery copy stays durable until the recovered form saves.
            const latest = loadDrafts().find((entry) => entry.draftId === draft.draftId) ?? draft;
            const restored = { ...latest, draftId: draft.draftId ?? crypto.randomUUID() };
            saveDraft(restored);
            if (!draft.draftId) clearDraft(draft);
            setDraftRestore(restored);
            const targetPath = draft.type === 'note' ? '/' : `/${draft.type}s`;
            if (pathname !== targetPath) router.push(targetPath);
          },
        },
        cancel: { label: 'Dismiss', onClick: () => clearDraft(draft) },
      });
    };
    const recover = () => {
      const existing = new Set(loadDrafts().map((draft) => `draft-${draft.draftId ?? 'legacy'}`));
      shown.forEach((id) => {
        if (!existing.has(id)) {
          toast.dismiss(id);
          shown.delete(id);
        }
      });
      recoverableDrafts().forEach(show);
    };
    const onFailure = (event: Event) => {
      const draft = (event as CustomEvent<StoredDraft | undefined>).detail;
      if (draft) show(draft);
      else recover();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') recover();
    };
    const timer = setTimeout(recover, 0);
    window.addEventListener(DRAFT_RECOVERY_EVENT, onFailure);
    window.addEventListener('pageshow', recover);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(DRAFT_RECOVERY_EVENT, onFailure);
      window.removeEventListener('pageshow', recover);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname, router, setDraftRestore]);

  return null;
}
