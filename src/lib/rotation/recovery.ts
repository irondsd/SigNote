/** Local-only validation for generation-bound, pending rotation recovery files. */
import {
  decodeDeviceShare,
  parseBackupText,
  ROTATION_RECOVERY_BACKUP_VERSION,
  type RecoveryBackup,
  type RecoveryBackupV2,
  type RecoveryGeneration,
} from '@/lib/recoveryBackup';
import {
  fromBase64,
  getDefaultKdfParams,
  getEncVersion,
  importMEK,
  toBase64,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';
import type { RotationMaterial } from './crypto';

export type PendingRecoveryBinding = {
  userId: string;
  profileId: string;
  generation: RecoveryGeneration;
  operationId: string;
};

export type PendingRecoveryValidationContext = PendingRecoveryBinding & {
  material: RotationMaterial;
};

export type RecoveryValidationErrorCode =
  'INVALID_RECOVERY_FORMAT' | 'RECOVERY_BINDING_MISMATCH' | 'INVALID_PENDING_MATERIAL';

export class RecoveryValidationError extends Error {
  constructor(readonly code: RecoveryValidationErrorCode) {
    super(code);
    this.name = 'RecoveryValidationError';
  }
}

function canonical32(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string') throw new RecoveryValidationError('INVALID_PENDING_MATERIAL');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(value);
  } catch {
    throw new RecoveryValidationError('INVALID_PENDING_MATERIAL');
  }
  if (bytes.length !== 32) throw new RecoveryValidationError('INVALID_PENDING_MATERIAL');
  // fromBase64 is intentionally permissive in the legacy crypto module. A
  // pending material record is new input, so require its canonical spelling.
  if (toBase64(bytes) !== value) throw new RecoveryValidationError('INVALID_PENDING_MATERIAL');
  return bytes;
}

function assertPendingMaterial(material: RotationMaterial): void {
  const policy = getDefaultKdfParams();
  if (
    !material ||
    material.version !== getEncVersion() ||
    !material.kdf ||
    material.kdf.name !== policy.name ||
    material.kdf.hash !== policy.hash ||
    material.kdf.length !== policy.length ||
    material.kdf.iterations !== policy.iterations
  ) {
    throw new RecoveryValidationError('INVALID_PENDING_MATERIAL');
  }
  canonical32(material.salt);
  canonical32(material.serverShare);
  if (!material.keyCheck || material.keyCheck.alg !== 'A256GCM') {
    throw new RecoveryValidationError('INVALID_PENDING_MATERIAL');
  }
}

function assertPendingBackup(backup: RecoveryBackup): asserts backup is RecoveryBackupV2 {
  if (
    backup.type !== 'signote-recovery' ||
    backup.version !== ROTATION_RECOVERY_BACKUP_VERSION ||
    backup.pending !== true
  ) {
    throw new RecoveryValidationError('INVALID_RECOVERY_FORMAT');
  }
}

function assertBinding(backup: RecoveryBackupV2, expected: PendingRecoveryBinding): void {
  if (
    backup.userId !== expected.userId ||
    backup.profileId !== expected.profileId ||
    backup.generation !== expected.generation ||
    backup.operationId !== expected.operationId
  ) {
    throw new RecoveryValidationError('RECOVERY_BINDING_MISMATCH');
  }
}

/**
 * Reconstruct a pending MEK entirely in local memory. The device share is
 * never returned, persisted, or sent to a server. The returned CryptoKey is
 * non-extractable, matching the normal unlock path.
 */
export async function reconstructPendingMek(backup: RecoveryBackupV2, material: RotationMaterial): Promise<CryptoKey> {
  assertPendingBackup(backup);
  assertPendingMaterial(material);

  const deviceShare = decodeDeviceShare(backup);
  const serverShare = canonical32(material.serverShare);
  const rawMek = xor32(deviceShare, serverShare);
  try {
    const mek = await importMEK(rawMek);
    if (!(await verifyKeyCheck(mek, material.keyCheck))) {
      throw new RecoveryValidationError('INVALID_PENDING_MATERIAL');
    }
    return mek;
  } finally {
    deviceShare.fill(0);
    serverShare.fill(0);
    rawMek.fill(0);
  }
}

/** Preferred object-form API. The checks happen before key reconstruction. */
export async function validatePendingRecoveryBackup(
  backup: RecoveryBackup,
  context: PendingRecoveryValidationContext,
): Promise<CryptoKey>;
/** Positional form for small worker/client call sites. */
export async function validatePendingRecoveryBackup(
  backup: RecoveryBackup,
  binding: PendingRecoveryBinding,
  material: RotationMaterial,
): Promise<CryptoKey>;
export async function validatePendingRecoveryBackup(
  backup: RecoveryBackup,
  contextOrBinding: PendingRecoveryValidationContext | PendingRecoveryBinding,
  material?: RotationMaterial,
): Promise<CryptoKey> {
  assertPendingBackup(backup);
  const context: PendingRecoveryValidationContext =
    material === undefined
      ? (contextOrBinding as PendingRecoveryValidationContext)
      : { ...(contextOrBinding as PendingRecoveryBinding), material };
  assertBinding(backup, context);
  return reconstructPendingMek(backup, context.material);
}

/** Parse and validate a user-selected recovery file without uploading it. */
export async function parseAndValidatePendingRecovery(
  text: string,
  context: PendingRecoveryValidationContext,
): Promise<{ backup: RecoveryBackupV2; mek: CryptoKey }> {
  const parsed = parseBackupText(text);
  if (!parsed.ok || parsed.backup.version !== ROTATION_RECOVERY_BACKUP_VERSION) {
    throw new RecoveryValidationError('INVALID_RECOVERY_FORMAT');
  }
  const mek = await validatePendingRecoveryBackup(parsed.backup, context);
  return { backup: parsed.backup, mek };
}

/** Names used by callers that prefer “rotation” terminology. */
export const validateRotationRecoveryBackup = validatePendingRecoveryBackup;
export const parseAndValidateRotationRecovery = parseAndValidatePendingRecovery;
