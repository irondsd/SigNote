'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check, Type } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { useCreateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar } from '@/components/TiptapEditor/FormattingToolbar';
import { Button } from '@/components/ui/button';
import { NewModal } from '@/components/NewModal/NewModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { saveDraft, clearDraft } from '@/lib/draft';
import s from '@/components/NewModal/NewModal.module.scss';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';

type NewNoteModalProps = {
  onClose: () => void;
  initialContent?: { title: string; content: string };
  onSaveError?: (vars: { title: string; content: string }) => void;
};

export function NewNoteModal({ onClose, initialContent, onSaveError }: NewNoteModalProps) {
  const [title, setTitle] = useState(initialContent?.title ?? '');
  const [content, setContent] = useState(initialContent?.content ?? '');
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const createNote = useCreateNote({ onError: onSaveError });
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
      saveDraft({ type: 'note', title, content, savedAt: Date.now() });
    }, 500);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, isContentEmpty]);

  const handleSave = () => {
    if (isTitleEmpty && isContentEmpty) return;
    if (title.length > MAX_TITLE) {
      toast.error('Title is too long');
      return;
    }
    if (content.length > MAX_CONTENT) {
      toast.error('Content is too large to save');
      return;
    }
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    clearDraft();
    createNote.mutate({ title: title.trim(), content: content.trim() });
    onClose();
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
        footer={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Formatting options"
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onTouchEnd={(e) => { e.preventDefault(); setShowFormatBar((v) => !v); }}
              onClick={() => setShowFormatBar((v) => !v)}
              className={cn(showFormatBar && s.formatActive)}
            >
              <Type size={15} />
            </Button>
            <div className={s.footerRight}>
              <Button variant="ghost" size="sm" onClick={handleClose}>
                <X size={14} />
                Cancel
              </Button>
              <Button
                data-testid="save-note-btn"
                size="sm"
                onClick={handleSave}
                disabled={isTitleEmpty && isContentEmpty}
              >
                <Check size={14} />
                Save Note
              </Button>
            </div>
          </>
        }
      >
        <TiptapEditor
          content={content}
          onChange={setContent}
          editable={true}
          placeholder="Write your note..."
          onEditorReady={setEditor}
        />
      </NewModal>

      {showConfirm && <ConfirmDiscardDialog onDiscard={handleConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
