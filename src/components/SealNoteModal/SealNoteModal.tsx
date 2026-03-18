'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Archive, Check, LockOpen, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteSeal, useUndeleteSeal, useUpdateSeal, type CachedSealNote } from '@/hooks/useSealMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Button } from '@/components/ui/button';
import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { decryptSealBody, encryptSealBody } from '@/lib/crypto';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SharedNoteModal } from '@/components/SharedNoteModal/SharedNoteModal';
import { DecryptTimer } from './DecryptTimer';
import styles from './SealNoteModal.module.scss';

const DECRYPT_FOR_SECONDS = 60;

type SealNoteModalProps = {
  note: CachedSealNote;
  onClose: () => void;
};

export function SealNoteModal({ note, onClose }: SealNoteModalProps) {
  const { mek } = useEncryption();
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
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const totalTimeRef = useRef(DECRYPT_FOR_SECONDS);

  const deleteSeal = useDeleteSeal();
  const undeleteSeal = useUndeleteSeal();
  const updateSeal = useUpdateSeal();

  const isDecrypted = decryptedContent !== null;

  // Trigger decrypt after passphrase unlock provides mek
  useEffect(() => {
    if (pendingDecrypt && mek) {
      setPendingDecrypt(false);
      performDecrypt(mek);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mek, pendingDecrypt]);

  const performDecrypt = async (currentMek: CryptoKey) => {
    if (!note.encryptedBody || !note.wrappedNoteKey) {
      setDecryptedContent('');
      return;
    }
    setDecrypting(true);
    setDecryptError('');
    try {
      const plaintext = await decryptSealBody(currentMek, note.encryptedBody, note.wrappedNoteKey, note._id);
      setDecryptedContent(plaintext);
      totalTimeRef.current = DECRYPT_FOR_SECONDS;
      setTimeLeft(DECRYPT_FOR_SECONDS);
    } catch {
      setDecryptError('Failed to decrypt. The note may be corrupted.');
    } finally {
      setDecrypting(false);
    }
  };

  const handleDecrypt = () => {
    if (!mek) {
      // No MEK — need passphrase first, then auto-decrypt via useEffect
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

  const handleSave = async () => {
    if (!mek || decryptedContent === null) return;
    setSaving(true);
    try {
      let encryptedBody = note.encryptedBody;
      let wrappedNoteKey = note.wrappedNoteKey;

      if (decryptedContent.trim()) {
        const encrypted = await encryptSealBody(mek, decryptedContent, note._id);
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

  const handleClose = () => {
    // Clear plaintext from state on close
    setDecryptedContent(null);
    setEditing(false);
    onClose();
  };

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
          <Archive size={15} />
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
          <div className={styles.decryptedBody}>
            <TiptapEditor
              content={decryptedContent}
              onChange={(html) => setDecryptedContent(html)}
              editable={editing}
              placeholder="Write your seal…"
            />
            {timeLeft !== null && !editing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={styles.timerWrapper}>
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
          <div className={styles.encryptedState}>
            <EncryptedPlaceholder rows={4} />
            {decryptError && <p className={styles.decryptError}>{decryptError}</p>}
          </div>
        )}
      </SharedNoteModal>

      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => setShowPassphrase(false)}
          onClose={() => {
            setShowPassphrase(false);
            setPendingDecrypt(false);
          }}
        />
      )}
    </>
  );
}
