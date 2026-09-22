import { NextResponse } from 'next/server';

import { withSession } from '@/lib/routeAuth';
import { vaultImportErrorResponse } from '@/server/vaultImport/http';
import { getVaultImportService } from '@/server/vaultImport/instance';

export const runtime = 'nodejs';

/** The rest of a split record's history; see `appendHistory`. */
export const POST = withSession(async (request, { userId, sid, params: { operationId, category } }) => {
  try {
    if (!['notes', 'secrets', 'seals'].includes(category))
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const length = Number(request.headers.get('content-length') ?? '0');
    if (!Number.isSafeInteger(length) || length < 1 || length > 3_000_000)
      return NextResponse.json({ error: 'LIMIT' }, { status: 413 });
    const result = await getVaultImportService().appendHistory(
      { userId, sid },
      operationId,
      category as 'notes' | 'secrets' | 'seals',
      await request.json(),
    );
    return NextResponse.json(result);
  } catch (error) {
    return vaultImportErrorResponse(error);
  }
});
