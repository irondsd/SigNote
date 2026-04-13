'use client';

import { useState } from 'react';
import { Type } from 'lucide-react';
import { toast } from 'sonner';
import type { Editor } from '@tiptap/core';
import type { NoteDocument } from '@/models/Note';
import { useDeleteNote, useUndeleteNote, useUpdateNote, type CachedNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar } from '@/components/TiptapEditor/FormattingToolbar';
import { Button } from '@/components/ui/button';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';
import { cn } from '@/utils/cn';
import s from '@/components/SharedNoteModal/SharedNoteModal.module.scss';

type NoteModalProps = {
  note: NoteDocument;
  onClose: () => void;
  cardRect?: DOMRect;
};

export function NoteModal({ note, onClose, cardRect }: NoteModalProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(note.content ?? '');
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | Date>(note.updatedAt);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);

  const isDirty = editing && (title !== (note.title ?? '') || content !== (note.content ?? ''));
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);

  const handleClose = () => confirmClose(onClose);

  const deleteNote = useDeleteNote();
  const undeleteNote = useUndeleteNote();
  const updateNote = useUpdateNote();

  const handleDelete = () => {
    deleteNote.mutate(note._id.toString());
    onClose();
    toast.success('Note deleted', {
      description: 'You can undo this action.',
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          undeleteNote.mutate({ id: note._id.toString(), note: note as unknown as CachedNote });
          toast.success('Note restored');
        },
      },
    });
  };

  const handleSave = () => {
    if (title.length > MAX_TITLE) {
      toast.error('Title is too long');
      return;
    }
    if (content.length > MAX_CONTENT) {
      toast.error('Content is too large to save');
      return;
    }
    updateNote.mutate({ id: note._id.toString(), title, content }, { onError: () => setEditing(true) });
    setUpdatedAt(new Date().toISOString());
    setEditing(false);
  };

  const handleArchiveToggle = () => {
    const nextArchivedState = !isArchived;
    setIsArchived(nextArchivedState);
    updateNote.mutate({ id: note._id.toString(), archived: nextArchivedState });
  };

  const handleColorChange = (newColor: string | null) => {
    setColor(newColor);
    updateNote.mutate({ id: note._id.toString(), color: newColor });
    setColorPickerOpen(false);
  };

  return (
    <>
      <SharedNoteModal
        cardRect={cardRect}
        title={title}
        editing={editing}
        onTitleChange={setTitle}
        color={color}
        onColorChange={handleColorChange}
        colorPickerOpen={colorPickerOpen}
        onColorPickerOpenChange={setColorPickerOpen}
        onEditToggle={() => setEditing(!editing)}
        onClose={handleClose}
        disableClose={editing}
        updatedAt={updatedAt}
        createdAt={note.createdAt}
        onSave={handleSave}
        isArchived={isArchived}
        onArchive={handleArchiveToggle}
        onDelete={handleDelete}
        toolbar={<FormattingToolbar editor={editor} isOpen={showFormatBar} />}
        formatToggle={
          <Button
            variant="ghost"
            size="icon-sm"
            title="Formatting options"
            onClick={() => setShowFormatBar((v) => !v)}
            className={cn(showFormatBar && s.formatActive)}
          >
            <Type size={15} />
          </Button>
        }
      >
        <TiptapEditor
          content={content}
          onChange={(html) => {
            setContent(html);
            if (!editing) {
              updateNote.mutate({ id: note._id.toString(), content: html });
            }
          }}
          editable={editing}
          placeholder="Write your note..."
          onEditorReady={setEditor}
        />
      </SharedNoteModal>

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
