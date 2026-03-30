import { attachDatabasePool } from '@vercel/functions';
import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

import { linkIdentity, ConflictEncryptedDataError, AlreadyLinkedError } from '@/controllers/identities';
import { getMongoClientFromMongoose } from '@/utils/mongoose';
import { getRedirectUri } from '../initiate/route';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(buildProfileUrl('link_error=cancelled'));
  }

  const secret = process.env.NEXTAUTH_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!secret || !clientId || !clientSecret) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  // Verify state JWT
  let userId: string;
  try {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(secret));
    userId = payload.userId as string;
    if (!userId) throw new Error('No userId in state');
  } catch {
    return NextResponse.redirect(buildProfileUrl('link_error=invalid_state'));
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  // Fetch user info
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  const userInfo = (await userInfoRes.json()) as {
    id: string;
    email?: string;
    verified_email?: boolean;
    name?: string;
    picture?: string;
  };

  if (!userInfo.id) {
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }

  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  try {
    await linkIdentity(userId, 'google', userInfo.id, {
      email: userInfo.email,
      emailVerified: userInfo.verified_email,
      rawProfileJson: { displayName: userInfo.name, image: userInfo.picture },
    });
    return NextResponse.redirect(buildProfileUrl('linked=google'));
  } catch (err) {
    if (err instanceof ConflictEncryptedDataError) {
      return NextResponse.redirect(buildProfileUrl('link_error=encrypted_data'));
    }
    if (err instanceof AlreadyLinkedError) {
      return NextResponse.redirect(buildProfileUrl('link_error=already_linked'));
    }
    return NextResponse.redirect(buildProfileUrl('link_error=server_error'));
  }
}

function buildProfileUrl(query: string) {
  const base =
    process.env.NEXTAUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5000');
  return `${base}/profile?${query}`;
}
