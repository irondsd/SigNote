'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import styles from './NewSecretModal.module.scss';

type NewSecretModalProps = {
  onClose: () => void;
};

export function NewSecretModal({ onClose }: NewSecretModalProps) {
  const { mek } = useEncryption();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const createSecret = useCreateSecret();

  const handleSave = async () => {
    if (!mek) return;
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    try {
      const encryptedBody = content.trim() ? await encryptSecretBody(mek, content.trim()) : null;
      createSecret.mutate({ title: title.trim(), encryptedBody });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Backdrop onClose={onClose}>
      <Modal>
        <div className={styles.header}>
          <h2 className={styles.heading}>New Secret</h2>
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
            placeholder="Write your secret…"
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
            {saving ? 'Saving…' : 'Save Secret'}
          </button>
        </div>
      </Modal>
    </Backdrop>
  );
}
