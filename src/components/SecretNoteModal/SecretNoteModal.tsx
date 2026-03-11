'use client';

import { useState } from 'react';
import { Trash2, Archive, X, Pencil, Check, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { useDeleteSecret, useUndeleteSecret, useUpdateSecret, type CachedSecretNote } from '@/hooks/useSecretMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useEncryption } from '@/contexts/EncryptionContext';
import { encryptSecretBody } from '@/lib/crypto';
import styles from './SecretNoteModal.module.scss';

type SecretNoteModalProps = {
  note: CachedSecretNote;
  decryptedContent: string;
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

  return (
    <div className={styles.backdrop} onClick={onClose}>
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
            <button className={styles.iconBtn} onClick={() => setEditing(!editing)} title="Edit">
              <Pencil size={16} />
            </button>
            <button className={styles.iconBtn} onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <TiptapEditor
            content={content}
            onChange={(html) => setContent(html)}
            editable={editing}
            placeholder="Write your secret…"
          />
        </div>

        <div className={styles.footer}>
          <span className={styles.date}>Updated {date}</span>
          <div className={styles.actions}>
            {editing ? (
              <button className={`${styles.actionBtn} ${styles.save}`} onClick={handleSave} disabled={saving}>
                <Check size={15} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <>
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
  );
}
