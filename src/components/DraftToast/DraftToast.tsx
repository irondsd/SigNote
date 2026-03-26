'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { loadDraft, clearDraft, type DraftData } from '@/lib/draft';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useDraftRestore } from '@/contexts/DraftRestoreContext';
import { decryptSecretBody } from '@/lib/crypto';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';

export function DraftToast() {
  const router = useRouter();
  const pathname = usePathname();
  const { mek, phase } = useEncryption();
  const { setDraftRestore } = useDraftRestore();
  const phaseRef = useRef(phase);
  const mekRef = useRef(mek);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    mekRef.current = mek;
  }, [mek]);

  const [showPassphrase, setShowPassphrase] = useState(false);
  const pendingDraftRef = useRef<DraftData | null>(null);

  const restoreAndNavigate = async (draft: DraftData, currentMek: CryptoKey | null) => {
    const targetPath = draft.type === 'note' ? '/' : `/${draft.type}s`;

    if (draft.type === 'note') {
      setDraftRestore({ title: draft.title, content: draft.content });
    } else {
      if (!currentMek) return;
      const decrypted = await decryptSecretBody(currentMek, JSON.parse(draft.content));
      setDraftRestore({ title: draft.title, content: decrypted });
    }

    if (pathname !== targetPath) {
      router.push(targetPath);
    }
  };

  // Complete restore after passphrase unlock provides mek
  useEffect(() => {
    if (pendingDraftRef.current && mek) {
      const draft = pendingDraftRef.current;
      pendingDraftRef.current = null;
      restoreAndNavigate(draft, mek);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mek]);

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;

    const displayTitle = draft.title.trim() || 'Untitled';
    const typeLabel = draft.type;

    // Defer so the Toaster has mounted and subscribed before we push the toast
    const timer = setTimeout(() => {
      toast(`You have an unsaved ${typeLabel} draft`, {
        description: `"${displayTitle}"`,
        duration: Infinity,
        action: {
          label: 'Continue',
          onClick: () => {
            toast.dismiss();
            if (draft.type === 'note' || phaseRef.current === 'unlocked') {
              restoreAndNavigate(draft, mekRef.current);
            } else {
              pendingDraftRef.current = draft;
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
  };

  if (!showPassphrase) return null;

  return (
    <PassphraseModal
      onSuccess={handleUnlockSuccess}
      onClose={() => {
        setShowPassphrase(false);
        pendingDraftRef.current = null;
      }}
    />
  );
}
