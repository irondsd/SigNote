'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { NoteDocument } from '@/models/Note';
import { useDeleteNote, useUndeleteNote, useUpdateNote, type CachedNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';

type NoteModalProps = {
  note: NoteDocument;
  onClose: () => void;
};

export function NoteModal({ note, onClose }: NoteModalProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(note.content ?? '');
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

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
        updatedAt={note.updatedAt}
        createdAt={note.createdAt}
        onSave={handleSave}
        isArchived={isArchived}
        onArchive={handleArchiveToggle}
        onDelete={handleDelete}
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
        />
      </SharedNoteModal>

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
