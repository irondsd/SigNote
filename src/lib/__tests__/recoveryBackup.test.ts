import {
  RECOVERY_BACKUP_TYPE,
  RECOVERY_BACKUP_VERSION,
  buildBackup,
  backupFilename,
  decodeDeviceShare,
  parseBackupText,
} from '@/lib/recoveryBackup';
import { fromBase64, toBase64 } from '@/lib/crypto';

const USER_ID = '6814d0abcdef0123456789ab';

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out as Uint8Array<ArrayBuffer>;
}

describe('recoveryBackup', () => {
  describe('buildBackup', () => {
    it('produces a backup with all required fields', () => {
      const ds = randomBytes(32);
      const b = buildBackup(USER_ID, ds);
      expect(b.type).toBe(RECOVERY_BACKUP_TYPE);
      expect(b.version).toBe(RECOVERY_BACKUP_VERSION);
      expect(b.userId).toBe(USER_ID);
      expect(b.deviceShare).toBe(toBase64(ds));
      expect(typeof b.createdAt).toBe('string');
      expect(() => new Date(b.createdAt)).not.toThrow();
    });

    it('throws if deviceShare is not 32 bytes', () => {
      expect(() => buildBackup(USER_ID, new Uint8Array(16) as Uint8Array<ArrayBuffer>)).toThrow();
    });
  });

  describe('backupFilename', () => {
    it('includes user prefix and ISO-like date', () => {
      const name = backupFilename(USER_ID, new Date('2026-05-19T00:00:00Z'));
      expect(name).toBe('signote-recovery-6814d0-2026-05-19.json');
    });
  });

  describe('parseBackupText', () => {
    it('roundtrips a valid backup', () => {
      const ds = randomBytes(32);
      const text = JSON.stringify(buildBackup(USER_ID, ds));
      const result = parseBackupText(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.backup.userId).toBe(USER_ID);
        expect(fromBase64(result.backup.deviceShare)).toEqual(ds);
      }
    });

    it('rejects non-JSON', () => {
      const r = parseBackupText('not json at all{');
      expect(r).toEqual({ ok: false, reason: 'not-json' });
    });

    it('rejects wrong type', () => {
      const r = parseBackupText(JSON.stringify({ type: 'something-else', version: 1, userId: 'x', deviceShare: 'y', createdAt: 'z' }));
      expect(r).toEqual({ ok: false, reason: 'wrong-type' });
    });

    it('rejects future version', () => {
      const r = parseBackupText(
        JSON.stringify({
          type: RECOVERY_BACKUP_TYPE,
          version: RECOVERY_BACKUP_VERSION + 1,
          userId: USER_ID,
          deviceShare: toBase64(randomBytes(32)),
          createdAt: new Date().toISOString(),
        }),
      );
      expect(r).toEqual({ ok: false, reason: 'unsupported-version' });
    });

    it('rejects missing userId', () => {
      const r = parseBackupText(
        JSON.stringify({
          type: RECOVERY_BACKUP_TYPE,
          version: 1,
          deviceShare: toBase64(randomBytes(32)),
          createdAt: new Date().toISOString(),
        }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('malformed');
    });

    it('rejects deviceShare of wrong length', () => {
      const r = parseBackupText(
        JSON.stringify({
          type: RECOVERY_BACKUP_TYPE,
          version: 1,
          userId: USER_ID,
          deviceShare: toBase64(randomBytes(16)),
          createdAt: new Date().toISOString(),
        }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('malformed');
    });
  });

  describe('decodeDeviceShare', () => {
    it('returns the original bytes', () => {
      const ds = randomBytes(32);
      const b = buildBackup(USER_ID, ds);
      expect(decodeDeviceShare(b)).toEqual(ds);
    });
  });
});
