'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
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

  const handleBackdropClose = () => {
    const contentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';
    if (contentEmpty) onClose();
  };

  return (
    <Backdrop onClose={handleBackdropClose}>
      <Modal>
        <div className={styles.header}>
          <h2 className={styles.heading}>New Note</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>

        <div className={styles.body}>
          <input
            className={styles.titleInput}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <TiptapEditor content={content} onChange={setContent} editable={true} placeholder="Write your note..." />
        </div>

        <div className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!title.trim() && !content.trim()}>
            <Check size={14} />
            Save Note
          </Button>
        </div>
      </Modal>
    </Backdrop>
  );
}
