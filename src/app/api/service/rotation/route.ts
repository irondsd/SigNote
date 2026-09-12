import { NextRequest, NextResponse } from 'next/server';
import { getRotationService } from '@/server/rotation/instance';
import { safeBearerMatch } from '../cronAuth';

export const runtime = 'nodejs';

/**
 * Object reclamation for key rotation, on its own schedule.
 *
 * **Not in `vercel.json`.** `/api/service/storage` already drains this queue as
 * its first step, and this project's hosting plan allows only daily crons — so
 * a second daily entry would be the same work at the same minute, for one of
 * the two scheduled slots the plan permits. This route exists for deployments
 * that *can* run it more often: the pass is idempotent and takes the same
 * account fence as every other writer, so a self-hosted hourly schedule costs
 * nothing when there is no work.
 *
 * Finer scheduling is an optimisation, not a requirement. What a once-a-day
 * sweep would otherwise strand is an account's temporary-storage reservation,
 * which is only released when the corresponding object is deleted — and
 * `rotation.begin` reclaims that account's own eligible objects itself, so a
 * retry is never refused for the leftovers of the attempt it is replacing.
 */
export async function GET(req: NextRequest) {
  if (!safeBearerMatch(req.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rotation = await getRotationService().cleanup();

  return NextResponse.json({ rotation }, { headers: { 'Cache-Control': 'private, no-store' } });
}
