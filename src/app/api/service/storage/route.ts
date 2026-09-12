import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpiredRows } from '@/controllers/cleanup';
import { cleanupDeletedFiles, cleanupOrphanedFiles } from '@/controllers/files';
import { getRotationService } from '@/server/rotation/instance';
import { safeBearerMatch } from '../cronAuth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!safeBearerMatch(req.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve abandoned operations before ordinary purge catches up. Committed
  // object cleanup is retryable and never reverses activation.
  const rotation = await getRotationService().cleanup();

  // Step 1: reap rows past their expiry. Must run first, because step 2
  // detects an orphan by its parent note being gone.
  const expired = await cleanupExpiredRows();

  // Step 2: soft-delete files whose parent note has been reaped (self-destruct
  // timer fired). They flow into the same S3 cleanup queue.
  const orphans = await cleanupOrphanedFiles();

  // Step 3: delete S3 objects for soft-deleted files
  const storage = await cleanupDeletedFiles();

  return NextResponse.json(
    { expired, orphans, storage, rotation },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
