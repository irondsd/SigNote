import { type NextRequest, NextResponse } from 'next/server';
import { MAX_SEARCH } from '@/config/constants';
import { NOTE_COLORS, NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteStyles';
import { softDeleteFilesByNoteId, restoreFilesByNoteId } from '@/controllers/files';
import { getOwnedTagIds } from '@/controllers/tags';

export function parseListParams(req: NextRequest) {
  const archivedParam = req.nextUrl.searchParams.get('archived');
  const archived = archivedParam === null ? undefined : archivedParam === 'true';
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30));
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, MAX_SEARCH);
  const tagsParam = req.nextUrl.searchParams.get('tags');
  const tagIds = tagsParam
    ? tagsParam
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;
  const tagMode: 'or' | 'and' = req.nextUrl.searchParams.get('tagMode') === 'and' ? 'and' : 'or';
  return { archived, limit, offset, search, tagIds, tagMode };
}

type PinExpiryUpdate = {
  pinned?: boolean;
  expiresAt?: Date | null;
  burnAfterReading?: boolean;
};

type CommonOps = {
  softDelete: (id: string) => Promise<unknown>;
  restore: (id: string) => Promise<unknown>;
  archive: (id: string) => Promise<unknown>;
  unarchive: (id: string) => Promise<unknown>;
  updateColor: (id: string, color: string | null) => Promise<unknown>;
  updatePattern: (id: string, pattern: string | null) => Promise<unknown>;
  updatePosition: (id: string, position: number) => Promise<unknown>;
  updateTags: (id: string, tags: string[]) => Promise<unknown>;
  applyPatch: (id: string, update: PinExpiryUpdate) => Promise<unknown>;
};

type PatchResult = { handled: true; response: NextResponse } | { handled: true; updated: unknown } | { handled: false };

export async function handleCommonPatch(
  id: string,
  userId: string,
  body: Record<string, unknown>,
  ops: CommonOps,
): Promise<PatchResult> {
  const { deleted, archived, color, pattern, position, pinned, expiresAt, burnAfterReading, tags } = body;

  if (typeof deleted === 'boolean') {
    let updated;
    if (deleted) {
      updated = await ops.softDelete(id);
      await softDeleteFilesByNoteId(id);
    } else {
      updated = await ops.restore(id);
      await restoreFilesByNoteId(id, userId);
    }
    return { handled: true, updated };
  }

  if (typeof archived === 'boolean') {
    const updated = archived ? await ops.archive(id) : await ops.unarchive(id);
    return { handled: true, updated };
  }

  if ('color' in body) {
    if (color !== null && !NOTE_COLORS.includes(color as NoteColor)) {
      return { handled: true, response: NextResponse.json({ error: 'Invalid color' }, { status: 400 }) };
    }
    const updated = await ops.updateColor(id, (color as string) ?? null);
    return { handled: true, updated };
  }

  if ('pattern' in body) {
    if (pattern !== null && !NOTE_PATTERNS.includes(pattern as NotePattern)) {
      return { handled: true, response: NextResponse.json({ error: 'Invalid pattern' }, { status: 400 }) };
    }
    const updated = await ops.updatePattern(id, (pattern as string) ?? null);
    return { handled: true, updated };
  }

  if ('tags' in body) {
    if (!Array.isArray(tags)) {
      return { handled: true, response: NextResponse.json({ error: 'Invalid tags' }, { status: 400 }) };
    }
    // Drop ids the user doesn't own (foreign / deleted) before persisting.
    const ownedTagIds = await getOwnedTagIds(
      userId,
      tags.filter((t): t is string => typeof t === 'string'),
    );
    const updated = await ops.updateTags(id, ownedTagIds);
    return { handled: true, updated };
  }

  if (typeof position === 'number') {
    if (!Number.isFinite(position)) {
      return { handled: true, response: NextResponse.json({ error: 'Invalid position' }, { status: 400 }) };
    }
    const updated = await ops.updatePosition(id, position);
    return { handled: true, updated };
  }

  // Pin / expiry / burn collapse into a single applyPatch so a caller can
  // touch any combination in one request. Mutual-exclusion rule: turning
  // burnAfterReading on clears expiresAt and vice versa.
  const wantsPin = 'pinned' in body;
  const wantsExpiry = 'expiresAt' in body || 'burnAfterReading' in body;
  if (wantsPin || wantsExpiry) {
    const update: PinExpiryUpdate = {};

    if (wantsPin) {
      if (typeof pinned !== 'boolean') {
        return { handled: true, response: NextResponse.json({ error: 'pinned must be boolean' }, { status: 400 }) };
      }
      update.pinned = pinned;
    }

    if (wantsExpiry) {
      const hasBurn = 'burnAfterReading' in body;
      const hasExpiry = 'expiresAt' in body;

      if (hasBurn && typeof burnAfterReading !== 'boolean') {
        return {
          handled: true,
          response: NextResponse.json({ error: 'burnAfterReading must be boolean' }, { status: 400 }),
        };
      }

      let parsedExpiry: Date | null = null;
      if (hasExpiry && expiresAt !== null && expiresAt !== undefined) {
        const d = new Date(expiresAt as string);
        if (Number.isNaN(d.getTime())) {
          return { handled: true, response: NextResponse.json({ error: 'Invalid expiresAt' }, { status: 400 }) };
        }
        parsedExpiry = d;
      }
      const burnValue = burnAfterReading === true;

      // Mutex applies only to partial updates (one field without the other).
      // When both fields are explicit, trust the caller — this is the arming
      // path (sends expiresAt=now AND burnAfterReading=true) and the picker
      // (always sends both fields together).
      if (hasBurn && hasExpiry) {
        update.burnAfterReading = burnValue;
        update.expiresAt = parsedExpiry;
      } else if (hasBurn) {
        update.burnAfterReading = burnValue;
        if (burnValue) update.expiresAt = null;
      } else {
        // hasExpiry only
        update.expiresAt = parsedExpiry;
        if (parsedExpiry) update.burnAfterReading = false;
      }
    }

    const updated = await ops.applyPatch(id, update);
    return { handled: true, updated };
  }

  return { handled: false };
}
