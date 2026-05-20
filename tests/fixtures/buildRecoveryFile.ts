/**
 * Builds the JSON string for a SigNote recovery backup file.
 * Mirrors the shape produced by src/lib/recoveryBackup.ts without importing
 * app code (which uses @/ path aliases not resolved by the Playwright runner).
 */
export function buildRecoveryFile(userId: string, deviceShare: Uint8Array): string {
  const deviceShareB64 = btoa(String.fromCharCode(...deviceShare));
  return JSON.stringify(
    {
      type: 'signote-recovery',
      version: 1,
      createdAt: new Date().toISOString(),
      userId,
      deviceShare: deviceShareB64,
    },
    null,
    2,
  );
}
