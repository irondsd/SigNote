'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { LockOpen, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { Editor } from '@tiptap/core';
import {
  useCreateSeal,
  useDeleteSeal,
  useUndeleteSeal,
  useUpdateSeal,
  type CachedSealNote,
} from '@/hooks/useSealMutations';
import { useVersions, type EncryptedVersion } from '@/hooks/useVersions';
import { useDecryptedVersions } from '@/hooks/useDecryptedVersions';
import { CURRENT_VERSION_ID, type DisplayVersion } from '@/components/VersionHistoryModal/VersionHistoryModal';
import { useBurnArming } from '@/hooks/useBurnArming';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { FormattingToolbar, FormatToggleButton } from '@/components/TiptapEditor/FormattingToolbar';
import { Button } from '@/components/ui/button';
import { EncryptedPlaceholder, estimateLines } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { useEncryption } from '@/contexts/EncryptionContext';
import { FileEncryptionProvider } from '@/contexts/FileEncryptionContext';
import { useEncryptionGuard } from '@/hooks/useEncryptionGuard';
import { decryptSealBody, encryptSealBody, encryptSealBodyWithExistingKey } from '@/lib/crypto';
import type { EncryptedPayload } from '@/types/crypto';
import { extractFileIds } from '@/lib/fileIds';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { NoteActionsMenu } from '@/components/NoteActionsMenu/NoteActionsMenu';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';
import { DecryptTimer } from './DecryptTimer';
import s from './SealNoteModal.module.scss';

const DECRYPT_FOR_SECONDS = 60;

const VersionHistoryModal = dynamic(
  () => import('@/components/VersionHistoryModal/VersionHistoryModal').then((m) => m.VersionHistoryModal),
  { ssr: false },
);

type SealNoteModalProps = {
  note: CachedSealNote;
  onClose: () => void;
};

