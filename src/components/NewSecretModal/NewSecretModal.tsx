'use client';

import { useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useTagCountBump } from '@/hooks/useTagMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { extractFileIds } from '@/lib/fileIds';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar, FormatToggleButton } from '@/components/TiptapEditor/FormattingToolbar';
import { Button } from '@/components/ui/button';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { NewModal } from '@/components/NewModal/NewModal';
import { clearDraft } from '@/lib/draft';
import { useNewNoteState } from '@/hooks/useNewNoteState';
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
  const { mek } = useEncryption();
  const [saving, setSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const bumpTagCounts = useTagCountBump();
  const pendingRecoveryRef = useRef<{ title: string; content: string } | null>(null);

  const {
    title,
    setTitle,
    content,
    setContent,
    showFormatBar,
    setShowFormatBar,
    editor,
    setEditor,
    color,
    setColor,
    pattern,
    setPattern,
    isTitleEmpty,
    isContentEmpty,
    isDirty,
    showConfirm,
    onCancelClose,
    handleClose,
    handleConfirmDiscard,
    draftTimerRef,
  } = useNewNoteState('secret', onClose, initialContent);

  const createSecret = useCreateSecret({
    onError: () => {
      if (pendingRecoveryRef.current) onSaveError?.(pendingRecoveryRef.current);
    },
  });

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
        const fileIds = extractFileIds(trimmedContent);
        createSecret.mutate({ title: trimmedTitle, encryptedBody, color, pattern, fileIds, tags });
        bumpTagCounts(tags, []);
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
        toolbar={<FormattingToolbar editor={editor} isOpen={showFormatBar} showFileUpload />}
        footerLeft={<FormatToggleButton isActive={showFormatBar} onToggle={() => setShowFormatBar((v) => !v)} />}
        onColorChange={setColor}
        onPatternChange={setPattern}
        onTagsChange={setTags}
        isDirty={isDirty}
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
              disabled={(isTitleEmpty && isContentEmpty) || saving || isUploading}
            >
              <Check size={14} />
              {saving ? 'Saving…' : 'Save Secret'}
            </Button>
          </>
        }
      >
        <FileEncryptionProvider mek={mek}>
          <TiptapEditor
            content={content}
            onChange={setContent}
            editable={true}
            placeholder="Write your secret…"
            onEditorReady={setEditor}
            allowFileUpload
            onUploadingChange={setIsUploading}
            fileEncryptionCtx={mek ? { mek } : undefined}
            requiresEncryption
          />
        </FileEncryptionProvider>
      </NewModal>

      {guard.PassphraseGuard}

      {showConfirm && <ConfirmDiscardDialog onDiscard={handleConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
