import { NextResponse } from 'next/server';

import { withSession } from '@/lib/routeAuth';
import { vaultExportErrorResponse } from '@/server/vaultExport/http';
import { getVaultExportAttachment } from '@/server/vaultExport/service';

export const runtime = 'nodejs';

export const GET = withSession(async (_request, { userId, params: { operationId, attachmentId } }) => {
  try {
    const result = await getVaultExportAttachment(userId, operationId, attachmentId);
    // @ts-expect-error -- Node Readable is accepted by the Response constructor at runtime
    return new NextResponse(result.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(result.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return vaultExportErrorResponse(error);
  }
});
