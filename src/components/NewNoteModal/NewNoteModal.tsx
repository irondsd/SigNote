'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { NewModal } from '@/components/NewModal/NewModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { saveDraft, clearDraft, consumeDraftRestore } from '@/lib/draft';
import s from '@/components/NewModal/NewModal.module.scss';

type NewNoteModalProps = {
  onClose: () => void;
};

export function NewNoteModal({ onClose }: NewNoteModalProps) {
  const [initial] = useState(() => {
    const draft = consumeDraftRestore();
    if (draft?.type === 'note') return { title: draft.title, content: draft.content };
    return { title: '', content: '' };
  });
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const createNote = useCreateNote();
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTitleEmpty = !title.trim();
  const isContentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';
  const isDirty = !isTitleEmpty || !isContentEmpty;
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);
  const handleClose = () => confirmClose(onClose);

  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (isContentEmpty) return;

    draftTimerRef.current = setTimeout(() => {
      saveDraft({ type: 'note', title, content, encrypted: false, savedAt: Date.now() });
    }, 500);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, isContentEmpty]);

  const handleSave = () => {
    if (isTitleEmpty && isContentEmpty) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    clearDraft();
    createNote.mutate({ title: title.trim(), content: content.trim() });
    onClose();
  };

  return (
    <>
      <NewModal
        heading="New Note"
        onClose={handleClose}
        onBackdropClose={handleClose}
        footer={
          <>
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
        <TiptapEditor content={content} onChange={setContent} editable={true} placeholder="Write your note..." autoFocus />
      </NewModal>

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
