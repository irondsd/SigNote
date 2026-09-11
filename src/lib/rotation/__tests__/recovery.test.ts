import { buildRotationBackup, parseBackupText, type RecoveryBackupV2 } from '@/lib/recoveryBackup';
import { createRotationMaterial, type RotationMaterial } from '../crypto';
import {
  parseAndValidatePendingRecovery,
  reconstructPendingMek,
  RecoveryValidationError,
  validatePendingRecoveryBackup,
  type PendingRecoveryBinding,
} from '../recovery';

const binding: PendingRecoveryBinding = {
  userId: 'user-1',
  profileId: 'profile-1',
  generation: 12,
  operationId: 'operation-1',
};

function makeBackup(deviceShare: Uint8Array): RecoveryBackupV2 {
  return buildRotationBackup({ ...binding, deviceShare });
}

function context(material: RotationMaterial) {
  return { ...binding, material };
}

describe('generation-bound pending recovery', () => {
  it('reconstructs and verifies a pending MEK locally for same and different passphrases', async () => {
    const samePassphrase = await createRotationMaterial('same passphrase');
    const differentPassphrase = await createRotationMaterial('different passphrase');

    const sameBackup = makeBackup(samePassphrase.deviceShare);
    await expect(validatePendingRecoveryBackup(sameBackup, context(samePassphrase.material))).resolves.toBeInstanceOf(
      CryptoKey,
    );

    // A fresh rotation material record has a fresh salt and MEK even when the
    // passphrase is unchanged; the file is bound to that fresh material.
    const secondSame = await createRotationMaterial('same passphrase');
    expect(secondSame.deviceShare).not.toEqual(samePassphrase.deviceShare);
    await expect(
      reconstructPendingMek(makeBackup(secondSame.deviceShare), secondSame.material),
    ).resolves.toBeInstanceOf(CryptoKey);

    // The pending file cannot be paired with material from a different
    // passphrase because keyCheck authentication fails.
    await expect(
      validatePendingRecoveryBackup(sameBackup, context(differentPassphrase.material)),
    ).rejects.toMatchObject({
      code: 'INVALID_PENDING_MATERIAL',
    });
  });

  it('rejects every wrong owner, profile, generation, or operation binding', async () => {
    const material = await createRotationMaterial('rotation passphrase');
    const backup = makeBackup(material.deviceShare);

    const wrongBindings: PendingRecoveryBinding[] = [
      { ...binding, userId: 'other-user' },
      { ...binding, profileId: 'other-profile' },
      { ...binding, generation: 11 },
      { ...binding, operationId: 'other-operation' },
      { ...binding, generation: '12' },
    ];
    for (const wrong of wrongBindings) {
      await expect(
        validatePendingRecoveryBackup(backup, { ...wrong, material: material.material }),
      ).rejects.toMatchObject({
        code: 'RECOVERY_BINDING_MISMATCH',
      });
    }
  });

  it('rejects stale files and a file from a cancelled operation before key use', async () => {
    const material = await createRotationMaterial('rotation passphrase');
    const backup = makeBackup(material.deviceShare);

    await expect(
      validatePendingRecoveryBackup(backup, { ...binding, generation: 13, material: material.material }),
    ).rejects.toMatchObject({ code: 'RECOVERY_BINDING_MISMATCH' });
    await expect(
      validatePendingRecoveryBackup(backup, {
        ...binding,
        operationId: 'cancelled-operation',
        material: material.material,
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_BINDING_MISMATCH' });
  });

  it('rejects legacy, malformed, and non-pending files', async () => {
    const material = await createRotationMaterial('rotation passphrase');
    const backup = makeBackup(material.deviceShare);
    const legacy = {
      type: 'signote-recovery' as const,
      version: 1 as const,
      createdAt: backup.createdAt,
      userId: binding.userId,
      deviceShare: backup.deviceShare,
    };
    await expect(validatePendingRecoveryBackup(legacy, context(material.material))).rejects.toMatchObject({
      code: 'INVALID_RECOVERY_FORMAT',
    });

    const malformed = { ...backup, pending: false } as unknown as RecoveryBackupV2;
    await expect(validatePendingRecoveryBackup(malformed, context(material.material))).rejects.toMatchObject({
      code: 'INVALID_RECOVERY_FORMAT',
    });

    const parsed = parseBackupText(JSON.stringify({ ...backup, pending: false }));
    expect(parsed).toEqual({ ok: false, reason: 'malformed' });
    await expect(
      parseAndValidatePendingRecovery(JSON.stringify(legacy), context(material.material)),
    ).rejects.toMatchObject({
      code: 'INVALID_RECOVERY_FORMAT',
    });
  });

  it('does not include binding values or key material in validation errors', async () => {
    const material = await createRotationMaterial('rotation passphrase');
    const backup = makeBackup(material.deviceShare);
    let error: unknown;
    try {
      await validatePendingRecoveryBackup(backup, {
        ...binding,
        operationId: 'wrong',
        material: material.material,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RecoveryValidationError);
    expect(String(error)).not.toContain(binding.userId);
    expect(String(error)).not.toContain(binding.profileId);
    expect(String(error)).not.toContain(binding.operationId);
    expect(String(error)).not.toContain(backup.deviceShare);
    expect(String(error).includes(material.material.serverShare)).toBe(false);
  });
});
