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

const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes → 44-char base64
const BASE64_12 = /^[A-Za-z0-9+/]{16}$/; // 12 bytes → 16-char base64, no padding
const BASE64 = /^[A-Za-z0-9+/]+=*$/; // any non-empty base64

function validateKeyCheck(kc: unknown): string | null {
  if (!kc || typeof kc !== 'object') return 'Invalid keyCheck';
  const k = kc as Record<string, unknown>;
  if (k.alg !== 'A256GCM') return 'Invalid keyCheck.alg';
  if (!BASE64_12.test(k.iv as string)) return 'Invalid keyCheck.iv';
  if (!BASE64.test(k.ciphertext as string)) return 'Invalid keyCheck.ciphertext';
  return null;
}

function validateProfileBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Invalid body';
  const b = body as Record<string, unknown>;

  if (!BASE64_32.test(b.serverShare as string)) return 'Invalid serverShare';
  if (!BASE64_32.test(b.salt as string)) return 'Invalid salt';

  const kdf = b.kdf as Record<string, unknown>;
  if (!kdf || typeof kdf !== 'object') return 'Invalid kdf';
  if (kdf.name !== 'PBKDF2') return 'Invalid kdf.name';
  if (!['SHA-256', 'SHA-512'].includes(kdf.hash as string)) return 'Invalid kdf.hash';
  if (
    typeof kdf.iterations !== 'number' ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < 100_000
  )
    return 'kdf.iterations must be an integer ≥ 100000';
  if (typeof kdf.length !== 'number' || kdf.length <= 0) return 'Invalid kdf.length';

  return validateKeyCheck(b.keyCheck);
}

function validatePatchBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Invalid body';
  const b = body as Record<string, unknown>;

  if (!BASE64_32.test(b.serverShare as string)) return 'Invalid serverShare';
  if (!BASE64_32.test(b.salt as string)) return 'Invalid salt';

  return validateKeyCheck(b.keyCheck);
}

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

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }
  const validationError = validateProfileBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

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

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }
  const validationError = validatePatchBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { serverShare, salt, keyCheck } = body as {
    serverShare: string;
    salt: string;
    keyCheck: EncryptedPayload;
  };

  await updateProfile(userId, { serverShare, salt, keyCheck });
  return NextResponse.json({ success: true });
}
