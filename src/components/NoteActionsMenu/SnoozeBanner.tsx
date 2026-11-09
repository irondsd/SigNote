'use client';

import { AlarmClock } from 'lucide-react';
import { formatSnoozeDate } from '@/lib/snooze';
import { cn } from '@/utils/cn';
import s from './SnoozeBanner.module.scss';

type SnoozeBannerProps = {
  className?: string;
  /** Set while the note is snoozed in the archive. */
  snoozedUntil?: Date | string | null;
  /** Set for the one viewing in which the note has just come back. */
  returnedFromSnooze?: Date | string | null;
};

export function SnoozeBanner({ className, snoozedUntil, returnedFromSnooze }: SnoozeBannerProps) {
  if (!snoozedUntil && !returnedFromSnooze) return null;
  return (
    <div className={cn(s.banner, className)} data-testid="snooze-banner">
      <AlarmClock size={13} />
      {snoozedUntil
        ? `Snoozed until ${formatSnoozeDate(snoozedUntil)}`
        : `Back from snooze · set for ${formatSnoozeDate(returnedFromSnooze!)}`}
    </div>
  );
}
