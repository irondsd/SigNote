import { NextResponse } from 'next/server';

import { withSession } from '@/lib/routeAuth';
import { vaultImportErrorResponse } from '@/server/vaultImport/http';
import { getVaultImportService } from '@/server/vaultImport/instance';

export const runtime = 'nodejs';

/** Digests of what the account already holds under archived ids, for the
 * import Worker's merge comparison. */
export const POST = withSession(async (request, { userId, sid, params: { operationId } }) => {
  try {
    const length = Number(request.headers.get('content-length') ?? '0');
    if (!Number.isSafeInteger(length) || length < 1 || length > 64_000)
      return NextResponse.json({ error: 'LIMIT' }, { status: 413 });
    return NextResponse.json(await getVaultImportService().lookup({ userId, sid }, operationId, await request.json()));
  } catch (error) {
    return vaultImportErrorResponse(error);
  }
});
