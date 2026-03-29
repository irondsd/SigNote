import { attachDatabasePool } from '@vercel/functions';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import {
  createProfile,
  getProfileByUserId,
  ProfileAlreadyExistsError,
  updateProfile,
} from '@/controllers/encryptionProfiles';
import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';
import { type EncryptedPayload, type KdfParams } from '@/types/crypto';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const profile = await getProfileByUserId(userId);

  if (!profile) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    version: profile.version,
    salt: profile.salt,
    kdf: profile.kdf,
    keyCheck: profile.keyCheck,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const body = await req.json();
  const { version, serverShare, salt, kdf, keyCheck } = body as {
    version: number;
    serverShare: string;
    salt: string;
    kdf: KdfParams;
    keyCheck: EncryptedPayload;
  };

  try {
    const profile = await createProfile(userId, { version, serverShare, salt, kdf, keyCheck });
    return NextResponse.json({ success: true, version: profile.version }, { status: 201 });
  } catch (err) {
    if (err instanceof ProfileAlreadyExistsError) {
      return NextResponse.json({ error: 'Encryption profile already exists' }, { status: 409 });
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  const body = await req.json();
  const { serverShare, salt, keyCheck } = body as {
    serverShare: string;
    salt: string;
    keyCheck: EncryptedPayload;
  };

  await updateProfile(userId, { serverShare, salt, keyCheck });
  return NextResponse.json({ success: true });
}
