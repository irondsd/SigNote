'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import type { Editor } from '@tiptap/core';
import {
  useCreateSecret,
  useDeleteSecret,
  useUndeleteSecret,
  useUpdateSecret,
  type CachedSecretNote,
} from '@/hooks/useSecretMutations';
import { useVersions, type EncryptedVersion } from '@/hooks/useVersions';
import { useDecryptedVersions } from '@/hooks/useDecryptedVersions';
import { CURRENT_VERSION_ID, type DisplayVersion } from '@/components/VersionHistoryModal/VersionHistoryModal';
import { useBurnArming } from '@/hooks/useBurnArming';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar, FormatToggleButton } from '@/components/TiptapEditor/FormattingToolbar';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { useEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { decryptSecretBody, encryptSecretBody } from '@/lib/crypto';
import type { EncryptedPayload } from '@/types/crypto';
import { extractFileIds } from '@/lib/fileIds';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { NoteActionsMenu } from '@/components/NoteActionsMenu/NoteActionsMenu';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';

const VersionHistoryModal = dynamic(
  () => import('@/components/VersionHistoryModal/VersionHistoryModal').then((m) => m.VersionHistoryModal),
  { ssr: false },
);

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
  const [pattern, setPattern] = useState<string | null>(note.pattern ?? null);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | Date>(note.updatedAt);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pinned, setPinned] = useState<boolean>(note.pinned ?? false);
  const [expiresAt, setExpiresAt] = useState<Date | string | null>(note.expiresAt ?? null);
  const [burnAfterReading, setBurnAfterReading] = useState<boolean>(note.burnAfterReading ?? false);
  const [tags, setTags] = useState<string[]>(note.tags ?? []);
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
  const createSecret = useCreateSecret();

  const [historyOpen, setHistoryOpen] = useState(false);
  // Once history has been opened, returning to the note modal must not replay
  // the entrance animation — it's the same surface switching modes.
  const [historyWasOpen, setHistoryWasOpen] = useState(false);
  const [menuOpened, setMenuOpened] = useState(false);
  const versionsQuery = useVersions<EncryptedVersion>('secrets', note._id, { enabled: menuOpened || historyOpen });
  const decryptVersionBody = useCallback(
    (payload: EncryptedPayload) =>
      mek ? decryptSecretBody(mek, payload) : Promise.reject(new Error('Vault is locked')),
    [mek],
  );
  const versions = useDecryptedVersions(versionsQuery.data, mek ? decryptVersionBody : null);

  const openHistory = () => {
    void guard.execute(async () => {
      setHistoryOpen(true);
      setHistoryWasOpen(true);
    });
  };

  const handleRestored = (v: DisplayVersion) => {
    setTitle(v.title);
    setContent(v.content);
    savedContentRef.current = v.content;
    setUpdatedAt(new Date().toISOString());
  };

  const handleDuplicate = (v: { title: string; content: string }) => {
    void guard.execute(async (currentMek) => {
      const encryptedBody = v.content.trim() ? await encryptSecretBody(currentMek, v.content) : null;
      createSecret.mutate({ title: v.title, encryptedBody, color, pattern });
    });
  };

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
        const fileIds = extractFileIds(content);
        updateSecret.mutate({ id: note._id, title, encryptedBody, fileIds }, { onError: () => setEditing(true) });
        setUpdatedAt(new Date().toISOString());
        setEditing(false);
        setShowFormatBar(false);
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
  };

  const handlePatternChange = (newPattern: string | null) => {
    setPattern(newPattern);
    updateSecret.mutate({ id: note._id, pattern: newPattern });
  };

  const handleTagsChange = (ids: string[]) => {
    setTags(ids);
    updateSecret.mutate({ id: note._id, tags: ids });
  };

  const handleTogglePinned = (next: boolean) => {
    setPinned(next);
    updateSecret.mutate({ id: note._id, pinned: next });
  };

  const handleSetExpiry = (next: { expiresAt: Date | null; burnAfterReading: boolean }) => {
    setExpiresAt(next.expiresAt);
    setBurnAfterReading(next.burnAfterReading);
    updateSecret.mutate({
      id: note._id,
      expiresAt: next.expiresAt ? next.expiresAt.toISOString() : null,
      burnAfterReading: next.burnAfterReading,
    });
  };

  const { wasInitiallyBurning } = useBurnArming({
    initialBurn: note.burnAfterReading ?? false,
    expiresAt,
    isReady: true,
    onArm: () =>
      updateSecret.mutate({
        id: note._id,
        expiresAt: new Date().toISOString(),
        burnAfterReading: true,
      }),
  });

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

  if (historyOpen) {
    return (
      <>
        <VersionHistoryModal
          tier="secrets"
          noteId={note._id}
          color={color}
          pattern={pattern}
          current={{ _id: CURRENT_VERSION_ID, title, content, createdAt: updatedAt }}
          versions={versions}
          onClose={() => setHistoryOpen(false)}
          onRestored={handleRestored}
          onDuplicate={handleDuplicate}
        />
        {guard.PassphraseGuard}
      </>
    );
  }

  return (
    <>
      <SharedNoteModal
        animateIn={!historyWasOpen}
        title={title}
        editing={editing}
        onTitleChange={setTitle}
        color={color}
        pattern={pattern}
        onColorChange={handleColorChange}
        onPatternChange={handlePatternChange}
        tags={tags}
        onTagsChange={handleTagsChange}
        isDirty={isDirty}
        stylePickerOpen={stylePickerOpen}
        onStylePickerOpenChange={setStylePickerOpen}
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
        disableSave={isUploading}
        toolbar={<FormattingToolbar editor={editor} isOpen={showFormatBar} showFileUpload />}
        formatToggle={<FormatToggleButton isActive={showFormatBar} onToggle={() => setShowFormatBar((v) => !v)} />}
        pinned={pinned}
        onUnpin={() => handleTogglePinned(false)}
        expiresAt={expiresAt}
        burnAfterReading={wasInitiallyBurning && burnAfterReading}
        moreActions={
          <NoteActionsMenu
            pinned={pinned}
            onTogglePinned={handleTogglePinned}
            expiresAt={expiresAt}
            burnAfterReading={burnAfterReading}
            onSetExpiry={handleSetExpiry}
            onVersionHistory={openHistory}
            onOpenChange={(open) => open && setMenuOpened(true)}
          />
        }
      >
        <FileEncryptionProvider mek={mek}>
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
            allowFileUpload
            onUploadingChange={setIsUploading}
            fileEncryptionCtx={mek ? { mek } : undefined}
            requiresEncryption
          />
        </FileEncryptionProvider>
      </SharedNoteModal>

      {guard.PassphraseGuard}

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
