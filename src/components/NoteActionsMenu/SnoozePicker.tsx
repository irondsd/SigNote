'use client';

import { useState } from 'react';
import { AlarmClock, AlarmClockOff, ArrowLeft, CalendarDays } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { formatSnoozeDate } from '@/lib/snooze';
import { isSameDay } from '@/utils/selfDestruct';
import { cn } from '@/utils/cn';
// Deliberately the self-destruct picker's stylesheet: the two panes are the
// same surface (header, preset grid, custom chip, footer) with different content.
import s from './SelfDestructPicker.module.scss';

type PresetId = 'tomorrow' | 'week' | 'month' | 'quarter';

/**
 * A snooze ends at the start of a local day, not at a time of day: the note
 * should simply be there the first time the app is opened on that date.
 */
export function startOfDayFromNow(offset: { days?: number; months?: number }, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (offset.months) d.setMonth(d.getMonth() + offset.months);
  if (offset.days) d.setDate(d.getDate() + offset.days);
  return d;
}

const PRESETS: { id: PresetId; label: string; offset: { days?: number; months?: number } }[] = [
  { id: 'tomorrow', label: 'Tomorrow', offset: { days: 1 } },
  { id: 'week', label: 'In a week', offset: { days: 7 } },
  { id: 'month', label: 'In a month', offset: { months: 1 } },
  { id: 'quarter', label: 'In 3 months', offset: { months: 3 } },
];

type SnoozePickerProps = {
  /** The date the note is currently snoozed until, if it is. */
  snoozedUntil: Date | null;
  onBack: () => void;
  onCommit: (until: Date) => void;
  /** Ends the snooze now. */
  onWake: () => void;
  onCancel: () => void;
};

export function SnoozePicker({ snoozedUntil, onBack, onCommit, onWake, onCancel }: SnoozePickerProps) {
  const snoozed = snoozedUntil !== null;
  const [active, setActive] = useState<PresetId | 'custom' | null>(snoozed ? 'custom' : null);
  const [customDate, setCustomDate] = useState<Date | undefined>(snoozedUntil ?? undefined);
  const [showCalendar, setShowCalendar] = useState(false);

  const selected: Date | null =
    active === 'custom'
      ? (customDate ?? null)
      : active
        ? startOfDayFromNow(PRESETS.find((p) => p.id === active)!.offset)
        : null;

  const canCommit = selected !== null && !(snoozedUntil && isSameDay(selected, snoozedUntil));
  const commitLabel = snoozed ? 'Update' : 'Snooze';

  const handleCommit = () => {
    if (selected) onCommit(selected);
  };

  if (showCalendar) {
    return (
      <div className={s.menu} data-testid="snooze-picker">
        <div className={s.subHeader}>
          <div className={s.subTitle}>
            <AlarmClock size={13} />
            Pick a date
          </div>
        </div>

        <div className={s.calendarRow}>
          <Calendar
            mode="single"
            selected={customDate}
            onSelect={(d) => {
              if (!d) return setCustomDate(undefined);
              const day = new Date(d);
              day.setHours(0, 0, 0, 0);
              setCustomDate(day);
            }}
            // Today is already here — the earliest a note can come back is tomorrow.
            disabled={{ before: startOfDayFromNow({ days: 1 }) }}
          />
        </div>

        <div className={s.footerRow}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowCalendar(false);
              if (!customDate) setActive(null);
            }}
            className="flex-1"
          >
            <ArrowLeft size={14} />
            Back
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={!canCommit}
            className="flex-1"
            data-testid="snooze-commit-btn"
          >
            {commitLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.menu} data-testid="snooze-picker">
      <div className={s.subHeader}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={14} />
        </Button>
        <div className={s.subTitle}>
          <AlarmClock size={13} />
          Snooze
        </div>
      </div>

      <div className={s.subBlurb}>
        {snoozedUntil
          ? `Snoozed until ${formatSnoozeDate(snoozedUntil)}. It stays in the archive until then.`
          : 'Moves this note to the archive and brings it back to your notes on the day you pick.'}
      </div>

      <div className={s.sectionLabel}>{snoozed ? 'Change to' : 'Bring it back'}</div>

      <div className={s.presetGrid}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={s.preset}
            data-active={active === p.id}
            data-testid={`snooze-preset-${p.id}`}
            onClick={() => setActive(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={s.customRow}>
        {customDate ? (
          <button
            type="button"
            className={cn(s.customChip, active !== 'custom' && s.inactive)}
            onClick={() => {
              setActive('custom');
              setShowCalendar(true);
            }}
          >
            <span className={s.customChipIcon}>
              <CalendarDays size={15} />
            </span>
            <div className={s.customChipBody}>
              <div className={s.customChipTitle}>{formatSnoozeDate(customDate)}</div>
              <div className={s.customChipSub}>Custom date · Tap to edit</div>
            </div>
          </button>
        ) : (
          <button
            type="button"
            className={s.customDashed}
            data-testid="snooze-custom-btn"
            onClick={() => {
              setActive('custom');
              setShowCalendar(true);
            }}
          >
            <CalendarDays size={14} />
            Pick a date…
          </button>
        )}
      </div>

      {snoozed && (
        <Button variant="outline" size="lg" onClick={onWake} className="m-2" data-testid="snooze-wake-btn">
          <AlarmClockOff size={16} />
          Wake now
        </Button>
      )}

      <div className={s.footerRow}>
        <Button variant="ghost" size="sm" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleCommit}
          disabled={!canCommit}
          className="flex-1"
          data-testid="snooze-commit-btn"
        >
          {commitLabel}
        </Button>
      </div>
    </div>
  );
}
