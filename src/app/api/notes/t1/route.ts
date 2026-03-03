import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { getNotesByAddress } from '@/controllers/notes';
import { authOptions } from '@/utils/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  const address = session?.user?.address;

  if (!address) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const notes = await getNotesByAddress(address);

  return NextResponse.json(notes);
}
