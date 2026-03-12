'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSealBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import styles from './NewSealModal.module.scss';

type NewSealModalProps = {
  onClose: () => void;
};

export function NewSealModal({ onClose }: NewSealModalProps) {
  const { mek } = useEncryption();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const createSeal = useCreateSeal();

  const handleSave = async () => {
    if (!mek) return;
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    try {
      createSeal.mutate({
        title: title.trim(),
        encryptBody: async (sealId: string) => {
          if (!content.trim()) return null;
          return encryptSealBody(mek, content.trim(), sealId);
        },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Backdrop onClose={onClose}>
      <Modal>
        <div className={styles.header}>
          <h2 className={styles.heading}>New Seal</h2>
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
            placeholder="Write your seal…"
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
            disabled={(!title.trim() && !content.trim()) || saving || !mek}
          >
            <Check size={14} />
            {saving ? 'Saving…' : 'Save Seal'}
          </button>
        </div>
      </Modal>
    </Backdrop>
  );
}
