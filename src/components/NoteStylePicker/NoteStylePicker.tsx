'use client';

import { InlineSvg } from '@irondsd/inline-svg';
import { cn } from '@/utils/cn';
import { NOTE_COLORS, NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteColors';
import s from './NoteStylePicker.module.scss';

type NoteStylePickerProps = {
  isOpen: boolean;
  color: string | null;
  pattern: string | null;
  onColorChange: (c: string | null) => void;
  onPatternChange: (p: string | null) => void;
};

function glyphColor(color: string | null): string | undefined {
  if (!color) return undefined;
  return `var(--note-${color})`;
}

export function NoteStylePicker({ isOpen, color, pattern, onColorChange, onPatternChange }: NoteStylePickerProps) {
  return (
    <div className={cn(s.wrapper, isOpen && s.open)}>
      <div className={s.inner}>
        <div className={s.section}>
          <div className={s.label}>Color</div>
          <div className={s.row}>
            <button
              type="button"
              className={cn(s.colorSwatch, s.defaultSwatch, !color && s.selected)}
              onClick={() => onColorChange(null)}
              title="Default"
              aria-label="Default"
            />
            {NOTE_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={cn(s.colorSwatch, color === c && s.selected)}
                style={{ backgroundColor: `var(--note-${c})` }}
                onClick={() => onColorChange(c)}
                title={c.charAt(0).toUpperCase() + c.slice(1)}
                aria-label={c.charAt(0).toUpperCase() + c.slice(1)}
              />
            ))}
          </div>
        </div>
        <div className={s.divider} />
        <div className={s.section}>
          <div className={s.label}>Pattern</div>
          <div className={s.row}>
            {NOTE_PATTERNS.map((p) => (
              <button
                type="button"
                key={p}
                className={cn(s.patternSwatch, (pattern ?? 'plain') === p && s.selected)}
                onClick={() => onPatternChange(p === 'plain' ? null : p)}
                title={p.charAt(0).toUpperCase() + p.slice(1)}
                aria-label={p.charAt(0).toUpperCase() + p.slice(1)}
              >
                <InlineSvg src={`/icons/patterns/${p}.svg`} className={s.glyphIcon} />
              </button>
            ))}
            <span className={s.selectionLabel}>
              {color ? color.charAt(0).toUpperCase() + color.slice(1) : 'Default'}
              {pattern ? ` · ${pattern.charAt(0).toUpperCase() + pattern.slice(1)}` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
