'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSecret } from '@/hooks/useSecretMutations';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { NewModal } from '@/components/NewModal/NewModal';
import styles from '@/components/NewModal/NewModal.module.scss';

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

  const handleBackdropClose = () => {
    const contentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';
    if (contentEmpty) onClose();
  };

  return (
    <NewModal
      heading="New Secret"
      onClose={onClose}
      onBackdropClose={handleBackdropClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={(!title.trim() && !content.trim()) || saving || !mek}
          >
            <Check size={14} />
            {saving ? 'Saving…' : 'Save Secret'}
          </Button>
        </>
      }
    >
      <input
        className={styles.titleInput}
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <TiptapEditor content={content} onChange={setContent} editable={true} placeholder="Write your secret…" />
    </NewModal>
  );
}
