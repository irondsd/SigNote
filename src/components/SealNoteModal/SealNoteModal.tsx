'use client';

import { useEffect, useState } from 'react';
import { Trash2, Archive, X, Pencil, Check, Palette, LockOpen, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { useDeleteSeal, useUndeleteSeal, useUpdateSeal, type CachedSealNote } from '@/hooks/useSealMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { decryptSealBody, encryptSealBody } from '@/lib/crypto';
import styles from './SealNoteModal.module.scss';

type SealNoteModalProps = {
  note: CachedSealNote;
  onClose: () => void;
};

const SWITCH_COLORS: Record<NoteColor, string> = {
  yellow: '#FFD54F',
  red: '#F28B82',
  blue: '#90CAF9',
  green: '#81C995',
  clay: '#E6B8A2',
  gray: '#BDBDBD',
};

function noteColorClass(color: string | null | undefined) {
  if (!color) return undefined;
  const key = `color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  return styles[key as keyof typeof styles];
}

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

  const handleEncrypt = () => {
    setDecryptedContent(null);
    setEditing(false);
  };

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

  const date = new Date(note.updatedAt).toLocaleString();

  return (
    <>
      <div className={styles.backdrop} onClick={handleClose}>
        <div className={cn(styles.modal, noteColorClass(color))} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            {editing ? (
              <input
                className={styles.titleInput}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                autoFocus
              />
            ) : (
              <h2 className={styles.title}>{note.title || 'Untitled'}</h2>
            )}
            <div className={styles.headerActions}>
              <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
                <PopoverTrigger asChild>
                  <button className={styles.iconBtn} title="Note color">
                    <Palette size={16} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className={cn(styles.colorPickerContent, 'z-200')} align="end" sideOffset={8}>
                  <div className={styles.colorSwatches}>
                    <button
                      className={cn(styles.swatch, styles.swatchDefault, !color && styles.swatchSelected)}
                      onClick={() => handleColorChange(null)}
                      title="Default"
                    />
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c}
                        className={cn(styles.swatch, color === c && styles.swatchSelected)}
                        style={{ background: SWITCH_COLORS[c] }}
                        onClick={() => handleColorChange(c)}
                        title={c.charAt(0).toUpperCase() + c.slice(1)}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {isDecrypted && (
                <button className={styles.iconBtn} onClick={() => setEditing(!editing)} title="Edit">
                  <Pencil size={16} />
                </button>
              )}
              <button className={styles.iconBtn} onClick={handleClose} title="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className={styles.body}>
            {isDecrypted ? (
              <TiptapEditor
                content={decryptedContent}
                onChange={(html) => setDecryptedContent(html)}
                editable={editing}
                placeholder="Write your seal…"
              />
            ) : (
              <div className={styles.encryptedState}>
                <EncryptedPlaceholder rows={4} />
                {decryptError && <p className={styles.decryptError}>{decryptError}</p>}
                <button
                  className={styles.decryptBtn}
                  onClick={handleDecrypt}
                  disabled={decrypting}
                >
                  <LockOpen size={15} />
                  {decrypting ? 'Decrypting…' : 'Decrypt'}
                </button>
              </div>
            )}
          </div>

          <div className={styles.footer}>
            <span className={styles.date}>Updated {date}</span>
            <div className={styles.actions}>
              {isDecrypted && editing ? (
                <button className={`${styles.actionBtn} ${styles.save}`} onClick={handleSave} disabled={saving}>
                  <Check size={15} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              ) : (
                <>
                  {isDecrypted && (
                    <button className={`${styles.actionBtn} ${styles.encrypt}`} onClick={handleEncrypt}>
                      <Lock size={15} />
                      Encrypt
                    </button>
                  )}
                  <button
                    className={`${styles.actionBtn} ${styles.archive}`}
                    onClick={handleArchiveToggle}
                    title={isArchived ? 'Unarchive' : 'Archive'}
                  >
                    <Archive size={15} />
                    {isArchived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button className={`${styles.actionBtn} ${styles.delete}`} onClick={handleDelete}>
                    <Trash2 size={15} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

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
