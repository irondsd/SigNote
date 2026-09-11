import { NextRequest, NextResponse } from 'next/server';
import { getRotationService } from '@/server/rotation/instance';
import { safeBearerMatch } from '../cronAuth';

export const runtime = 'nodejs';

/**
 * Object reclamation for key rotation, on its own schedule.
 *
 * `/api/service/storage` also drains this queue, but once a day is the wrong
 * clock for it: one rotation of a file-heavy vault emits one delete task per
 * attachment, and an account's temporary-storage reservation is only released
 * when the corresponding task completes. A user who cancels a rotation would
 * otherwise wait until the next midnight before they could start another one.
 *
 * The pass is idempotent and holds the same account fence as every other
 * writer, so running it hourly alongside the daily sweep costs nothing when
 * there is no work.
 */
export async function GET(req: NextRequest) {
  if (!safeBearerMatch(req.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rotation = await getRotationService().cleanup();

  return NextResponse.json({ rotation }, { headers: { 'Cache-Control': 'private, no-store' } });
}
