import { type NextRequest, NextResponse } from 'next/server';
import { MAX_SEARCH } from '@/config/constants';
import { NOTE_COLORS, NOTE_PATTERNS, type NoteColor, type NotePattern } from '@/config/noteStyles';
import { softDeleteFilesByNoteId, restoreFilesByNoteId } from '@/controllers/files';

export function parseListParams(req: NextRequest) {
  const archivedParam = req.nextUrl.searchParams.get('archived');
  const archived = archivedParam === null ? undefined : archivedParam === 'true';
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30));
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const search = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, MAX_SEARCH);
  return { archived, limit, offset, search };
}

type CommonOps = {
  softDelete: (id: string) => Promise<unknown>;
  restore: (id: string) => Promise<unknown>;
  archive: (id: string) => Promise<unknown>;
  unarchive: (id: string) => Promise<unknown>;
  updateColor: (id: string, color: string | null) => Promise<unknown>;
  updatePattern: (id: string, pattern: string | null) => Promise<unknown>;
  updatePosition: (id: string, position: number) => Promise<unknown>;
};

type PatchResult =
  | { handled: true; response: NextResponse }
  | { handled: true; updated: unknown }
  | { handled: false };

export async function handleCommonPatch(
  id: string,
  userId: string,
  body: Record<string, unknown>,
  ops: CommonOps,
): Promise<PatchResult> {
  const { deleted, archived, color, pattern, position } = body;

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

  if (typeof position === 'number') {
    if (!Number.isFinite(position)) {
      return { handled: true, response: NextResponse.json({ error: 'Invalid position' }, { status: 400 }) };
    }
    const updated = await ops.updatePosition(id, position);
    return { handled: true, updated };
  }

  return { handled: false };
}
