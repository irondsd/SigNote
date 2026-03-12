'use client';

import { useEffect, useState } from 'react';
import { Trash2, Archive, X, Pencil, Check, Palette, LockOpen, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';
import { NOTE_COLORS, SWITCH_COLORS } from '@/config/noteColors';
import { useDeleteSeal, useUndeleteSeal, useUpdateSeal, type CachedSealNote } from '@/hooks/useSealMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { EncryptedPlaceholder } from '@/components/EncryptedPlaceholder/EncryptedPlaceholder';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import { useEncryption } from '@/contexts/EncryptionContext';
import { decryptSealBody, encryptSealBody } from '@/lib/crypto';
import styles from './SealNoteModal.module.scss';

type SealNoteModalProps = {
  note: CachedSealNote;
  onClose: () => void;
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
                  <Button variant="ghost" size="icon-sm" title="Note color">
                    <Palette size={16} />
                  </Button>
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
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(!editing)} title="Edit">
                  <Pencil size={16} />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={handleClose} title="Close">
                <X size={18} />
              </Button>
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
                <Button variant="outline" size="sm" onClick={handleDecrypt} disabled={decrypting}>
                  <LockOpen size={15} />
                  {decrypting ? 'Decrypting…' : 'Decrypt'}
                </Button>
              </div>
            )}
          </div>

          <div className={styles.footer}>
            <span className={styles.date}>Updated {date}</span>
            <div className={styles.actions}>
              {isDecrypted && editing ? (
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Check size={15} />
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              ) : (
                <>
                  {isDecrypted && (
                    <Button variant="outline" size="sm" onClick={handleEncrypt}>
                      <Lock size={15} />
                      Encrypt
                    </Button>
                  )}
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
