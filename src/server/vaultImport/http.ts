import { NextResponse } from 'next/server';
import { VaultConflictError } from '@/db/encryptionState';
import { VaultImportError } from './service';

export function vaultImportErrorResponse(error: unknown): NextResponse {
  if (error instanceof VaultConflictError) throw error;
  if (error instanceof VaultImportError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'EXPIRED'
          ? 410
          : error.code === 'INVALID_ARCHIVE'
            ? 400
            : error.code === 'LIMIT'
              ? 413
              : 409;
    return NextResponse.json({ error: error.code }, { status });
  }
  return NextResponse.json({ error: 'VAULT_IMPORT_FAILED' }, { status: 500 });
}
