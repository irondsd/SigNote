import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { getMaterialByAddress } from '@/controllers/encryptionProfiles';
import { authOptions } from '@/config/auth';
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

  const material = await getMaterialByAddress(address);

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
