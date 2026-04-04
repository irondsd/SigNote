'use client';

import type { ReactNode } from 'react';
import { Pencil, X, Palette } from 'lucide-react';
import { cn } from '@/utils/cn';
import { NOTE_COLORS } from '@/config/noteColors';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import s from './SharedNoteModal.module.scss';

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
  return s[key as keyof typeof s];
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
      <Modal className={cn(s.modal, noteColorClass(color))}>
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

        <div className={s.body}>{children}</div>

        <div className={s.footer}>
          <span data-testid="note-date" className={s.date}>
            Updated {date}
          </span>
          <div className={s.actions}>
            {!editing && (
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
                <Popover open={colorPickerOpen} onOpenChange={onColorPickerOpenChange}>
                  <PopoverTrigger asChild>
                    <Button
                      data-testid="color-palette-btn"
                      variant="ghost"
                      size="icon-sm"
                      title="Note color"
                      aria-label="Note color"
                    >
                      <Palette size={16} />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className={cn(s.colorPickerContent, 'z-200')} align="end" sideOffset={8}>
                    <div className={s.colorSwatches}>
                      <button
                        type="button"
                        className={cn(s.swatch, s.swatchDefault, !color && s.swatchSelected)}
                        onClick={() => onColorChange(null)}
                        title="Default"
                        aria-label="Default"
                      />
                      {NOTE_COLORS.map((c) => (
                        <button
                          type="button"
                          key={c}
                          className={cn(
                            s.swatch,
                            color === c && s.swatchSelected,
                            s[`switch${c.charAt(0).toUpperCase() + c.slice(1)}` as keyof typeof s],
                          )}
                          onClick={() => onColorChange(c)}
                          title={c.charAt(0).toUpperCase() + c.slice(1)}
                          aria-label={c.charAt(0).toUpperCase() + c.slice(1)}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            )}
            {footerActions}
          </div>
        </div>
      </Modal>
    </Backdrop>
  );
}
