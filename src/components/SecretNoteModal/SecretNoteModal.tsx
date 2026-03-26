'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Archive, Check, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteSecret, useUndeleteSecret, useUpdateSecret, type CachedSecretNote } from '@/hooks/useSecretMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';

type SecretNoteModalProps = {
  note: CachedSecretNote;
  decryptedContent: string;
  onClose: () => void;
};

export function SecretNoteModal({ note, decryptedContent, onClose }: SecretNoteModalProps) {
  const { mek, phase, lockType, rehydrate } = useEncryption();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(decryptedContent);
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  // Tracks the last saved content baseline so checkbox auto-saves don't make isDirty true
  const savedContentRef = useRef(decryptedContent);

  const isDirty = editing && (title !== (note.title ?? '') || content !== savedContentRef.current);
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);
  const handleClose = () => confirmClose(onClose);

  // Hard lock: close modal if not editing
  useEffect(() => {
    if (phase === 'locked' && lockType === 'hard' && !editing) {
      onClose();
    }
  }, [phase, lockType, editing, onClose]);

  // Complete pending save after passphrase unlock restores mek
  useEffect(() => {
    if (pendingSave && mek) {
      setPendingSave(false);
      performSave(mek);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mek, pendingSave]);

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

  const performSave = async (currentMek: CryptoKey) => {
    if (title.length > MAX_TITLE) {
      toast.error('Title is too long');
      return;
    }
    if (content.length > MAX_CONTENT) {
      toast.error('Content is too large to save');
      return;
    }
    setSaving(true);
    try {
      const encryptedBody = content.trim() ? await encryptSecretBody(currentMek, content) : null;
      updateSecret.mutate({ id: note._id, title, encryptedBody });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!mek) {
      if (lockType === 'soft') {
        setSaving(true);
        setPendingSave(true);
        try {
          await rehydrate();
          // pendingSave useEffect fires when mek is restored
        } catch {
          setSaving(false);
          setPendingSave(false);
          setShowPassphrase(true);
        }
        return;
      }
      // Hard lock: passphrase required
      setPendingSave(true);
      setShowPassphrase(true);
      return;
    }
    performSave(mek);
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
    <Button data-testid="save-btn" size="sm" onClick={handleSave} disabled={saving}>
      <Check size={15} />
      {saving ? 'Saving…' : 'Save'}
    </Button>
  ) : (
    <>
      <Button
        data-testid="archive-btn"
        variant="outline"
        size="sm"
        onClick={handleArchiveToggle}
        title={isArchived ? 'Unarchive' : 'Archive'}
      >
        {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        {isArchived ? 'Unarchive' : 'Archive'}
      </Button>
      <Button data-testid="delete-btn" variant="destructive" size="sm" onClick={handleDelete}>
        <Trash2 size={15} />
        Delete
      </Button>
    </>
  );

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
        date={date}
        footerActions={footerActions}
      >
        <TiptapEditor
          content={content}
          onChange={async (html) => {
            setContent(html);
            if (!editing && mek) {
              const encryptedBody = html.trim() ? await encryptSecretBody(mek, html) : null;
              updateSecret.mutate({ id: note._id, encryptedBody });
            }
          }}
          editable={editing}
          placeholder="Write your secret…"
        />
      </SharedNoteModal>

      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => setShowPassphrase(false)}
          onClose={() => {
            setShowPassphrase(false);
            setPendingSave(false);
          }}
        />
      )}

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
