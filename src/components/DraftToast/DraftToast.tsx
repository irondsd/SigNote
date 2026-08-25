'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { loadDraft, clearDraft } from '@/lib/draft';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';

export function DraftToast() {
  const router = useRouter();
  const pathname = usePathname();
  const { setDraftRestore } = useDraftRestore();

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;

    const displayTitle = draft.title.trim() || 'Untitled';

    // Defer so the Toaster has mounted and subscribed before we push the toast
    const timer = setTimeout(() => {
      const label = draft.sourceId ? `unsaved changes to a ${draft.type}` : `an unsaved ${draft.type} draft`;
      toast(`You have ${label}`, {
        description: `"${displayTitle}"`,
        duration: Infinity,
        action: {
          label: 'Continue',
          onClick: () => {
            toast.dismiss();
            clearDraft();
            setDraftRestore({ title: draft.title, content: draft.content });
            const targetPath = draft.type === 'note' ? '/' : `/${draft.type}s`;
            if (pathname !== targetPath) router.push(targetPath);
          },
        },
        cancel: {
          label: 'Dismiss',
          onClick: () => clearDraft(),
        },
      });
    }, 0);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
