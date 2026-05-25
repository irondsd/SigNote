'use client';

import { useState } from 'react';
import { ChevronRight, MoreVertical, Pin, PinOff, Timer } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { MenuItem } from './MenuItem';
import { SelfDestructPicker } from './SelfDestructPicker';
import s from './NoteActionsMenu.module.scss';

type NoteActionsMenuProps = {
  pinned: boolean;
  onTogglePinned: (next: boolean) => void;
  expiresAt: Date | string | null;
  burnAfterReading: boolean;
  onSetExpiry: (next: { expiresAt: Date | null; burnAfterReading: boolean }) => void;
};

export function NoteActionsMenu({
  pinned,
  onTogglePinned,
  expiresAt,
  burnAfterReading,
  onSetExpiry,
}: NoteActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'main' | 'expiry'>('main');

  const expiryDate = expiresAt ? new Date(expiresAt) : null;

  const close = () => {
    setOpen(false);
    setPane('main');
  };

  const handleTogglePin = () => {
    onTogglePinned(!pinned);
    close();
  };

  const handleCommitExpiry = (next: { expiresAt: Date | null; burnAfterReading: boolean }) => {
    onSetExpiry(next);
    close();
  };

  const handleRemoveTimer = () => {
    onSetExpiry({ expiresAt: null, burnAfterReading: false });
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More actions"
          title="More actions"
          data-testid="more-actions-btn"
        >
          <MoreVertical size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className={s.popover}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {pane === 'main' ? (
          <div className={s.menu}>
            <MenuItem
              icon={pinned ? <PinOff size={16} /> : <Pin size={16} />}
              label={pinned ? 'Unpin from top' : 'Pin to top'}
              onClick={handleTogglePin}
            />
            <MenuItem
              icon={<Timer size={16} />}
              label="Self-destruct timer"
              trailing={<ChevronRight size={14} />}
              onClick={() => setPane('expiry')}
            />
          </div>
        ) : (
          <SelfDestructPicker
            expiresAt={expiryDate}
            burnAfterReading={burnAfterReading}
            onBack={() => setPane('main')}
            onCommit={handleCommitExpiry}
            onRemove={handleRemoveTimer}
            onCancel={close}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
