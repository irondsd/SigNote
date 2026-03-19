'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSealBody, encryptSecretBody, decryptSecretBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { NewModal } from '@/components/NewModal/NewModal';
import { saveDraft, clearDraft, isDraftRestorePending, consumeDraftRestore } from '@/lib/draft';
import styles from '@/components/NewModal/NewModal.module.scss';

type NewSealModalProps = {
  onClose: () => void;
};

export function NewSealModal({ onClose }: NewSealModalProps) {
  const { mek } = useEncryption();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoringDraft, setRestoringDraft] = useState(isDraftRestorePending);
  const createSeal = useCreateSeal();
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTitleEmpty = !title.trim();
  const isContentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';

  useEffect(() => {
    if (!restoringDraft || !mek) return;
    const draft = consumeDraftRestore();
    if (!draft || draft.type !== 'seal') {
      setRestoringDraft(false);
      return;
    }
    setTitle(draft.title);
    decryptSecretBody(mek, JSON.parse(draft.content)).then((decrypted) => {
      setContent(decrypted);
      setRestoringDraft(false);
    });
  }, [mek, restoringDraft]);

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (isContentEmpty || !mek) return;

    draftTimerRef.current = setTimeout(async () => {
      // Use encryptSecretBody for drafts — no sealId needed at this stage
      const payload = await encryptSecretBody(mek, content);
      saveDraft({
        type: 'seal',
        title,
        content: JSON.stringify(payload),
        encrypted: true,
        savedAt: Date.now(),
      });
    }, 500);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, isContentEmpty, mek]);

  const handleSave = async () => {
    if (!mek) return;
    if (isTitleEmpty && isContentEmpty) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setSaving(true);
    try {
      clearDraft();
      createSeal.mutate({
        title: title.trim(),
        encryptBody: async (sealId: string) => {
          if (!content.trim()) return null;
          return encryptSealBody(mek, content.trim(), sealId);
        },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClose = () => {
    const contentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';
    if (contentEmpty) onClose();
  };

  return (
    <NewModal
      heading="New Seal"
      onClose={onClose}
      onBackdropClose={handleBackdropClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} />
            Cancel
          </Button>
          <Button
            data-testid="save-seal-btn"
            size="sm"
            onClick={handleSave}
            disabled={(isTitleEmpty && isContentEmpty) || saving || !mek}
          >
            <Check size={14} />
            {saving ? 'Saving…' : 'Save Seal'}
          </Button>
        </>
      }
    >
      <input
        data-testid="note-title-input"
        className={styles.titleInput}
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      {!restoringDraft && (
        <TiptapEditor content={content} onChange={setContent} editable={true} placeholder="Write your seal…" />
      )}
    </NewModal>
  );
}
