import { NextRequest, NextResponse } from 'next/server';
import { cleanupDeletedFiles } from '@/controllers/files';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await cleanupDeletedFiles();

  return NextResponse.json(result);
}
