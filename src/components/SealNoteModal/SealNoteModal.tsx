'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Archive, ArchiveRestore, Check, LockOpen, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteSeal, useUndeleteSeal, useUpdateSeal, type CachedSealNote } from '@/hooks/useSealMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { EncryptedPlaceholder, estimateLines } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { decryptSealBody, encryptSealBody } from '@/lib/crypto';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { ConfirmDiscardDialog } from '@/components/ConfirmDiscardDialog/ConfirmDiscardDialog';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { MAX_TITLE, MAX_CONTENT } from '@/config/constants';
import { DecryptTimer } from './DecryptTimer';
import s from './SealNoteModal.module.scss';

const DECRYPT_FOR_SECONDS = 60;

type SealNoteModalProps = {
  note: CachedSealNote;
  onClose: () => void;
};

export function SealNoteModal({ note, onClose }: SealNoteModalProps) {
  const { mek, phase, lockType, rehydrate } = useEncryption();
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [decryptError, setDecryptError] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  // Set to true after passphrase unlock — triggers decrypt via useEffect when mek is available
  const [pendingDecrypt, setPendingDecrypt] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const totalTimeRef = useRef(DECRYPT_FOR_SECONDS);
  const originalDecryptedRef = useRef<string | null>(null);

  const deleteSeal = useDeleteSeal();
  const undeleteSeal = useUndeleteSeal();
  const updateSeal = useUpdateSeal();

  const isDecrypted = decryptedContent !== null;
  const isDirty =
    editing && (title !== (note.title ?? '') || (isDecrypted && decryptedContent !== originalDecryptedRef.current));
  const { showConfirm, confirmClose, onConfirmDiscard, onCancelClose } = useUnsavedChanges(isDirty);

  // Trigger decrypt after passphrase unlock provides mek
  useEffect(() => {
    if (pendingDecrypt && mek) {
      setPendingDecrypt(false);
      performDecrypt(mek);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mek, pendingDecrypt]);

  // Complete pending save after passphrase unlock restores mek
  useEffect(() => {
    if (pendingSave && mek) {
      setPendingSave(false);
      performSave(mek);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mek, pendingSave]);

  const performDecrypt = async (currentMek: CryptoKey) => {
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
  };

  const handleDecrypt = async () => {
    if (!mek) {
      if (lockType === 'soft') {
        // Soft lock: deviceShare still in sessionStorage — rehydrate silently
        setDecrypting(true);
        setPendingDecrypt(true);
        try {
          await rehydrate();
          // pendingDecrypt useEffect fires once mek is restored
        } catch {
          setDecrypting(false);
          setPendingDecrypt(false);
          setShowPassphrase(true);
        }
        return;
      }
      // Hard lock: need passphrase
      setPendingDecrypt(true);
      setShowPassphrase(true);
      return;
    }
    performDecrypt(mek);
  };

  const handleEncrypt = useCallback(() => {
    setDecryptedContent(null);
    setEditing(false);
    setTimeLeft(null);
    totalTimeRef.current = DECRYPT_FOR_SECONDS;
  }, []);

  // Soft lock: clear decrypted content in view mode
  // Hard lock: close modal if not editing
  useEffect(() => {
    if (phase !== 'locked') return;
    if (lockType === 'soft' && !editing && isDecrypted) {
      handleEncrypt();
    } else if (lockType === 'hard' && !editing) {
      onClose();
    }
  }, [phase, lockType, editing, isDecrypted, handleEncrypt, onClose]);

  // Auto-encrypt countdown
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0 || editing) return;
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
  }, [timeLeft, editing, handleEncrypt]);

  const performSave = async (currentMek: CryptoKey) => {
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
        const encrypted = await encryptSealBody(currentMek, decryptedContent, note._id);
        encryptedBody = encrypted.encryptedBody;
        wrappedNoteKey = encrypted.wrappedNoteKey;
      } else {
        encryptedBody = null;
        wrappedNoteKey = null;
      }

      updateSeal.mutate({ id: note._id, title, encryptedBody, wrappedNoteKey });
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
    setColorPickerOpen(false);
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

  const date = new Date(note.updatedAt).toLocaleString();

  const footerActions =
    isDecrypted && editing ? (
      <Button data-testid="save-btn" size="sm" onClick={handleSave} disabled={saving}>
        <Check size={15} />
        {saving ? 'Saving…' : 'Save'}
      </Button>
    ) : (
      <>
        {isDecrypted ? (
          <Button data-testid="encrypt-btn" variant="outline" size="sm" onClick={handleEncrypt}>
            <Lock size={15} />
            Encrypt
          </Button>
        ) : (
          <Button data-testid="decrypt-btn" variant="outline" size="sm" onClick={handleDecrypt} disabled={decrypting}>
            <LockOpen size={15} />
            {decrypting ? 'Decrypting…' : 'Decrypt'}
          </Button>
        )}
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
        showEditButton={isDecrypted}
        onEditToggle={() => setEditing(!editing)}
        onClose={handleClose}
        disableClose={editing}
        date={date}
        footerActions={footerActions}
      >
        {isDecrypted ? (
          <div className={s.decryptedBody}>
            <TiptapEditor
              content={decryptedContent}
              onChange={async (html) => {
                setDecryptedContent(html);
                if (!editing && mek) {
                  if (html.trim()) {
                    const encrypted = await encryptSealBody(mek, html, note._id);
                    updateSeal.mutate({
                      id: note._id,
                      encryptedBody: encrypted.encryptedBody,
                      wrappedNoteKey: encrypted.wrappedNoteKey,
                    });
                  } else {
                    updateSeal.mutate({ id: note._id, encryptedBody: null, wrappedNoteKey: null });
                  }
                }
              }}
              editable={editing}
              placeholder="Write your seal…"
            />
            {timeLeft !== null && !editing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={s.timerWrapper}>
                    <DecryptTimer timeLeft={timeLeft} total={totalTimeRef.current} onClick={handleTimerClick} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="z-200">
                  {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')} remaining — click to add a
                  minute
                </TooltipContent>
              </Tooltip>
            )}
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

      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => setShowPassphrase(false)}
          onClose={() => {
            setShowPassphrase(false);
            setPendingDecrypt(false);
            setPendingSave(false);
          }}
        />
      )}

      {showConfirm && <ConfirmDiscardDialog onDiscard={onConfirmDiscard} onCancel={onCancelClose} />}
    </>
  );
}
