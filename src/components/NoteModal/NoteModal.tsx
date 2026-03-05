'use client';

import { useState } from 'react';
import { Trash2, Archive, X, Pencil, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { NoteDocument } from '@/models/Note';
import { useDeleteNote, useUndeleteNote, useUpdateNote } from '@/hooks/useNoteMutations';
import styles from './NoteModal.module.scss';

type NoteModalProps = {
  note: NoteDocument;
  onClose: () => void;
};

export function NoteModal({ note, onClose }: NoteModalProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(note.content ?? '');
  const [isArchived, setIsArchived] = useState(note.archived);

  const deleteNote = useDeleteNote();
  const undeleteNote = useUndeleteNote();
  const updateNote = useUpdateNote();

  const handleDelete = async () => {
    await deleteNote.mutateAsync(note._id.toString());
    onClose();

    toast.success('Note deleted', {
      description: 'You can undo this action.',
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          undeleteNote.mutateAsync(note._id.toString());
          toast.success('Note restored');
        },
      },
    });
  };

  const handleSave = async () => {
    await updateNote.mutateAsync({ id: note._id.toString(), title, content });
    setEditing(false);
  };

  const handleArchiveToggle = async () => {
    const nextArchivedState = !isArchived;
    await updateNote.mutateAsync({ id: note._id.toString(), archived: nextArchivedState });
    setIsArchived(nextArchivedState);
  };

  const date = new Date(note.updatedAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          {editing ? (
            <input
              className={styles.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              autoFocus
            />
          ) : (
            <h2 className={styles.title}>{note.title || 'Untitled'}</h2>
          )}
          <div className={styles.headerActions}>
            <button className={styles.iconBtn} onClick={() => setEditing(!editing)} title="Edit">
              <Pencil size={16} />
            </button>
            <button className={styles.iconBtn} onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={styles.body}>
          {editing ? (
            <textarea
              className={styles.contentInput}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your note..."
              rows={12}
            />
          ) : (
            <p className={styles.content}>{note.content || <em className={styles.empty}>No content</em>}</p>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.date}>Updated {date}</span>
          <div className={styles.actions}>
            {editing ? (
              <button
                className={`${styles.actionBtn} ${styles.save}`}
                onClick={handleSave}
                disabled={updateNote.isPending}
              >
                <Check size={15} />
                Save
              </button>
            ) : (
              <>
                <button
                  className={`${styles.actionBtn} ${styles.archive}`}
                  onClick={handleArchiveToggle}
                  title={isArchived ? 'Unarchive' : 'Archive'}
                  disabled={updateNote.isPending}
                >
                  <Archive size={15} />
                  {isArchived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.delete}`}
                  onClick={handleDelete}
                  disabled={deleteNote.isPending}
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
