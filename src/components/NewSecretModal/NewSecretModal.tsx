'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { NewModal } from '@/components/NewModal/NewModal';
import { saveDraft, clearDraft } from '@/lib/draft';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';
import { toast } from 'sonner';
import s from '@/components/NewModal/NewModal.module.scss';

type NewSecretModalProps = {
  onClose: () => void;
  initialContent?: { title: string; content: string };
  onSaveError?: (vars: { title: string; content: string }) => void;
};

export function NewSecretModal({ onClose, initialContent, onSaveError }: NewSecretModalProps) {
  const { mek } = useEncryption();
  const [title, setTitle] = useState(initialContent?.title ?? '');
  const [content, setContent] = useState(initialContent?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const pendingRecoveryRef = useRef<{ title: string; content: string } | null>(null);
  const createSecret = useCreateSecret({
    onError: () => {
      if (pendingRecoveryRef.current) onSaveError?.(pendingRecoveryRef.current);
    },
  });
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTitleEmpty = !title.trim();
  const isContentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';
  const isDirty = !isTitleEmpty || !isContentEmpty;
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);
  const handleClose = () => confirmClose(onClose);

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

  // Complete pending save after passphrase unlock restores mek
  useEffect(() => {
    if (pendingSave && mek) {
      setPendingSave(false);
      performSave(mek);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mek, pendingSave]);

  const performSave = async (currentMek: CryptoKey) => {
    if (isTitleEmpty && isContentEmpty) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setSaving(true);
    try {
      const trimmedTitle = title.trim();
      const trimmedContent = content.trim();
      const encryptedBody = trimmedContent ? await encryptSecretBody(currentMek, trimmedContent) : null;
      clearDraft();
      pendingRecoveryRef.current = { title: trimmedTitle, content: trimmedContent };
      createSecret.mutate({ title: trimmedTitle, encryptedBody });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (title.length > MAX_TITLE) {
      toast.error('Title is too long');
      return;
    }
    if (content.length > MAX_CONTENT) {
      toast.error('Content is too large to save');
      return;
    }
    if (!mek) {
      setPendingSave(true);
      setShowPassphrase(true);
      return;
    }
    performSave(mek);
  };

  return (
    <>
      <NewModal
        heading="New Secret"
        onClose={handleClose}
        onBackdropClose={handleClose}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              <X size={14} />
              Cancel
            </Button>
            <Button
              data-testid="save-secret-btn"
              size="sm"
              onClick={handleSave}
              disabled={(isTitleEmpty && isContentEmpty) || saving}
            >
              <Check size={14} />
              {saving ? 'Saving…' : 'Save Secret'}
            </Button>
          </>
        }
      >
        <input
          data-testid="note-title-input"
          className={s.titleInput}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TiptapEditor content={content} onChange={setContent} editable={true} placeholder="Write your secret…" autoFocus />
      </NewModal>

      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => setShowPassphrase(false)}
          onClose={() => {
            setShowPassphrase(false);
            setPendingSave(false);
          }}
        />
      )}

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
