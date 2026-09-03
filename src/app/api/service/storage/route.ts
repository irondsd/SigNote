import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cleanupExpiredRows } from '@/controllers/cleanup';
import { cleanupDeletedFiles, cleanupOrphanedFiles } from '@/controllers/files';

export const runtime = 'nodejs';

function safeBearerMatch(authHeader: string | null, secret: string | undefined): boolean {
  if (!authHeader || !secret) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!safeBearerMatch(req.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 1: reap rows past their expiry. Postgres has no TTL index, so this
  // stands in for the ones the Mongo models declared — and it must run first,
  // because step 2 detects an orphan by its parent note being gone.
  const expired = await cleanupExpiredRows();

  // Step 2: soft-delete files whose parent note has been reaped (self-destruct
  // timer fired). They flow into the same S3 cleanup queue.
  const orphans = await cleanupOrphanedFiles();

  // Step 3: delete S3 objects for soft-deleted files
  const storage = await cleanupDeletedFiles();

  return NextResponse.json({ expired, orphans, storage });
}
