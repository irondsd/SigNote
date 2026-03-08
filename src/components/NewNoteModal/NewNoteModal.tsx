'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import styles from './NewNoteModal.module.scss';

type NewNoteModalProps = {
  onClose: () => void;
};

export function NewNoteModal({ onClose }: NewNoteModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const createNote = useCreateNote();

  const handleSave = () => {
    if (!title.trim() && !content.trim()) return;
    createNote.mutate({ title: title.trim(), content: content.trim() });
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>New Note</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <input
            className={styles.titleInput}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <TiptapEditor
            content={content}
            onChange={setContent}
            editable={true}
            placeholder="Write your note..."
          />
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            <X size={14} />
            Cancel
          </button>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!title.trim() && !content.trim()}
          >
            <Check size={14} />
            Save Note
          </button>
        </div>
      </div>
    </div>
  );
}
