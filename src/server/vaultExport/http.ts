import { NextResponse } from 'next/server';

import { VaultConflictError } from '@/db/encryptionState';
import { VaultExportError } from './service';

export function vaultExportErrorResponse(error: unknown): NextResponse {
  // `withSession` owns the uniform generation-conflict wire contract.
  if (error instanceof VaultConflictError) throw error;
  if (error instanceof VaultExportError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'EXPIRED'
          ? 410
          : error.code === 'INVALID_SELECTION'
            ? 400
            : error.code === 'DISABLED'
              ? 403
              : 409;
    return NextResponse.json({ error: error.code }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.json(
    { error: 'VAULT_EXPORT_FAILED' },
    { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
