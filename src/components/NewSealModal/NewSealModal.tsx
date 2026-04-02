'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { encryptSealBody, encryptSecretBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { NewModal } from '@/components/NewModal/NewModal';
import { saveDraft, clearDraft } from '@/lib/draft';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';
import { toast } from 'sonner';
import s from '@/components/NewModal/NewModal.module.scss';

type NewSealModalProps = {
  onClose: () => void;
  initialContent?: { title: string; content: string };
  onSaveError?: (vars: { title: string; content: string }) => void;
};

export function NewSealModal({ onClose, initialContent, onSaveError }: NewSealModalProps) {
  const guard = useSimpleEncryptionGuard();
  const [title, setTitle] = useState(initialContent?.title ?? '');
  const [content, setContent] = useState(initialContent?.content ?? '');
  const [saving, setSaving] = useState(false);
  const pendingRecoveryRef = useRef<{ title: string; content: string } | null>(null);
  const createSeal = useCreateSeal({
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
    if (isContentEmpty) return;

    draftTimerRef.current = setTimeout(async () => {
      try {
        await guard.execute(async (mek) => {
          // Use encryptSecretBody for drafts — no sealId needed at this stage
          const payload = await encryptSecretBody(mek, content);
          saveDraft({
            type: 'seal',
            title,
            content: JSON.stringify(payload),
            encrypted: true,
            savedAt: Date.now(),
          });
        });
      } catch {
        // Silently fail on draft save if no MEK
      }
    }, 500);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, isContentEmpty, guard]);

  const handleSave = async () => {
    if (title.length > MAX_TITLE) {
      toast.error('Title is too long');
      return;
    }
    if (content.length > MAX_CONTENT) {
      toast.error('Content is too large to save');
      return;
    }
    if (isTitleEmpty && isContentEmpty) return;

    try {
      setSaving(true);
      await guard.execute(async (mek) => {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        const trimmedTitle = title.trim();
        const trimmedContent = content.trim();
        clearDraft();
        pendingRecoveryRef.current = { title: trimmedTitle, content: trimmedContent };
        createSeal.mutate({
          title: trimmedTitle,
          encryptBody: async (sealId: string) => {
            if (!trimmedContent) return null;
            return encryptSealBody(mek, trimmedContent, sealId);
          },
        });
        onClose();
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <NewModal
        heading="New Seal"
        onClose={handleClose}
        onBackdropClose={handleClose}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={handleClose}>
              <X size={14} />
              Cancel
            </Button>
            <Button
              data-testid="save-seal-btn"
              size="sm"
              onClick={handleSave}
              disabled={(isTitleEmpty && isContentEmpty) || saving}
            >
              <Check size={14} />
              {saving ? 'Saving…' : 'Save Seal'}
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
        <TiptapEditor
          content={content}
          onChange={setContent}
          editable={true}
          placeholder="Write your seal…"
          autoFocus
        />
      </NewModal>

      {guard.PassphraseGuard}

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
