import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import {
  deleteTagAndDetach,
  getTagById,
  isValidTagColor,
  normalizeTagName,
  recolorTag,
  renameTag,
  tagNameTaken,
} from '@/controllers/tags';
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

  if (name !== undefined) {
    const normalized = normalizeTagName(name);
    if (!normalized) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    if (await tagNameTaken(userId, normalized, id)) {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 });
    }
    const updated = await renameTag(id, normalized);
    return NextResponse.json(updated);
  }

  if (color !== undefined) {
    if (!isValidTagColor(color)) return NextResponse.json({ error: 'Invalid color' }, { status: 400 });
    const updated = await recolorTag(id, color);
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
});

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');
  assertOwner(await getTagById(id), userId);

  await deleteTagAndDetach(id);
  return NextResponse.json({ success: true });
});
