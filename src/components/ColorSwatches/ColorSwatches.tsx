'use client';

import { cn } from '@/utils/cn';
import { NOTE_COLORS, type NoteColor } from '@/config/noteStyles';
import s from './ColorSwatches.module.scss';

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

type ColorSwatchesProps = {
  value: string | null;
  onChange: (color: NoteColor | null) => void;
  /** Show a leading "no color" swatch that maps to `null`. */
  includeDefault?: boolean;
  /** Rounded square (note style picker) or circle (tag manager). */
  shape?: 'square' | 'circle';
  /** Flow swatches inline (wrap) or in a fixed 5-column grid. */
  layout?: 'flex' | 'grid';
  className?: string;
};

export function ColorSwatches({
  value,
  onChange,
  includeDefault = false,
  shape = 'square',
  layout = 'flex',
  className,
}: ColorSwatchesProps) {
  return (
    <div className={cn(s.row, className)} data-shape={shape} data-layout={layout}>
      {includeDefault && (
        <button
          type="button"
          className={cn(s.swatch, s.default, value == null && s.selected)}
          onClick={() => onChange(null)}
          title="Default"
          aria-label="Default"
          aria-pressed={value == null}
        />
      )}
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          data-color={c}
          className={cn(s.swatch, value === c && s.selected)}
          onClick={() => onChange(c)}
          title={cap(c)}
          aria-label={cap(c)}
          aria-pressed={value === c}
        />
      ))}
    </div>
  );
}
