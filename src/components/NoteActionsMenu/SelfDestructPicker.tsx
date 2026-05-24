'use client';

import { useState } from 'react';
import { ArrowLeft, Ban, Clock, Eye, Flame, Hourglass } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import s from './SelfDestructPicker.module.scss';
import { cn } from '@/utils/cn';

type PresetId = '1h' | '24h' | '7d' | '30d' | 'custom';

const PRESET_MS: Record<Exclude<PresetId, 'custom'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const PRESETS: { id: Exclude<PresetId, 'custom'>; label: string }[] = [
  { id: '1h', label: '1 hour' },
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
];

type SelfDestructPickerProps = {
  expiresAt: Date | null;
  burnAfterReading: boolean;
  onBack: () => void;
  onCommit: (next: { expiresAt: Date | null; burnAfterReading: boolean }) => void;
  onRemove: () => void;
  onCancel: () => void;
};

function toTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function SelfDestructPicker({
  expiresAt,
  burnAfterReading,
  onBack,
  onCommit,
  onRemove,
  onCancel,
}: SelfDestructPickerProps) {
  const armed = expiresAt !== null || burnAfterReading;
  const [active, setActive] = useState<PresetId | null>(armed && !burnAfterReading ? 'custom' : null);
  const [customDate, setCustomDate] = useState<Date | undefined>(expiresAt ?? undefined);
  const [customTime, setCustomTime] = useState<string>(expiresAt ? toTimeString(expiresAt) : toTimeString(new Date()));
  const [burn, setBurn] = useState<boolean>(burnAfterReading);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);

  const buildCustomDate = (): Date | null => {
    if (!customDate) return null;
    const [hh, mm] = customTime.split(':').map(Number);
    const d = new Date(customDate);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d;
  };

  /**
   * Pure during render: decide whether Save should be enabled.
   * - Presets always count as a change (they produce a fresh "now + N" timestamp).
   * - Burn toggle counts as a change iff it differs from initial.
   * - Custom counts as a change iff the resulting datetime differs from initial.
   * - "Nothing selected" counts as a change iff there's an initial timer to clear.
   */
  const canCommit = (() => {
    if (burn) return !burnAfterReading; // turning burn on
    // burn is off
    if (burnAfterReading) return true; // turning burn off → always a change
    if (active && active !== 'custom') return true; // any preset = new timer
    if (active === 'custom') {
      const d = buildCustomDate();
      if (!d) return false;
      return d.getTime() !== (expiresAt?.getTime() ?? -1);
    }
    // active is null, burn is off
    return expiresAt !== null; // change iff we're clearing an existing timer
  })();

  const handleCommit = () => {
    if (burn) {
      onCommit({ expiresAt: null, burnAfterReading: true });
      return;
    }
    if (active && active !== 'custom') {
      onCommit({ expiresAt: new Date(Date.now() + PRESET_MS[active]), burnAfterReading: false });
      return;
    }
    if (active === 'custom') {
      const d = buildCustomDate();
      if (d) onCommit({ expiresAt: d, burnAfterReading: false });
      return;
    }
    // Nothing selected → clear any existing timer.
    onCommit({ expiresAt: null, burnAfterReading: false });
  };

  const handleCommitCustom = () => {
    const d = buildCustomDate();
    if (!d) return;
    onCommit({ expiresAt: d, burnAfterReading: false });
  };

  const customLabelDate = customDate
    ? customDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const customLabelTime = (() => {
    const d = buildCustomDate();
    return d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  })();

  // Calendar-exclusive view: only calendar + time input + Back/Set buttons.
  if (showCalendar) {
    return (
      <div className={s.menu}>
        <div className={s.subHeader}>
          <div className={s.subTitle}>
            <Flame size={13} />
            Pick date &amp; time
          </div>
        </div>

        <div className={s.calendarRow}>
          <Calendar
            mode="single"
            selected={customDate}
            onSelect={(d) => {
              setCustomDate(d ?? undefined);
              if (!d) return;
              // If the picked day is today and the current time string would
              // land in the past, bump it forward to "now".
              const [hh, mm] = customTime.split(':').map(Number);
              const candidate = new Date(d);
              candidate.setHours(hh || 0, mm || 0, 0, 0);
              const now = new Date();
              if (isSameDay(d, now) && candidate.getTime() <= now.getTime()) {
                setCustomTime(toTimeString(now));
              }
            }}
            disabled={{ before: new Date() }}
          />
          <InputGroup>
            <InputGroupInput
              type="time"
              step="60"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              aria-label="Time"
              className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
            <InputGroupAddon>
              <Clock className="text-muted-foreground" />
            </InputGroupAddon>
          </InputGroup>
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
          <Button size="sm" onClick={handleCommitCustom} disabled={!customDate} className="flex-1">
            {armed ? 'Update timer' : 'Set timer'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.menu}>
      <div className={s.subHeader}>
        <button type="button" className={s.subBack} onClick={onBack} aria-label="Back">
          <ArrowLeft size={14} />
        </button>
        <div className={s.subTitle}>
          <Flame size={13} />
          Self-destruct timer
        </div>
      </div>

      {!armed && (
        <div className={s.subBlurb}>
          After the timer expires, this note will be permanently deleted from all devices.
        </div>
      )}

      <div className={s.sectionLabel}>{armed ? 'Change to' : 'Pick a preset'}</div>

      <div className={s.presetGrid}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={s.preset}
            data-active={active === p.id && !burn}
            onClick={() => {
              setActive(p.id);
              setBurn(false);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={s.customRow}>
        {customDate && !burn ? (
          <button
            type="button"
            className={cn(s.customChip, active !== 'custom' && s.inactive)}
            onClick={() => {
              setActive('custom');
              setShowCalendar(true);
            }}
          >
            <span className={s.customChipIcon}>
              <Hourglass size={15} />
            </span>
            <div className={s.customChipBody}>
              <div className={s.customChipTitle}>
                {customLabelDate} · {customLabelTime}
              </div>
              <div className={s.customChipSub}>Custom date &amp; time · Tap to edit</div>
            </div>
          </button>
        ) : (
          <button
            type="button"
            className={s.customDashed}
            onClick={() => {
              setActive('custom');
              setBurn(false);
              setShowCalendar(true);
            }}
          >
            <Hourglass size={14} />
            Custom date &amp; time…
          </button>
        )}
      </div>

      <div className={s.divider} />

      <label className={s.burnRow} data-on={burn}>
        <span className={s.burnIcon}>
          <Eye size={16} />
        </span>
        <span className={s.burnLabel}>
          <span>Burn after reading</span>
          <span className={s.burnHint}>Delete the moment it&apos;s opened</span>
        </span>
        <Switch
          checked={burn}
          onCheckedChange={(next) => {
            setBurn(next);
            if (next) setActive(null);
          }}
          aria-label="Burn after reading"
        />
      </label>

      {armed && (
        <Button variant="destructive" size="lg" onClick={onRemove} className="m-2">
          <Ban size={16} />
          Turn off self-destruct
        </Button>
      )}

      <div className={s.footerRow}>
        <Button variant="ghost" size="sm" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button size="sm" onClick={handleCommit} disabled={!canCommit} className="flex-1">
          {armed ? 'Update timer' : 'Set timer'}
        </Button>
      </div>
    </div>
  );
}
