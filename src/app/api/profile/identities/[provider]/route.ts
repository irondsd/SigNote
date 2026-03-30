import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions } from '@/config/auth';
import { unlinkIdentity, LastIdentityError } from '@/controllers/identities';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { provider } = await params;

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  try {
    const deleted = await unlinkIdentity(userId, provider);
    if (!deleted) {
      return NextResponse.json({ error: 'Identity not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof LastIdentityError) {
      return NextResponse.json({ error: 'LAST_IDENTITY' }, { status: 400 });
    }
    throw err;
  }
}
