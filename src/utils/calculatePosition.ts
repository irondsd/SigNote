import { type Model } from 'mongoose';

import { POSITION_STEP } from '@/config/constants';

/**
 * Calculate the new position for a note dropped between two neighbors.
 * Notes are sorted descending (highest position = first in list).
 * @param above - position of the note above (higher value), or null if dropping at top
 * @param below - position of the note below (lower value), or null if dropping at bottom
 */
export function calculatePosition(above: number | null, below: number | null): number {
  if (above === null && below === null) {
    return POSITION_STEP;
  }
  if (above === null) {
    return below! + POSITION_STEP;
  }
  if (below === null) {
    return above / 2;
  }
  return (above + below) / 2;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getNextPosition(Model: Model<any>, userId: string): Promise<number> {
  const last = await Model.findOne({ userId, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();
  return (last?.position ?? 0) + POSITION_STEP;
}
