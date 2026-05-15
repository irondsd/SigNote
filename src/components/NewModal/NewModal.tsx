'use client';

import { useState, type ReactNode } from 'react';
import { X, Palette } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { NoteStylePicker } from '@/components/NoteStylePicker/NoteStylePicker';
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
  onPatternChange?: (pattern: string | null) => void;
};

export function NewModal({
  heading,
  onClose,
  onBackdropClose,
  footerLeft,
  footerActions,
  toolbar,
  children,
  onColorChange,
  onPatternChange,
}: NewModalProps) {
  const [color, setColor] = useState<string | null>(null);
  const [pattern, setPattern] = useState<string | null>(null);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);

  const handleColorChange = (c: string | null) => {
    setColor(c);
    onColorChange?.(c);
  };

  const handlePatternChange = (p: string | null) => {
    setPattern(p);
    onPatternChange?.(p);
  };

  return (
    <Backdrop onClose={onBackdropClose ?? onClose}>
      <Modal data-color={color || undefined} className={s.modal}>
        <div className={s.header}>
          {heading}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </Button>
        </div>
        <div className={s.body} data-pattern={pattern || undefined}>{children}</div>
        {toolbar}
        <NoteStylePicker
          isOpen={stylePickerOpen}
          color={color}
          pattern={pattern}
          onColorChange={handleColorChange}
          onPatternChange={handlePatternChange}
        />
        <div className={s.footer}>
          <div className={s.footerLeft}>
            {footerLeft}
            {onColorChange && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setStylePickerOpen(!stylePickerOpen)}
                title="Note style"
                aria-label="Note style"
                className={cn(stylePickerOpen && s.activePickerBtn)}
              >
                <Palette size={16} />
              </Button>
            )}
          </div>
          <div className={s.footerRight}>{footerActions}</div>
        </div>
      </Modal>
    </Backdrop>
  );
}
