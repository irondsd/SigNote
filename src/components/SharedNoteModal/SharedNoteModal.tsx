'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Pencil, X, Archive, ArchiveRestore, Trash2, Check, Palette } from 'lucide-react';
import { NOTE_COLORS, type NoteColor, type NotePattern } from '@/config/noteColors';
import { getPatternStyle } from '@/config/notePatterns';
import { useIsDark } from '@/hooks/useIsDark';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { NoteStylePicker } from '@/components/NoteStylePicker/NoteStylePicker';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import { RelativeDate } from '@/components/RelativeDate/RelativeDate';
import s from './SharedNoteModal.module.scss';

type SharedNoteModalProps = {
  title: string;
  editing: boolean;
  onTitleChange: (v: string) => void;
  color: string | null;
  pattern: string | null;
  onColorChange: (c: string | null) => void;
  onPatternChange: (p: string | null) => void;
  stylePickerOpen: boolean;
  onStylePickerOpenChange: (open: boolean) => void;
  showEditButton?: boolean;
  onEditToggle: () => void;
  onClose: () => void;
  disableClose?: boolean;
  updatedAt: string | Date;
  createdAt: string | Date;
  onSave: () => void;
  onCancel?: () => void;
  saving?: boolean;
  isArchived: boolean;
  onArchive: () => void;
  onDelete: () => void;
  children: ReactNode;
  cardRect?: DOMRect;
  toolbar?: ReactNode;
  formatToggle?: ReactNode;
  footerLeft?: ReactNode;
  disableSave?: boolean;
};

function noteModalStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color || !NOTE_COLORS.includes(color as NoteColor)) return undefined;
  return { '--note-modal-bg': `var(--note-${color})` } as CSSProperties;
}

function bodyPatternStyle(
  color: string | null | undefined,
  pattern: string | null | undefined,
  isDark: boolean,
): CSSProperties | undefined {
  return getPatternStyle((color as NoteColor) ?? null, (pattern as NotePattern) ?? null, isDark);
}

export function SharedNoteModal({
  title,
  editing,
  onTitleChange,
  color,
  pattern,
  onColorChange,
  onPatternChange,
  stylePickerOpen,
  onStylePickerOpenChange,
  showEditButton = true,
  onEditToggle,
  onClose,
  disableClose,
  updatedAt,
  createdAt,
  onSave,
  onCancel,
  saving = false,
  isArchived,
  onArchive,
  onDelete,
  children,
  cardRect,
  toolbar,
  formatToggle,
  footerLeft,
  disableSave = false,
}: SharedNoteModalProps) {
  const isDark = useIsDark();

  return (
    <Backdrop onClose={onClose} disableClose={disableClose}>
      <Modal cardRect={cardRect} className={cn(s.modal)} style={noteModalStyle(color)}>
        <div className={s.header}>
          {editing ? (
            <input
              data-testid="note-title-input"
              className={s.titleInput}
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Title"
              autoFocus
            />
          ) : (
            <h2 data-testid="note-title" className={s.title}>
              {title || 'Untitled'}
            </h2>
          )}
          <div className={s.headerActions}>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close" aria-label="Close">
              <X size={18} />
            </Button>
          </div>
        </div>

        <div className={s.bodyWrap} style={bodyPatternStyle(color, pattern, isDark)}>
          <div className={s.body}>{children}</div>
          {!editing && (
            <RelativeDate
              data-testid="note-date"
              updatedAt={updatedAt}
              createdAt={createdAt}
              className={s.dateOverlay}
            />
          )}
        </div>

        {toolbar}

        <NoteStylePicker
          isOpen={stylePickerOpen}
          color={color}
          pattern={pattern}
          onColorChange={onColorChange}
          onPatternChange={onPatternChange}
        />

        <div className={s.footer}>
          <div className={s.footerLeft}>{editing ? formatToggle : footerLeft}</div>
          <div className={s.actions}>
            {!editing ? (
              <>
                {showEditButton && (
                  <Button
                    data-testid="edit-btn"
                    variant="ghost"
                    size="icon-sm"
                    onClick={onEditToggle}
                    title="Edit"
                    aria-label="Edit"
                  >
                    <Pencil size={16} />
                  </Button>
                )}
                <Button
                  data-testid="style-picker-btn"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onStylePickerOpenChange(!stylePickerOpen)}
                  title="Note style"
                  aria-label="Note style"
                  className={cn(stylePickerOpen && s.activePickerBtn)}
                >
                  <Palette size={16} />
                </Button>
                <Button
                  data-testid="archive-btn"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onArchive}
                  title={isArchived ? 'Unarchive' : 'Archive'}
                  aria-label={isArchived ? 'Unarchive note' : 'Archive note'}
                >
                  {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                </Button>
                <Button
                  data-testid="delete-btn"
                  variant="destructive"
                  size="icon-sm"
                  onClick={onDelete}
                  title="Delete"
                  aria-label="Delete note"
                >
                  <Trash2 size={15} />
                </Button>
              </>
            ) : (
              <>
                {onCancel && (
                  <Button variant="ghost" size="sm" onClick={onCancel}>
                    <X size={14} />
                    Cancel
                  </Button>
                )}
                <Button data-testid="save-btn" size="sm" onClick={onSave} disabled={saving || disableSave}>
                  <Check size={15} />
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
          </div>
        </div>
      </Modal>
    </Backdrop>
  );
}
