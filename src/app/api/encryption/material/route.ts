import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { getMaterialByUserId } from '@/controllers/encryptionProfiles';
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

  const material = await getMaterialByUserId(userId);

  if (!material) {
    return NextResponse.json({ error: 'Encryption profile not found' }, { status: 404 });
  }

  return NextResponse.json(
    {
      version: material.version,
      serverShare: material.serverShare,
      salt: material.salt,
      kdf: material.kdf,
      keyCheck: material.keyCheck,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
