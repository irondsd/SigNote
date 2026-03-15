'use client';

import type { ReactNode } from 'react';
import { Pencil, X, Palette } from 'lucide-react';
import { cn } from '@/utils/cn';
import { NOTE_COLORS, SWITCH_COLORS } from '@/config/noteColors';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import styles from './SharedNoteModal.module.scss';

type SharedNoteModalProps = {
  title: string;
  editing: boolean;
  onTitleChange: (v: string) => void;
  color: string | null;
  onColorChange: (c: string | null) => void;
  colorPickerOpen: boolean;
  onColorPickerOpenChange: (open: boolean) => void;
  showEditButton?: boolean;
  onEditToggle: () => void;
  onClose: () => void;
  disableClose?: boolean;
  date: string;
  footerActions: ReactNode;
  children: ReactNode;
};

function noteColorClass(color: string | null | undefined) {
  if (!color) return undefined;
  const key = `color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  return styles[key as keyof typeof styles];
}

export function SharedNoteModal({
  title,
  editing,
  onTitleChange,
  color,
  onColorChange,
  colorPickerOpen,
  onColorPickerOpenChange,
  showEditButton = true,
  onEditToggle,
  onClose,
  disableClose,
  date,
  footerActions,
  children,
}: SharedNoteModalProps) {
  return (
    <Backdrop onClose={onClose} disableClose={disableClose}>
      <Modal className={cn(styles.modal, noteColorClass(color))}>
        <div className={styles.header}>
          {editing ? (
            <input
              className={styles.titleInput}
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Title"
              autoFocus
            />
          ) : (
            <h2 className={styles.title}>{title || 'Untitled'}</h2>
          )}
          <div className={styles.headerActions}>
            <Popover open={colorPickerOpen} onOpenChange={onColorPickerOpenChange}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="Note color">
                  <Palette size={16} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className={cn(styles.colorPickerContent, 'z-200')} align="end" sideOffset={8}>
                <div className={styles.colorSwatches}>
                  <button
                    className={cn(styles.swatch, styles.swatchDefault, !color && styles.swatchSelected)}
                    onClick={() => onColorChange(null)}
                    title="Default"
                  />
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      className={cn(styles.swatch, color === c && styles.swatchSelected)}
                      style={{ background: SWITCH_COLORS[c] }}
                      onClick={() => onColorChange(c)}
                      title={c.charAt(0).toUpperCase() + c.slice(1)}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {showEditButton && (
              <Button variant="ghost" size="icon-sm" onClick={onEditToggle} title="Edit">
                <Pencil size={16} />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
              <X size={18} />
            </Button>
          </div>
        </div>

        <div className={styles.body}>{children}</div>

        <div className={styles.footer}>
          <span className={styles.date}>Updated {date}</span>
          <div className={styles.actions}>{footerActions}</div>
        </div>
      </Modal>
    </Backdrop>
  );
}
