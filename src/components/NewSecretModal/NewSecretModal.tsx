'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { encryptSecretBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar, FormatToggleButton } from '@/components/TiptapEditor/FormattingToolbar';
import { Button } from '@/components/ui/button';
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
  const guard = useSimpleEncryptionGuard();
  const [title, setTitle] = useState(initialContent?.title ?? '');
  const [content, setContent] = useState(initialContent?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [color, setColor] = useState<string | null>(null);
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
  const handleConfirmDiscard = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    clearDraft();
    onConfirmDiscard();
  };

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (isContentEmpty) return;

    draftTimerRef.current = setTimeout(() => {
      saveDraft({ type: 'secret', title, content, savedAt: Date.now() });
    }, 500);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, isContentEmpty]);

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
        const encryptedBody = trimmedContent ? await encryptSecretBody(mek, trimmedContent) : null;
        clearDraft();
        pendingRecoveryRef.current = { title: trimmedTitle, content: trimmedContent };
        createSecret.mutate({ title: trimmedTitle, encryptedBody, color });
        onClose();
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <NewModal
        heading={
          <input
            data-testid="note-title-input"
            className={s.heading}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        }
        onClose={handleClose}
        onBackdropClose={handleClose}
        toolbar={<FormattingToolbar editor={editor} isOpen={showFormatBar} />}
        footerLeft={<FormatToggleButton isActive={showFormatBar} onToggle={() => setShowFormatBar((v) => !v)} />}
        onColorChange={setColor}
        footerActions={
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
        <TiptapEditor
          content={content}
          onChange={setContent}
          editable={true}
          placeholder="Write your secret…"
          onEditorReady={setEditor}
        />
      </NewModal>

      {guard.PassphraseGuard}

      {showConfirm && <ConfirmDiscardDialog onDiscard={handleConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
