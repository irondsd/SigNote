'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Archive, ArchiveRestore, Palette, Pencil, QrCode, Trash2 } from 'lucide-react';
import { InlineSvg } from '@irondsd/inline-svg';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorSwatches } from '@/components/ColorSwatches/ColorSwatches';
import { MenuItem } from '@/components/NoteActionsMenu/MenuItem';
import { NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteStyles';
import { cn } from '@/utils/cn';
import menu from '@/components/NoteActionsMenu/NoteActionsMenu.module.scss';
import s from './AuthCardMenu.module.scss';

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

type AuthCardMenuProps = {
  color: NoteColor | null;
  pattern: NotePattern | null;
  archived: boolean;
  /** Writes need a live session; offline the authenticator is read-only. */
  readOnly: boolean;
  readOnlyReason?: string;
  onEdit: () => void;
  onExport: () => void;
  onStyleChange: (patch: { color?: NoteColor | null; pattern?: NotePattern | null }) => void;
  onArchivedChange: (archived: boolean) => void;
  onDelete: () => void;
};

export function AuthCardMenu({
  color,
  pattern,
  archived,
  readOnly,
  readOnlyReason,
  onEdit,
  onExport,
  onStyleChange,
  onArchivedChange,
  onDelete,
}: AuthCardMenuProps) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'main' | 'style'>('main');

  const close = () => {
    setOpen(false);
    setPane('main');
  };

  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setPane('main');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={s.trigger}
          aria-label="Card actions"
          title="Card actions"
          data-testid="auth-actions-btn"
          // The card itself copies the code on click; the menu must not.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className={menu.popover}
        onClick={(e) => e.stopPropagation()}
      >
        {pane === 'main' ? (
          <div className={menu.menu}>
            <MenuItem
              icon={<Pencil size={16} />}
              label="Edit issuer & account"
              disabled={readOnly}
              hint={readOnly ? readOnlyReason : undefined}
              onClick={run(onEdit)}
            />
            <MenuItem
              icon={<Palette size={16} />}
              tone="accent"
              label="Card style"
              hint="Background colour and pattern"
              disabled={readOnly}
              trailing={<ChevronRight size={14} className={s.chevron} />}
              onClick={() => !readOnly && setPane('style')}
            />
            <MenuItem
              icon={<QrCode size={16} />}
              label="Export"
              hint="Reveals the seed — confirm first"
              onClick={run(onExport)}
            />

            <div className={s.divider} />

            <MenuItem
              icon={archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              label={archived ? 'Restore' : 'Archive'}
              hint={archived ? 'Move back to the main list' : 'Moves it to the archive, keeps the seed'}
              disabled={readOnly}
              onClick={run(() => onArchivedChange(!archived))}
            />
            <MenuItem
              icon={<Trash2 size={16} />}
              tone="danger"
              label="Delete"
              hint="The seed is unrecoverable"
              disabled={readOnly}
              onClick={run(onDelete)}
            />
          </div>
        ) : (
          <div className={s.stylePane}>
            <div className={s.paneHeader}>
              <button type="button" className={s.back} onClick={() => setPane('main')} aria-label="Back">
                <ChevronLeft size={14} />
              </button>
              <span className={s.paneTitle}>Card style</span>
            </div>

            <div className={s.paneBody}>
              <div className={s.label}>Background</div>
              <ColorSwatches value={color} onChange={(c) => onStyleChange({ color: c })} includeDefault />

              <div className={cn(s.label, s.labelSpaced)}>Pattern</div>
              <div className={s.patterns}>
                {NOTE_PATTERNS.map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={cn(s.patternTile, (pattern ?? 'plain') === p && s.selected)}
                    data-color={color || undefined}
                    data-pattern={p === 'plain' ? undefined : p}
                    onClick={() => onStyleChange({ pattern: p === 'plain' ? null : (p as NotePattern) })}
                    title={cap(p)}
                    aria-label={cap(p)}
                    aria-pressed={(pattern ?? 'plain') === p}
                  >
                    <InlineSvg src={`/icons/patterns/${p}.svg`} className={s.patternGlyph} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
