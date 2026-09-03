import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';

import { authOptions } from '@/config/auth';

export const runtime = 'nodejs';

const handler = NextAuth(authOptions);

export async function GET(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return handler(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return handler(request, context);
}
