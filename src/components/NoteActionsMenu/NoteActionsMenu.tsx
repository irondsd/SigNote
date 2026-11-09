'use client';

import { useState } from 'react';
import { AlarmClock, ChevronRight, History, MoreVertical, Pin, PinOff, Timer, SquareArrowUp } from 'lucide-react';
import { formatSnoozeDate } from '@/lib/snooze';
import { Dropdown } from '@/components/Dropdown/Dropdown';
import { Button } from '@/components/ui/button';
import { MenuItem } from './MenuItem';
import { SelfDestructPicker } from './SelfDestructPicker';
import { SnoozePicker } from './SnoozePicker';
import s from './NoteActionsMenu.module.scss';

type NoteActionsMenuProps = {
  pinned: boolean;
  onTogglePinned: (next: boolean) => void;
  expiresAt: Date | string | null;
  burnAfterReading: boolean;
  onSetExpiry: (next: { expiresAt: Date | null; burnAfterReading: boolean }) => void;
  /** The date the note is snoozed until, while it is; the item is hidden when `onSnooze` is omitted. */
  snoozedUntil?: Date | string | null;
  /** A date snoozes the note into the archive; `null` wakes it. */
  onSnooze?: (until: Date | null) => void;
  /** Opens the version history panel; the item is hidden when omitted. */
  onVersionHistory?: () => void;
  /** Fired on first open so the parent can prefetch the version list. */
  onOpenChange?: (open: boolean) => void;
  promotion?: {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
  };
};

export function NoteActionsMenu({
  pinned,
  onTogglePinned,
  expiresAt,
  burnAfterReading,
  onSetExpiry,
  snoozedUntil,
  onSnooze,
  onVersionHistory,
  onOpenChange,
  promotion,
}: NoteActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'main' | 'expiry' | 'snooze'>('main');

  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  const snoozeDate = snoozedUntil ? new Date(snoozedUntil) : null;

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
    <Dropdown
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        onOpenChange?.(v);
        if (!v) setPane('main');
      }}
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More actions"
          title="More actions"
          data-testid="more-actions-btn"
        >
          <MoreVertical size={16} />
        </Button>
      }
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
          {onSnooze && (
            <MenuItem
              data-testid="snooze-item"
              icon={<AlarmClock size={16} />}
              label={snoozeDate ? `Snoozed until ${formatSnoozeDate(snoozeDate)}` : 'Snooze until…'}
              trailing={<ChevronRight size={14} />}
              onClick={() => setPane('snooze')}
            />
          )}
          {onVersionHistory && (
            <MenuItem
              data-testid="version-history-item"
              icon={<History size={16} />}
              label="Version history"
              onClick={() => {
                onVersionHistory();
                close();
              }}
            />
          )}
          {promotion && (
            <MenuItem
              data-testid="promote-tier-item"
              icon={<SquareArrowUp size={16} className="" />}
              label={promotion.label}
              disabled={promotion.disabled}
              onClick={() => {
                close();
                promotion.onSelect();
              }}
            />
          )}
        </div>
      ) : pane === 'snooze' ? (
        <SnoozePicker
          snoozedUntil={snoozeDate}
          onBack={() => setPane('main')}
          onCommit={(until) => {
            onSnooze?.(until);
            close();
          }}
          onWake={() => {
            onSnooze?.(null);
            close();
          }}
          onCancel={close}
        />
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
    </Dropdown>
  );
}
