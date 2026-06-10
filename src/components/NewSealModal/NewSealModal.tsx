'use client';

import { useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useTagCountBump } from '@/hooks/useTagMutations';
import { useSimpleEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { encryptSealBody } from '@/lib/crypto';
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

type NewSealModalProps = {
  onClose: () => void;
  initialContent?: { title: string; content: string };
  onSaveError?: (vars: { title: string; content: string }) => void;
};

export function NewSealModal({ onClose, initialContent, onSaveError }: NewSealModalProps) {
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
  } = useNewNoteState('seal', onClose, initialContent);

  const createSeal = useCreateSeal({
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
        clearDraft();
        pendingRecoveryRef.current = { title: trimmedTitle, content: trimmedContent };
        const fileIds = extractFileIds(trimmedContent);
        createSeal.mutate({
          title: trimmedTitle,
          color,
          pattern,
          fileIds,
          tags,
          encryptBody: async (sealId: string) => {
            if (!trimmedContent) return null;
            return encryptSealBody(mek, trimmedContent, sealId);
          },
        });
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
              data-testid="save-seal-btn"
              size="sm"
              onClick={handleSave}
              disabled={(isTitleEmpty && isContentEmpty) || saving || isUploading}
            >
              <Check size={14} />
              {saving ? 'Saving…' : 'Save Seal'}
            </Button>
          </>
        }
      >
        <FileEncryptionProvider mek={mek}>
          <TiptapEditor
            content={content}
            onChange={setContent}
            editable={true}
            placeholder="Write your seal…"
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
