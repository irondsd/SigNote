'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { X, Palette } from 'lucide-react';
import { NOTE_COLORS, type NoteColor, type NotePattern } from '@/config/noteColors';
import { getPatternStyle } from '@/config/notePatterns';
import { useIsDark } from '@/hooks/useIsDark';
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

function noteModalStyle(color: string | null): CSSProperties | undefined {
  if (!color || !NOTE_COLORS.includes(color as NoteColor)) return undefined;
  return { '--note-modal-bg': `var(--note-${color})` } as CSSProperties;
}

function bodyPatternStyle(
  color: string | null,
  pattern: string | null,
  isDark: boolean,
): CSSProperties | undefined {
  return getPatternStyle((color as NoteColor) ?? null, (pattern as NotePattern) ?? null, isDark);
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
  onPatternChange,
}: NewModalProps) {
  const [color, setColor] = useState<string | null>(null);
  const [pattern, setPattern] = useState<string | null>(null);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const isDark = useIsDark();

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
      <Modal style={noteModalStyle(color)} className={s.modal}>
        <div className={s.header}>
          {heading}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </Button>
        </div>
        <div className={s.body} style={bodyPatternStyle(color, pattern, isDark)}>{children}</div>
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
