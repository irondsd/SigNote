'use client';

import { useState } from 'react';
import { Trash2, Archive, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteSecret, useUndeleteSecret, useUpdateSecret, type CachedSecretNote } from '@/hooks/useSecretMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';

type SecretNoteModalProps = {
  note: CachedSecretNote;
  decryptedContent: string;
  onClose: () => void;
};

export function SecretNoteModal({ note, decryptedContent, onClose }: SecretNoteModalProps) {
  const { mek } = useEncryption();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(decryptedContent);
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const deleteSecret = useDeleteSecret();
  const undeleteSecret = useUndeleteSecret();
  const updateSecret = useUpdateSecret();

  const handleDelete = () => {
    deleteSecret.mutate(note._id);
    onClose();
    toast.success('Secret deleted', {
      description: 'You can undo this action.',
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          undeleteSecret.mutate({ id: note._id, note });
          toast.success('Secret restored');
        },
      },
    });
  };

  const handleSave = async () => {
    if (!mek) return;
    setSaving(true);
    try {
      const encryptedBody = content.trim() ? await encryptSecretBody(mek, content) : null;
      updateSecret.mutate({ id: note._id, title, encryptedBody });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = () => {
    const next = !isArchived;
    setIsArchived(next);
    updateSecret.mutate({ id: note._id, archived: next });
  };

  const handleColorChange = (newColor: string | null) => {
    setColor(newColor);
    updateSecret.mutate({ id: note._id, color: newColor });
    setColorPickerOpen(false);
  };

  const date = new Date(note.updatedAt).toLocaleString();

  const footerActions = editing ? (
    <Button size="sm" onClick={handleSave} disabled={saving}>
      <Check size={15} />
      {saving ? 'Saving…' : 'Save'}
    </Button>
  ) : (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleArchiveToggle}
        title={isArchived ? 'Unarchive' : 'Archive'}
      >
        <Archive size={15} />
        {isArchived ? 'Unarchive' : 'Archive'}
      </Button>
      <Button variant="destructive" size="sm" onClick={handleDelete}>
        <Trash2 size={15} />
        Delete
      </Button>
    </>
  );

  return (
    <SharedNoteModal
      title={note.title ?? ''}
      editing={editing}
      onTitleChange={setTitle}
      color={color}
      onColorChange={handleColorChange}
      colorPickerOpen={colorPickerOpen}
      onColorPickerOpenChange={setColorPickerOpen}
      onEditToggle={() => setEditing(!editing)}
      onClose={onClose}
      disableClose={editing}
      date={date}
      footerActions={footerActions}
    >
      <TiptapEditor
        content={content}
        onChange={(html) => setContent(html)}
        editable={editing}
        placeholder="Write your secret…"
      />
    </SharedNoteModal>
  );
}
