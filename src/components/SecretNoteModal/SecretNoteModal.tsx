'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Editor } from '@tiptap/core';
import { useDeleteSecret, useUndeleteSecret, useUpdateSecret, type CachedSecretNote } from '@/hooks/useSecretMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar, FormatToggleButton } from '@/components/TiptapEditor/FormattingToolbar';
import { Button } from '@/components/ui/button';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { encryptSecretBody } from '@/lib/crypto';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';

type SecretNoteModalProps = {
  note: CachedSecretNote;
  decryptedContent: string;
  onClose: () => void;
};

export function SecretNoteModal({ note, decryptedContent, onClose }: SecretNoteModalProps) {
  const guard = useEncryptionGuard();
  const { mek, lockType, lockSerial, rehydrate: ctxRehydrate } = useEncryption();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(decryptedContent);
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | Date>(note.updatedAt);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Tracks the last saved content baseline so checkbox auto-saves don't make isDirty true
  const savedContentRef = useRef(decryptedContent);
  const pendingActionRef = useRef<'save' | null>(null);
  const mountLockSerialRef = useRef(lockSerial);

  const isDirty = editing && (title !== (note.title ?? '') || content !== savedContentRef.current);
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);
  const handleClose = () => confirmClose(onClose);

  // Hard lock event: close modal if not editing.
  // Uses lockSerial snapshotted at mount — safe to open modals while already locked.
  useEffect(() => {
    if (lockSerial > mountLockSerialRef.current && !editing) {
      onClose();
    }
  }, [lockSerial, editing, onClose]);

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

  const performSave = useCallback(
    async (currentMek: CryptoKey) => {
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
        updateSecret.mutate({ id: note._id, title, encryptedBody }, { onError: () => setEditing(true) });
        setUpdatedAt(new Date().toISOString());
        setEditing(false);
      } finally {
        setSaving(false);
      }
    },
    [note._id, title, content, updateSecret],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      if (lockType === 'soft') {
        // Soft lock: try rehydrate directly, then save
        pendingActionRef.current = 'save';
        try {
          await ctxRehydrate();
          // On success, mek is restored; useEffect below will perform save
        } catch {
          // On failure, fall back to passphrase modal
          pendingActionRef.current = null;
          await guard.execute(async (mek) => {
            await performSave(mek);
          });
        }
      } else {
        // Hard lock or unlocked: just save
        await guard.execute(async (mek) => {
          await performSave(mek);
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTitle(note.title ?? '');
    setContent(savedContentRef.current);
    setEditing(false);
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

  // Execute pending save action after mek becomes available (rehydrate or passphrase unlock)
  useEffect(() => {
    const action = pendingActionRef.current;
    if (!action || !mek) return;

    (async () => {
      if (action === 'save') {
        await performSave(mek);
      }
      pendingActionRef.current = null;
    })();
  }, [mek, performSave]);

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
        updatedAt={updatedAt}
        createdAt={note.createdAt}
        onSave={handleSave}
        onCancel={handleCancel}
        saving={saving}
        isArchived={isArchived}
        onArchive={handleArchiveToggle}
        onDelete={handleDelete}
        toolbar={<FormattingToolbar editor={editor} isOpen={showFormatBar} />}
        formatToggle={<FormatToggleButton isActive={showFormatBar} onToggle={() => setShowFormatBar((v) => !v)} />}
      >
        <TiptapEditor
          key={editing ? 'editing' : 'viewing'}
          content={content}
          onChange={async (html) => {
            setContent(html);
            if (!editing && guard.isMekAvailable) {
              try {
                await guard.execute(async (mek) => {
                  const encryptedBody = html.trim() ? await encryptSecretBody(mek, html) : null;
                  updateSecret.mutate({ id: note._id, encryptedBody });
                });
              } catch {
                // Silently fail on auto-save encryption
              }
            }
          }}
          editable={editing}
          placeholder="Write your secret…"
          onEditorReady={setEditor}
        />
      </SharedNoteModal>

      {guard.PassphraseGuard}

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
