'use client';

import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useCreateSeal } from '@/hooks/useSealMutations';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSealBody } from '@/lib/crypto';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { NewModal } from '@/components/NewModal/NewModal';
import styles from '@/components/NewModal/NewModal.module.scss';

type NewSealModalProps = {
  onClose: () => void;
};

export function NewSealModal({ onClose }: NewSealModalProps) {
  const { mek } = useEncryption();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const createSeal = useCreateSeal();

  const isTitleEmpty = !title.trim();
  const isContentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';

  const handleSave = async () => {
    if (!mek) return;
    if (isTitleEmpty && isContentEmpty) return;
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

  const handleBackdropClose = () => {
    const contentEmpty = !content || content.replace(/<[^>]*>/g, '').trim() === '';
    if (contentEmpty) onClose();
  };

  return (
    <NewModal
      heading="New Seal"
      onClose={onClose}
      onBackdropClose={handleBackdropClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} />
            Cancel
          </Button>
          <Button
            data-testid="save-seal-btn"
            size="sm"
            onClick={handleSave}
            disabled={(isTitleEmpty && isContentEmpty) || saving || !mek}
          >
            <Check size={14} />
            {saving ? 'Saving…' : 'Save Seal'}
          </Button>
        </>
      }
    >
      <input
        data-testid="note-title-input"
        className={styles.titleInput}
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <TiptapEditor content={content} onChange={setContent} editable={true} placeholder="Write your seal…" />
    </NewModal>
  );
}
