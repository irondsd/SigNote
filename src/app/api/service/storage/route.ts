import { NextRequest, NextResponse } from 'next/server';
import { cleanupDeletedFiles, cleanupOrphanedFiles } from '@/controllers/files';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 1: soft-delete files whose parent note has been TTL-deleted
  // (self-destruct timer fired). They flow into the same S3 cleanup queue.
  const orphans = await cleanupOrphanedFiles();

  // Step 2: delete S3 objects for soft-deleted files
  const storage = await cleanupDeletedFiles();

  return NextResponse.json({ orphans, storage });
}
