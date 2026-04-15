'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { NOTE_COLORS, type NoteColor } from '@/config/noteColors';
import { Button } from '@/components/ui/button';
import { NoteColorPicker } from '@/components/NoteColorPicker/NoteColorPicker';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import s from './NewModal.module.scss';

type NewModalProps = {
  heading: ReactNode;
  onClose: () => void;
  onBackdropClose?: () => void;
  footerLeft?: ReactNode;
  footerActions: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  onColorChange?: (color: string | null) => void;
};

function noteModalStyle(color: string | null): CSSProperties | undefined {
  if (!color || !NOTE_COLORS.includes(color as NoteColor)) return undefined;
  return { '--note-modal-bg': `var(--note-${color})` } as CSSProperties;
}

export function NewModal({
  heading,
  onClose,
  onBackdropClose,
  footerLeft,
  footerActions,
  toolbar,
  children,
  onColorChange,
}: NewModalProps) {
  const [color, setColor] = useState<string | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const handleColorChange = (c: string | null) => {
    setColor(c);
    onColorChange?.(c);
  };

  return (
    <Backdrop onClose={onBackdropClose ?? onClose}>
      <Modal style={noteModalStyle(color)}>
        <div className={s.header}>
          {heading}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </Button>
        </div>
        <div className={s.body}>{children}</div>
        {toolbar}
        <div className={s.footer}>
          <div className={s.footerLeft}>
            {footerLeft}
            {onColorChange && (
              <NoteColorPicker
                color={color}
                onColorChange={handleColorChange}
                isOpen={colorPickerOpen}
                onOpenChange={setColorPickerOpen}
              />
            )}
          </div>
          <div className={s.footerRight}>{footerActions}</div>
        </div>
      </Modal>
    </Backdrop>
  );
}
