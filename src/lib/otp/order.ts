/**
 * Ordering rules for the authenticator list.
 *
 * Pure and dependency-free so the ordering can be tested on its own — it is
 * subtle enough to have been wrong once already.
 */

import { POSITION_STEP } from '@/config/constants';

type Positioned = { id: string; position: number };

/**
 * Descending by position, exactly like the note tiers (`desc(cols.position)` in
 * db/tier.ts), which is also the order `calculatePosition` is written for.
 *
 * The id tiebreak makes the comparator **total**. `Array.prototype.sort` is
 * stable, so a comparator that returns 0 for two records leaves them in
 * whatever order the input array happened to have — and any update that
 * rebuilt that array then appeared to move the card. Ids are UUIDv7, so the
 * newer of two tied records sorts first.
 */
export function compareAuthRecords(a: Positioned, b: Positioned): number {
  if (a.position !== b.position) return b.position - a.position;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * The position a new credential takes: above everything, mirroring
 * `getNextPosition` in db/tier.ts.
 */
export function nextAuthPosition(records: Positioned[]): number {
  const highest = records.reduce((max, r) => Math.max(max, r.position), Number.NEGATIVE_INFINITY);
  return Number.isFinite(highest) ? highest + POSITION_STEP : POSITION_STEP;
}

/**
 * True when a midpoint cannot separate the two neighbours it was computed from
 * — they have collided, or bisection has reached the floating-point floor. The
 * caller renumbers the whole list instead of writing a value that would not
 * move the card.
 */
export function isDegeneratePosition(position: number, above: number | null, below: number | null): boolean {
  if (!Number.isFinite(position)) return true;
  if (above !== null && position >= above) return true;
  if (below !== null && position <= below) return true;
  return false;
}

/** Evenly spaced, descending positions for a list being renumbered. */
export function renumberPositions<T extends { id: string }>(ordered: T[]): { id: string; position: number }[] {
  return ordered.map((record, i) => ({ id: record.id, position: (ordered.length - i) * POSITION_STEP }));
}
