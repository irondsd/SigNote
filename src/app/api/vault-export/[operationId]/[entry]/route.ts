import { NextResponse } from 'next/server';

import { withSession } from '@/lib/routeAuth';
import { getVaultExportEntry } from '@/server/vaultExport/service';
import { vaultExportErrorResponse } from '@/server/vaultExport/http';

export const runtime = 'nodejs';

export const GET = withSession(async (_request, { userId, params: { operationId, entry } }) => {
  try {
    const result = await getVaultExportEntry(userId, operationId, entry);
    return new NextResponse(result.stream, {
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
