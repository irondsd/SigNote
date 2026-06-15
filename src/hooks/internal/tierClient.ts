import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { trpcClient } from '@/lib/trpcClient';

export type TierName = 'notes' | 'secrets' | 'seals';

/** The metadata fields the old polymorphic PATCH dispatched on. */
export type CommonUpdate = {
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
  pattern?: string | null;
  position?: number;
  pinned?: boolean;
  expiresAt?: string | null;
  burnAfterReading?: boolean;
  tags?: string[];
};

/**
 * Maps a polymorphic update payload onto the discrete tRPC procedures, in the
 * same precedence the server's old `handleCommonPatch` used. Returns the call
 * promise if a metadata field was present, or `null` so the caller falls
 * through to the tier-specific content `update` (title/body).
 */
export function dispatchCommonUpdate(tier: TierName, id: string, data: CommonUpdate): Promise<unknown> | null {
  const t = trpcClient[tier];

  if (typeof data.deleted === 'boolean') {
    return data.deleted ? t.delete.mutate({ id }) : t.restore.mutate({ id });
  }
  if (typeof data.archived === 'boolean') {
    return t.setArchived.mutate({ id, archived: data.archived });
  }
  if ('color' in data) {
    // Client cache holds the loose `string` color; the picker only ever yields
    // valid NoteColors, so the boundary cast is safe (server re-validates).
    return t.setColor.mutate({ id, color: (data.color ?? null) as NoteColor | null });
  }
  if ('pattern' in data) {
    return t.setPattern.mutate({ id, pattern: (data.pattern ?? null) as NotePattern | null });
  }
  if ('tags' in data) {
    return t.setTags.mutate({ id, tags: data.tags ?? [] });
  }
  if (typeof data.position === 'number') {
    return t.setPosition.mutate({ id, position: data.position });
  }

  const wantsPin = 'pinned' in data;
  const wantsExpiry = 'expiresAt' in data || 'burnAfterReading' in data;
  if (wantsPin || wantsExpiry) {
    const meta: { pinned?: boolean; expiresAt?: string | null; burnAfterReading?: boolean } = {};
    if (wantsPin) meta.pinned = data.pinned;
    if ('expiresAt' in data) meta.expiresAt = data.expiresAt ?? null;
    if ('burnAfterReading' in data) meta.burnAfterReading = data.burnAfterReading;
    return t.setMeta.mutate({ id, ...meta });
  }

  return null;
}
