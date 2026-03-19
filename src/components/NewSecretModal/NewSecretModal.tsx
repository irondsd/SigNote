'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSecretBody, decryptSecretBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { NewModal } from '@/components/NewModal/NewModal';
import { saveDraft, clearDraft, isDraftRestorePending, consumeDraftRestore } from '@/lib/draft';
import styles from '@/components/NewModal/NewModal.module.scss';

type NewSecretModalProps = {
  onClose: () => void;
};

export function NewSecretModal({ onClose }: NewSecretModalProps) {
  const { mek } = useEncryption();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoringDraft, setRestoringDraft] = useState(isDraftRestorePending);
  const createSecret = useCreateSecret();
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTitleEmpty = !title.trim();
  const isContentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';

  useEffect(() => {
    if (!restoringDraft || !mek) return;
    const draft = consumeDraftRestore();
    if (!draft || draft.type !== 'secret') {
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
      const payload = await encryptSecretBody(mek, content);
      saveDraft({
        type: 'secret',
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
      const encryptedBody = content.trim() ? await encryptSecretBody(mek, content.trim()) : null;
      clearDraft();
      createSecret.mutate({ title: title.trim(), encryptedBody });
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
      heading="New Secret"
      onClose={onClose}
      onBackdropClose={handleBackdropClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} />
            Cancel
          </Button>
          <Button
            data-testid="save-secret-btn"
            size="sm"
            onClick={handleSave}
            disabled={(isTitleEmpty && isContentEmpty) || saving || !mek}
          >
            <Check size={14} />
            {saving ? 'Saving…' : 'Save Secret'}
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
        <TiptapEditor content={content} onChange={setContent} editable={true} placeholder="Write your secret…" />
      )}
    </NewModal>
  );
}
