import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { getProfileData } from '@/controllers/profile';
import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const profile = await getProfileData(userId);

  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(profile, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
