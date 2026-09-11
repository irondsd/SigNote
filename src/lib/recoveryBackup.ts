import { fromBase64, toBase64 } from '@/lib/crypto';

export const RECOVERY_BACKUP_TYPE = 'signote-recovery';

/**
 * The legacy recovery file format. Keep this writer because the existing
 * backup page still creates files that the current recovery page must read.
 */
export const RECOVERY_BACKUP_VERSION = 1 as const;

/** A recovery file made for a not-yet-committed rotation operation. */
export const ROTATION_RECOVERY_BACKUP_VERSION = 2 as const;

/** Generations are opaque to this module, but must remain exactly bound. */
export type RecoveryGeneration = number | string;

export type RecoveryBackupV1 = {
  type: typeof RECOVERY_BACKUP_TYPE;
  version: typeof RECOVERY_BACKUP_VERSION;
  createdAt: string;
  userId: string;
  deviceShare: string;
};

export type RecoveryBackupV2 = {
  type: typeof RECOVERY_BACKUP_TYPE;
  version: typeof ROTATION_RECOVERY_BACKUP_VERSION;
  createdAt: string;
  userId: string;
  profileId: string;
  generation: RecoveryGeneration;
  operationId: string;
  /** A v2 file is valid only as the pending file for its bound operation. */
  pending: true;
  deviceShare: string;
};

export type RecoveryBackup = RecoveryBackupV1 | RecoveryBackupV2;

export type ParseResult =
  | { ok: true; backup: RecoveryBackup }
  | { ok: false; reason: 'not-json' | 'wrong-type' | 'unsupported-version' | 'malformed' };

export type RotationBackupInput = {
  userId: string;
  profileId: string;
  generation: RecoveryGeneration;
  operationId: string;
  deviceShare: Uint8Array;
};

function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
}

function assertGeneration(value: RecoveryGeneration): void {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('generation must be a safe integer');
    return;
  }
  if (typeof value !== 'string' || value.length === 0) throw new Error('generation is required');
}

function assertDeviceShare(deviceShare: Uint8Array): void {
  if (deviceShare.length !== 32) throw new Error('deviceShare must be 32 bytes');
}

function decodeCanonicalDeviceShare(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string') return null;
  try {
    const bytes = fromBase64(value);
    if (bytes.length !== 32 || toBase64(bytes) !== value) return null;
    return bytes;
  } catch {
    return null;
  }
}

function isValidGeneration(value: unknown): value is RecoveryGeneration {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  return typeof value === 'string' && value.length > 0;
}

/** Build the long-lived, pre-rotation recovery file used by the current UI. */
export function buildBackup(userId: string, deviceShare: Uint8Array): RecoveryBackupV1 {
  assertNonEmptyString(userId, 'userId');
  assertDeviceShare(deviceShare);
  return {
    type: RECOVERY_BACKUP_TYPE,
    version: RECOVERY_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    userId,
    deviceShare: toBase64(deviceShare),
  };
}

/**
 * Build a recovery file for a pending rotation. The operation binding is
 * deliberately part of the serialized file, and `pending: true` prevents a
 * cancelled operation's file from being mistaken for an active-vault backup.
 *
 * The object form is the preferred API. The positional form is retained for
 * small callers that already pass the five values separately.
 */
