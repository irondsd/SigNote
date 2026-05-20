import { fromBase64, toBase64 } from '@/lib/crypto';

export const RECOVERY_BACKUP_TYPE = 'signote-recovery';
export const RECOVERY_BACKUP_VERSION = 1;

export type RecoveryBackup = {
  type: typeof RECOVERY_BACKUP_TYPE;
  version: number;
  createdAt: string;
  userId: string;
  deviceShare: string;
};

export type ParseResult =
  | { ok: true; backup: RecoveryBackup }
  | { ok: false; reason: 'not-json' | 'wrong-type' | 'unsupported-version' | 'malformed' };

export function buildBackup(userId: string, deviceShare: Uint8Array): RecoveryBackup {
  if (deviceShare.length !== 32) throw new Error('deviceShare must be 32 bytes');
  return {
    type: RECOVERY_BACKUP_TYPE,
    version: RECOVERY_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    userId,
    deviceShare: toBase64(deviceShare),
  };
}

export function backupFilename(userId: string, date: Date = new Date()): string {
  const idShort = userId.slice(0, 6);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `signote-recovery-${idShort}-${yyyy}-${mm}-${dd}.json`;
}

export function parseBackupText(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }

  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'malformed' };
  const obj = parsed as Record<string, unknown>;

  if (obj.type !== RECOVERY_BACKUP_TYPE) return { ok: false, reason: 'wrong-type' };
  if (typeof obj.version !== 'number') return { ok: false, reason: 'malformed' };
  if (obj.version > RECOVERY_BACKUP_VERSION) return { ok: false, reason: 'unsupported-version' };
  if (typeof obj.userId !== 'string' || !obj.userId) return { ok: false, reason: 'malformed' };
  if (typeof obj.deviceShare !== 'string') return { ok: false, reason: 'malformed' };
  if (typeof obj.createdAt !== 'string') return { ok: false, reason: 'malformed' };

  let bytes: Uint8Array;
  try {
    bytes = fromBase64(obj.deviceShare);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (bytes.length !== 32) return { ok: false, reason: 'malformed' };

  return {
    ok: true,
    backup: {
      type: RECOVERY_BACKUP_TYPE,
      version: obj.version,
      createdAt: obj.createdAt,
      userId: obj.userId,
      deviceShare: obj.deviceShare,
    },
  };
}

export function decodeDeviceShare(backup: RecoveryBackup): Uint8Array<ArrayBuffer> {
  return fromBase64(backup.deviceShare);
}
