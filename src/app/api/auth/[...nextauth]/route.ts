import { attachDatabasePool } from '@vercel/functions';
import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';

import { authOptions } from '@/config/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

const handler = NextAuth(authOptions);

export async function GET(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  return handler(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  return handler(request, context);
}
