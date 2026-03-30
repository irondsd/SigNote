import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { getUserIdentities } from '@/controllers/identities';
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

  const identities = await getUserIdentities(userId);

  return NextResponse.json(
    identities.map((id) => ({
      provider: id.provider,
      providerSubject: id.providerSubject,
      email: 'email' in id ? id.email : undefined,
      lastLoginAt: id.lastLoginAt,
    })),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
