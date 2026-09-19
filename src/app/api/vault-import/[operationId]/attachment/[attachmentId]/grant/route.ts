import { NextResponse } from 'next/server';

import { withSession } from '@/lib/routeAuth';
import { vaultImportErrorResponse } from '@/server/vaultImport/http';
import { getVaultImportService } from '@/server/vaultImport/instance';

export const runtime = 'nodejs';

export const POST = withSession(async (_request, { userId, sid, params: { operationId, attachmentId } }) => {
  try {
    return NextResponse.json(await getVaultImportService().attachmentGrant({ userId, sid }, operationId, attachmentId));
  } catch (error) {
    return vaultImportErrorResponse(error);
  }
});
