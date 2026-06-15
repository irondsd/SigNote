import { z } from 'zod';

import { objectId } from '@/server/schemas/common';

// Pure pin/expiry/burn logic, kept free of the trpc/db import chain so it can be
// unit-tested in isolation. Consumed by `_commonTier.ts`'s `setMeta` procedure.

export const metaInput = z
  .object({
    id: objectId,
    pinned: z.boolean().optional(),
    // null clears the expiry; a Date/ISO-string arms it. Omitted = leave
    // unchanged. `z.null()` MUST come first: `z.coerce.date()` would otherwise
    // coerce `null` → `new Date(null)` (epoch), silently arming a past expiry.
    expiresAt: z.union([z.null(), z.coerce.date()]).optional(),
    burnAfterReading: z.boolean().optional(),
  })
  .refine((d) => d.pinned !== undefined || d.expiresAt !== undefined || d.burnAfterReading !== undefined, {
    message: 'Nothing to update',
  });

export type MetaUpdate = { pinned?: boolean; expiresAt?: Date | null; burnAfterReading?: boolean };

/**
 * Pin / expiry / burn mutex. Rule (preserved from the old REST
 * `handleCommonPatch`): turning burnAfterReading on clears expiresAt and vice
 * versa, EXCEPT when both fields are sent explicitly (the arming path), where
 * the caller's values win.
 */
export function resolveMetaUpdate(input: MetaUpdate): MetaUpdate {
  const update: MetaUpdate = {};

  if (input.pinned !== undefined) update.pinned = input.pinned;

  const hasBurn = input.burnAfterReading !== undefined;
  const hasExpiry = input.expiresAt !== undefined;
  if (hasBurn || hasExpiry) {
    const burnValue = input.burnAfterReading === true;
    const parsedExpiry = hasExpiry ? (input.expiresAt as Date | null) : null;

    if (hasBurn && hasExpiry) {
      update.burnAfterReading = burnValue;
      update.expiresAt = parsedExpiry;
    } else if (hasBurn) {
      update.burnAfterReading = burnValue;
      if (burnValue) update.expiresAt = null;
    } else {
      update.expiresAt = parsedExpiry;
      if (parsedExpiry) update.burnAfterReading = false;
    }
  }

  return update;
}
