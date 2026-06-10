import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import {
  deleteTagAndDetach,
  getTagById,
  isDuplicateKeyError,
  isValidTagColor,
  normalizeTagName,
  tagNameTaken,
  updateTag,
} from '@/controllers/tags';
import type { TagColor } from '@/config/noteStyles';
import { assertOwner, RouteAuthError, withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const PATCH = withSession(async (req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getTagById(id), userId);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { name, color } = body as { name?: string; color?: string };

  const patch: { name?: string; color?: TagColor } = {};

  if (name !== undefined) {
    const normalized = normalizeTagName(name);
    if (!normalized) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    if (await tagNameTaken(userId, normalized, id)) {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 });
    }
    patch.name = normalized;
  }

  if (color !== undefined) {
    if (!isValidTagColor(color)) return NextResponse.json({ error: 'Invalid color' }, { status: 400 });
    patch.color = color;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    const updated = await updateTag(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    // A concurrent rename can win the uniqueness race after the tagNameTaken check.
    if (isDuplicateKeyError(err)) {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 });
    }
    throw err;
  }
});

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getTagById(id), userId);

  await deleteTagAndDetach(id);
  return NextResponse.json({ success: true });
});