export function SealNoteModal({ note, onClose }: SealNoteModalProps) {
  const { mek, phase, lockType, lockSerial, rehydrate: ctxRehydrate } = useEncryption();
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [pattern, setPattern] = useState<string | null>(note.pattern ?? null);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | Date>(note.updatedAt);
  const [decryptError, setDecryptError] = useState('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pinned, setPinned] = useState<boolean>(note.pinned ?? false);
  const [expiresAt, setExpiresAt] = useState<Date | string | null>(note.expiresAt ?? null);
  const [burnAfterReading, setBurnAfterReading] = useState<boolean>(note.burnAfterReading ?? false);
  const [tags, setTags] = useState<string[]>(note.tags ?? []);
  const totalTimeRef = useRef(DECRYPT_FOR_SECONDS);
  const originalDecryptedRef = useRef<string | null>(null);
  const pendingActionRef = useRef<'decrypt' | 'save' | null>(null);
  const mountLockSerialRef = useRef(lockSerial);

  const guard = useEncryptionGuard();

  const deleteSeal = useDeleteSeal();
  const undeleteSeal = useUndeleteSeal();
  const updateSeal = useUpdateSeal();
  const createSeal = useCreateSeal();

  const [historyOpen, setHistoryOpen] = useState(false);
  // Once history has been opened, returning to the note modal must not replay
  // the entrance animation — it's the same surface switching modes.
  const [historyWasOpen, setHistoryWasOpen] = useState(false);
  const [menuOpened, setMenuOpened] = useState(false);
  const versionsQuery = useVersions<EncryptedVersion>('seals', note._id, { enabled: menuOpened || historyOpen });
  const decryptVersionBody = useCallback(
    (payload: EncryptedPayload) =>
      mek && note.wrappedNoteKey
        ? decryptSealBody(mek, payload, note.wrappedNoteKey, note._id)
        : Promise.reject(new Error('Vault is locked')),
    [mek, note.wrappedNoteKey, note._id],
  );
  const versions = useDecryptedVersions(versionsQuery.data, mek ? decryptVersionBody : null);

  const isDecrypted = decryptedContent !== null;
  const isDirty =
    editing && (title !== (note.title ?? '') || (isDecrypted && decryptedContent !== originalDecryptedRef.current));
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);

  const performDecrypt = useCallback(
    async (currentMek: CryptoKey) => {
      if (!note.encryptedBody || !note.wrappedNoteKey) {
        setDecryptedContent('');
        return;
      }
      setDecrypting(true);
      setDecryptError('');
      try {
        const plaintext = await decryptSealBody(currentMek, note.encryptedBody, note.wrappedNoteKey, note._id);
        originalDecryptedRef.current = plaintext;
        setDecryptedContent(plaintext);
        totalTimeRef.current = DECRYPT_FOR_SECONDS;
        setTimeLeft(DECRYPT_FOR_SECONDS);
      } catch {
        setDecryptError('Failed to decrypt. The note may be corrupted.');
      } finally {
        setDecrypting(false);
      }
    },
    [note._id, note.encryptedBody, note.wrappedNoteKey],
  );

  const handleDecrypt = async () => {
    setDecrypting(true);
    try {
      if (lockType === 'soft') {
        // Soft lock: try rehydrate directly, then decrypt
        pendingActionRef.current = 'decrypt';
        try {
          await ctxRehydrate();
          // On success, mek is restored; useEffect below will perform decrypt
        } catch {
          // On failure, fall back to passphrase modal
          pendingActionRef.current = null;
          await guard.execute(async (mek) => {
            await performDecrypt(mek);
          });
        }
      } else {
        // Hard lock or unlocked: just decrypt
        await guard.execute(async (mek) => {
          await performDecrypt(mek);
        });
      }
    } finally {
      setDecrypting(false);
    }
  };

  const handleEncrypt = useCallback(() => {
    setDecryptedContent(null);
    setEditing(false);
    setHistoryOpen(false);
    setTimeLeft(null);
    totalTimeRef.current = DECRYPT_FOR_SECONDS;
  }, []);

  // History needs the head readable for the "Current" entry, so decrypt first.
  const openHistory = () => {
    void guard.execute(async (currentMek) => {
      if (decryptedContent === null) await performDecrypt(currentMek);
      setHistoryOpen(true);
      setHistoryWasOpen(true);
    });
  };

  const handleRestored = (v: DisplayVersion) => {
    setTitle(v.title);
    setDecryptedContent(v.content);
    originalDecryptedRef.current = v.content;
    setUpdatedAt(new Date().toISOString());
  };

  const handleDuplicate = (v: { title: string; content: string }) => {
    void guard.execute(async (currentMek) => {
      createSeal.mutate({
        title: v.title,
        color,
        pattern,
        encryptBody: async (sealId) => (v.content.trim() ? encryptSealBody(currentMek, v.content, sealId) : null),
      });
    });
  };

  // Hard lock event: close modal if not editing.
  // Uses lockSerial (increments on each lock() call) snapshotted at mount so that
  // modals opened *after* a hard lock don't immediately close themselves.
  useEffect(() => {
    if (lockSerial > mountLockSerialRef.current && !editing) {
      onClose();
    }
  }, [lockSerial, editing, onClose]);

  // Soft lock: re-encrypt decrypted content in view mode (keep modal open).
  useEffect(() => {
    if (phase === 'locked' && lockType === 'soft' && !editing && isDecrypted) {
      handleEncrypt();
    }
  }, [phase, lockType, editing, isDecrypted, handleEncrypt]);

  // Auto-encrypt countdown (paused while editing or reviewing history)
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0 || editing || historyOpen) return;
    const id = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          handleEncrypt();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timeLeft, editing, historyOpen, handleEncrypt]);

  const performSave = useCallback(
    async (currentMek: CryptoKey) => {
      if (decryptedContent === null) return;
      if (title.length > MAX_TITLE) {
        toast.error('Title is too long');
        return;
      }
      if (decryptedContent.length > MAX_CONTENT) {
        toast.error('Content is too large to save');
        return;
      }
      setSaving(true);
      try {
        let encryptedBody = note.encryptedBody;
        let wrappedNoteKey = note.wrappedNoteKey;

        if (decryptedContent.trim()) {
          // Reuse the existing NEK: version snapshots store ciphertext only and
          // are decrypted with the head's wrappedNoteKey, so it must not rotate.
          const encrypted = note.wrappedNoteKey
            ? await encryptSealBodyWithExistingKey(currentMek, decryptedContent, note._id, note.wrappedNoteKey)
            : await encryptSealBody(currentMek, decryptedContent, note._id);
          encryptedBody = encrypted.encryptedBody;
          wrappedNoteKey = encrypted.wrappedNoteKey;
        } else {
          // Keep the wrapped key even when the body empties — historical
          // versions are still encrypted under this NEK.
          encryptedBody = null;
        }

        const fileIds = extractFileIds(decryptedContent);
        updateSeal.mutate(
          { id: note._id, title, encryptedBody, wrappedNoteKey, fileIds },
          { onError: () => setEditing(true) },
        );
        setUpdatedAt(new Date().toISOString());
        setEditing(false);
        setShowFormatBar(false);
      } finally {
        setSaving(false);
      }
    },
    [decryptedContent, title, note.encryptedBody, note.wrappedNoteKey, note._id, updateSeal],
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

  // Execute pending action after mek becomes available (rehydrate or passphrase unlock)
  useEffect(() => {
    const action = pendingActionRef.current;
    if (!action || !mek) return;

    (async () => {
      if (action === 'decrypt') {
        await performDecrypt(mek);
      } else if (action === 'save') {
        await performSave(mek);
      }
      pendingActionRef.current = null;
    })();
  }, [mek, performDecrypt, performSave]);

  const handleDelete = () => {
    deleteSeal.mutate(note._id);
    onClose();
    toast.success('Seal deleted', {
      description: 'You can undo this action.',
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          undeleteSeal.mutate({ id: note._id, note });
          toast.success('Seal restored');
        },
      },
    });
  };

  const handleArchiveToggle = () => {
    const next = !isArchived;
    setIsArchived(next);
    updateSeal.mutate({ id: note._id, archived: next });
  };

  const handleColorChange = (newColor: string | null) => {
    setColor(newColor);
    updateSeal.mutate({ id: note._id, color: newColor });
  };

  const handlePatternChange = (newPattern: string | null) => {
    setPattern(newPattern);
    updateSeal.mutate({ id: note._id, pattern: newPattern });
  };

  const handleTagsChange = (ids: string[]) => {
    setTags(ids);
    updateSeal.mutate({ id: note._id, tags: ids });
  };

  const handleTogglePinned = (next: boolean) => {
    setPinned(next);
    updateSeal.mutate({ id: note._id, pinned: next });
  };

  const handleSetExpiry = (next: { expiresAt: Date | null; burnAfterReading: boolean }) => {
    setExpiresAt(next.expiresAt);
    setBurnAfterReading(next.burnAfterReading);
    updateSeal.mutate({
      id: note._id,
      expiresAt: next.expiresAt ? next.expiresAt.toISOString() : null,
      burnAfterReading: next.burnAfterReading,
    });
  };

  // Seals: arm only AFTER decrypt — the user hasn't "read" until then.
  const { wasInitiallyBurning } = useBurnArming({
    initialBurn: note.burnAfterReading ?? false,
    expiresAt,
    isReady: isDecrypted,
    onArm: () =>
      updateSeal.mutate({
        id: note._id,
        expiresAt: new Date().toISOString(),
        burnAfterReading: true,
      }),
  });

  const handleCancel = () => {
    setTitle(note.title ?? '');
    setDecryptedContent(originalDecryptedRef.current);
    setEditing(false);
  };

  const doClose = () => {
    setDecryptedContent(null);
    setEditing(false);
    onClose();
  };

  const handleClose = () => confirmClose(doClose);

  const handleTimerClick = () => {
    setTimeLeft((prev) => {
      const next = (prev ?? 0) + DECRYPT_FOR_SECONDS;
      totalTimeRef.current = next;
      return next;
    });
  };

  const timerButtons =
    isDecrypted && timeLeft !== null && !editing ? (
      <>
        <TooltipOrPopover
          trigger={
            <div className={s.timerWrapper}>
              <DecryptTimer timeLeft={timeLeft} total={totalTimeRef.current} onClick={handleTimerClick} />
            </div>
          }
          side="bottom"
        >
          {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')} remaining — click to add a minute
        </TooltipOrPopover>
        <TooltipOrPopover
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              className="p-2 w-8 h-8"
              type="button"
              onClick={handleEncrypt}
              data-testid="encrypt-btn"
              title="Encrypt"
              aria-label="Re-encrypt now"
            >
              <Lock size={16} />
            </Button>
          }
          side="bottom"
        >
          Re-encrypt now
        </TooltipOrPopover>
      </>
    ) : null;

  const decryptButton = !isDecrypted ? (
    <Button data-testid="decrypt-btn" variant="subtle-primary" size="sm" onClick={handleDecrypt} disabled={decrypting}>
      <LockOpen size={13} />
      {decrypting ? 'Decrypting…' : 'Decrypt to view'}
    </Button>
  ) : null;

  if (historyOpen) {
    return (
      <>
        <VersionHistoryModal
          tier="seals"
          noteId={note._id}
          color={color}
          pattern={pattern}
          current={{ _id: CURRENT_VERSION_ID, title, content: decryptedContent ?? '', createdAt: updatedAt }}
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
        showEditButton={isDecrypted}
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
        toolbar={isDecrypted ? <FormattingToolbar editor={editor} isOpen={showFormatBar} showFileUpload /> : undefined}
        formatToggle={
          isDecrypted ? (
            <FormatToggleButton isActive={showFormatBar} onToggle={() => setShowFormatBar((v) => !v)} />
          ) : undefined
        }
        footerLeft={isDecrypted ? timerButtons : decryptButton}
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
        {isDecrypted ? (
          <div className={s.decryptedBody}>
            <FileEncryptionProvider mek={mek}>
              <TiptapEditor
                key={editing ? 'editing' : 'viewing'}
                content={decryptedContent}
                onChange={async (html) => {
                  setDecryptedContent(html);
                  if (!editing && guard.isMekAvailable) {
                    try {
                      await guard.execute(async (mek) => {
                        if (html.trim()) {
                          // Same NEK-reuse rule as performSave: history depends on it.
                          const encrypted = note.wrappedNoteKey
                            ? await encryptSealBodyWithExistingKey(mek, html, note._id, note.wrappedNoteKey)
                            : await encryptSealBody(mek, html, note._id);
                          updateSeal.mutate({
                            id: note._id,
                            encryptedBody: encrypted.encryptedBody,
                            wrappedNoteKey: encrypted.wrappedNoteKey,
                          });
                        } else {
                          updateSeal.mutate({ id: note._id, encryptedBody: null });
                        }
                      });
                    } catch {
                      // Silently fail on auto-save encryption
                    }
                  }
                }}
                editable={editing}
                placeholder="Write your seal…"
                onEditorReady={setEditor}
                allowFileUpload
                onUploadingChange={setIsUploading}
                fileEncryptionCtx={mek ? { mek } : undefined}
                requiresEncryption
              />
            </FileEncryptionProvider>
          </div>
        ) : (
          <div className={s.encryptedState}>
            <EncryptedPlaceholder
              rows={estimateLines(note.encryptedBody?.ciphertext ?? '')}
              ciphertext={note.encryptedBody?.ciphertext}
            />
            {decryptError && <p className={s.decryptError}>{decryptError}</p>}
          </div>
        )}
      </SharedNoteModal>

      {guard.PassphraseGuard}

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
