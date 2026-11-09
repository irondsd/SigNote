/**
 * Snooze state, derived from the two fields the server stores (see
 * `snoozedUntil` in `src/db/schema.ts`). A snoozed note is `archived` with a
 * date; once the date passes it lists among the active notes again while still
 * `archived` in storage, until it is opened. So `archived` alone no longer says
 * which list a note belongs to — `isInArchive` does, and it must stay in step
 * with the `list` filter in `src/db/tier.ts`.
 */
export type Snoozable = { archived: boolean; snoozedUntil?: string | Date | null };

const time = (value: string | Date) => new Date(value).getTime();

/** Back from a snooze and not opened yet. */
export function isSnoozeDue(item: Snoozable, now: number = Date.now()): boolean {
  return item.archived && !!item.snoozedUntil && time(item.snoozedUntil) <= now;
}

/** Tucked away in the archive, waiting for its date. */
export function isSnoozed(item: Snoozable, now: number = Date.now()): boolean {
  return item.archived && !!item.snoozedUntil && time(item.snoozedUntil) > now;
}

/** Whether the note lists under Archive rather than among the active notes. */
export function isInArchive(item: Snoozable, now: number = Date.now()): boolean {
  return item.archived && !isSnoozeDue(item, now);
}

/** "Fri, Dec 25" — with the year once it isn't this one. */
export function formatSnoozeDate(value: string | Date): string {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}
