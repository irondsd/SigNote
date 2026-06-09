import { NextResponse } from 'next/server';

import { createTag, getTagUsageCounts, listTags, normalizeTagName } from '@/controllers/tags';
import { withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const GET = withSession(async (_req, { userId }) => {
  const [tags, counts] = await Promise.all([listTags(userId), getTagUsageCounts(userId)]);
  return NextResponse.json({ tags, counts });
});

export const POST = withSession(async (req, { userId }) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { name, color } = body as { name?: string; color?: string | null };

  if (!name || !normalizeTagName(name)) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
  }

  const tag = await createTag(userId, name, color);
  return NextResponse.json(tag, { status: 201 });
});
