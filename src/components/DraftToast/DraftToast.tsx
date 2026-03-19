'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { loadDraft, clearDraft, startDraftRestore } from '@/lib/draft';
import { useEncryption } from '@/contexts/EncryptionContext';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';

export function DraftToast() {
  const router = useRouter();
  const { phase } = useEncryption();
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const [showPassphrase, setShowPassphrase] = useState(false);
  const pendingNavRef = useRef<string | null>(null);

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;

    const displayTitle = draft.title.trim() || 'Untitled';
    const typeLabel = draft.type;
    const targetPath = draft.type === 'note' ? '/' : `/${draft.type}s`;

    // Defer so the Toaster has mounted and subscribed before we push the toast
    const timer = setTimeout(() => {
      toast(`You have an unsaved ${typeLabel} draft`, {
        description: `"${displayTitle}"`,
        duration: Infinity,
        action: {
          label: 'Continue',
          onClick: () => {
            toast.dismiss();
            startDraftRestore();
            if (draft.type === 'note' || phaseRef.current === 'unlocked') {
              router.push(`${targetPath}?draft=true`);
            } else {
              pendingNavRef.current = `${targetPath}?draft=true`;
              setShowPassphrase(true);
            }
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

  const handleUnlockSuccess = () => {
    setShowPassphrase(false);
    if (pendingNavRef.current) {
      router.push(pendingNavRef.current);
      pendingNavRef.current = null;
    }
  };

  if (!showPassphrase) return null;

  return (
    <PassphraseModal
      onSuccess={handleUnlockSuccess}
      onClose={() => {
        setShowPassphrase(false);
        pendingNavRef.current = null;
      }}
    />
  );
}
