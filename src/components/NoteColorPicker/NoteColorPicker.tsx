'use client';

import { Palette } from 'lucide-react';
import { cn } from '@/utils/cn';
import { NOTE_COLORS } from '@/config/noteColors';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import s from './NoteColorPicker.module.scss';

type NoteColorPickerProps = {
  color: string | null;
  onColorChange: (c: string | null) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isEditing?: boolean;
};

export function NoteColorPicker({
  color,
  onColorChange,
  isOpen,
  onOpenChange,
  isEditing = false,
}: NoteColorPickerProps) {
  if (isEditing) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
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
  );
}
