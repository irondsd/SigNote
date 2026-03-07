'use client';

import { useState } from 'react';
import { Trash2, Archive, X, Pencil, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { NoteDocument } from '@/models/Note';
import { useDeleteNote, useUndeleteNote, useUpdateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
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

  const handleDelete = () => {
    deleteNote.mutate(note._id.toString());
    onClose();
    toast.success('Note deleted', {
      description: 'You can undo this action.',
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          undeleteNote.mutate(note._id.toString());
          toast.success('Note restored');
        },
      },
    });
  };

  const handleSave = () => {
    updateNote.mutate({ id: note._id.toString(), title, content });
    setEditing(false);
  };

  const handleArchiveToggle = () => {
    const nextArchivedState = !isArchived;
    setIsArchived(nextArchivedState);
    updateNote.mutate({ id: note._id.toString(), archived: nextArchivedState });
  };

  const date = new Date(note.updatedAt).toLocaleString();

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
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.date}>Updated {date}</span>
          <div className={styles.actions}>
            {editing ? (
              <button
                className={`${styles.actionBtn} ${styles.save}`}
                onClick={handleSave}
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
                >
                  <Archive size={15} />
                  {isArchived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.delete}`}
                  onClick={handleDelete}
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
