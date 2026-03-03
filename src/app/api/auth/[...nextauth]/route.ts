import { attachDatabasePool } from '@vercel/functions';
import NextAuth from 'next-auth';

import { authOptions } from '@/lib/auth';
import { getMongoClientFromMongoose } from '@/utils/mongoose';

export const runtime = 'nodejs';

const handler = NextAuth(authOptions);

export async function GET(request: Request, context: { params: { nextauth: string[] } }) {
  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  return handler(request, context);
}

export async function POST(request: Request, context: { params: { nextauth: string[] } }) {
  const client = await getMongoClientFromMongoose();
  attachDatabasePool(client);

  return handler(request, context);
}
