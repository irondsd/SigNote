'use client';

import { useState } from 'react';
import { Trash2, Archive, X, Pencil, Check, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';
import type { NoteDocument } from '@/models/Note';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { useDeleteNote, useUndeleteNote, useUpdateNote } from '@/hooks/useNoteMutations';
import { TiptapEditor } from '@/components/TiptapEditor/TiptapEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import styles from './NoteModal.module.scss';

type NoteModalProps = {
  note: NoteDocument;
  onClose: () => void;
};

const SWATCH_COLORS: Record<NoteColor, string> = {
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

export function NoteModal({ note, onClose }: NoteModalProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(note.content ?? '');
  const [isArchived, setIsArchived] = useState(note.archived);
  const [color, setColor] = useState<string | null>(note.color ?? null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const deleteNote = useDeleteNote();
  const undeleteNote = useUndeleteNote();
  const updateNote = useUpdateNote();

  const handleDelete = () => {
    deleteNote.mutate(note._id.toString());
    onClose();
    toast.success('Note deleted', {
      description: 'You can undo this action.',
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          undeleteNote.mutate(note._id.toString());
          toast.success('Note restored');
        },
      },
    });
  };

  const handleSave = () => {
    updateNote.mutate({ id: note._id.toString(), title, content });
    setEditing(false);
  };

  const handleArchiveToggle = () => {
    const nextArchivedState = !isArchived;
    setIsArchived(nextArchivedState);
    updateNote.mutate({ id: note._id.toString(), archived: nextArchivedState });
  };

  const handleColorChange = (newColor: string | null) => {
    setColor(newColor);
    updateNote.mutate({ id: note._id.toString(), color: newColor });
    setColorPickerOpen(false);
  };

  const date = new Date(note.updatedAt).toLocaleString();

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={cn(styles.modal, noteColorClass(color))} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
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
              <PopoverContent className={cn(styles.colorPickerContent, 'z-[200]')} align="end" sideOffset={8}>
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
                      style={{ background: SWATCH_COLORS[c] }}
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

        {/* Content */}
        <div className={styles.body}>
          <TiptapEditor
            content={content}
            onChange={(html) => {
              setContent(html);
              if (!editing) {
                updateNote.mutate({ id: note._id.toString(), content: html });
              }
            }}
            editable={editing}
            placeholder="Write your note..."
          />
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.date}>Updated {date}</span>
          <div className={styles.actions}>
            {editing ? (
              <button className={`${styles.actionBtn} ${styles.save}`} onClick={handleSave}>
                <Check size={15} />
                Save
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