export function buildRotationBackup(input: RotationBackupInput): RecoveryBackupV2;
export function buildRotationBackup(
  userId: string,
  profileId: string,
  generation: RecoveryGeneration,
  operationId: string,
  deviceShare: Uint8Array,
): RecoveryBackupV2;
export function buildRotationBackup(
  userId: string,
  deviceShare: Uint8Array,
  profileId: string,
  generation: RecoveryGeneration,
  operationId: string,
): RecoveryBackupV2;
export function buildRotationBackup(
  inputOrUserId: RotationBackupInput | string,
  profileIdOrDeviceShare?: string | Uint8Array,
  generationOrProfileId?: RecoveryGeneration | string,
  operationIdOrGeneration?: string | RecoveryGeneration,
  deviceShareOrOperationId?: Uint8Array | string,
): RecoveryBackupV2 {
  const input: RotationBackupInput =
    typeof inputOrUserId === 'string'
      ? profileIdOrDeviceShare instanceof Uint8Array
        ? {
            userId: inputOrUserId,
            deviceShare: profileIdOrDeviceShare,
            profileId: generationOrProfileId as string,
            generation: operationIdOrGeneration as RecoveryGeneration,
            operationId: deviceShareOrOperationId as string,
          }
        : {
            userId: inputOrUserId,
            profileId: profileIdOrDeviceShare as string,
            generation: generationOrProfileId as RecoveryGeneration,
            operationId: operationIdOrGeneration as string,
            deviceShare: deviceShareOrOperationId as Uint8Array,
          }
      : inputOrUserId;

  assertNonEmptyString(input.userId, 'userId');
  assertNonEmptyString(input.profileId, 'profileId');
  assertGeneration(input.generation);
  assertNonEmptyString(input.operationId, 'operationId');
  assertDeviceShare(input.deviceShare);

  return {
    type: RECOVERY_BACKUP_TYPE,
    version: ROTATION_RECOVERY_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    userId: input.userId,
    profileId: input.profileId,
    generation: input.generation,
    operationId: input.operationId,
    pending: true,
    deviceShare: toBase64(input.deviceShare),
  };
}

/** Explicit alias for call sites that want to name the v2 format. */
export const buildRotationRecoveryBackup = buildRotationBackup;

export function backupFilename(userId: string, date: Date = new Date()): string {
  const idShort = userId.slice(0, 6);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `signote-recovery-${idShort}-${yyyy}-${mm}-${dd}.json`;
}

/**
 * Parse both generations. Version values are intentionally exact: accepting
 * version 0, decimals, or an arbitrary older number would silently opt a
 * caller into a format it has not reviewed.
 */
export function parseBackupText(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'malformed' };
  const obj = parsed as Record<string, unknown>;

  if (obj.type !== RECOVERY_BACKUP_TYPE) return { ok: false, reason: 'wrong-type' };
  if (typeof obj.version !== 'number' || !Number.isSafeInteger(obj.version)) {
    return { ok: false, reason: 'malformed' };
  }
  if (obj.version !== RECOVERY_BACKUP_VERSION && obj.version !== ROTATION_RECOVERY_BACKUP_VERSION) {
    return { ok: false, reason: 'unsupported-version' };
  }
  if (typeof obj.createdAt !== 'string' || obj.createdAt.length === 0) return { ok: false, reason: 'malformed' };
  if (typeof obj.userId !== 'string' || obj.userId.length === 0) return { ok: false, reason: 'malformed' };

  const deviceShare = decodeCanonicalDeviceShare(obj.deviceShare);
  if (!deviceShare) return { ok: false, reason: 'malformed' };

  if (obj.version === RECOVERY_BACKUP_VERSION) {
    return {
      ok: true,
      backup: {
        type: RECOVERY_BACKUP_TYPE,
        version: RECOVERY_BACKUP_VERSION,
        createdAt: obj.createdAt,
        userId: obj.userId,
        deviceShare: obj.deviceShare as string,
      },
    };
  }

  if (
    typeof obj.profileId !== 'string' ||
    obj.profileId.length === 0 ||
    !isValidGeneration(obj.generation) ||
    typeof obj.operationId !== 'string' ||
    obj.operationId.length === 0 ||
    obj.pending !== true
  ) {
    return { ok: false, reason: 'malformed' };
  }

  return {
    ok: true,
    backup: {
      type: RECOVERY_BACKUP_TYPE,
      version: ROTATION_RECOVERY_BACKUP_VERSION,
      createdAt: obj.createdAt,
      userId: obj.userId,
      profileId: obj.profileId,
      generation: obj.generation,
      operationId: obj.operationId,
      pending: true,
      deviceShare: obj.deviceShare as string,
    },
  };
}

export function decodeDeviceShare(backup: RecoveryBackup): Uint8Array<ArrayBuffer> {
  const bytes = decodeCanonicalDeviceShare(backup.deviceShare);
  if (!bytes) throw new Error('Malformed recovery device share');
  return bytes;
}
