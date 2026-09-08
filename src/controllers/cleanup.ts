/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, isNotNull, lt, or, sql } from 'drizzle-orm';

import { OTP_TOMBSTONE_RETENTION_MS } from '@/config/constants';
import { getDb } from '@/db/client';
import { SESSION_LIFETIME_MS } from './authSessions';
import { purgeOtpTombstones } from './otpRecords';
import {
  authNonces,
  authSessions,
  desktopAuthAttempts,
  emailSignInCodes,
  fileAttachments,
  notes,
  passkeyChallenges,
  sealNotes,
  secretNotes,
} from '@/db/schema';

/**
 * Row expiry sweep — Postgres has no TTL index, so this stands in for one.
 *
 * Nothing here is load-bearing for correctness — every read path already
 * filters on `deletedAt` / `expiresAt` / `revokedAt`, so an expired row is
 * invisible whether or not it has been reaped. What the sweep does is reclaim
 * storage and, crucially, keep `cleanupOrphanedFiles` working: that job spots
 * an orphaned attachment by its parent note no longer existing, so if nothing
 * ever deletes expired notes, orphaned files are never collected either.
 */
const GRACE_MS = 3600_000;

export async function cleanupExpiredRows() {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - GRACE_MS);
  const removed: Record<string, number> = {};

  // Note tiers: soft-deleted an hour ago, or self-destructed an hour ago.
  // Deleting the head cascades to its versions and tag links.
  for (const [name, table] of [
    ['notes', notes],
    ['secretNotes', secretNotes],
    ['sealNotes', sealNotes],
  ] as const) {
    const rows = await (db as any)
      .delete(table)
      .where(or(lt(table.deletedAt, cutoff), lt(table.expiresAt, cutoff)))
      .returning({ id: table.id });
    removed[name] = rows.length;
  }

  // Auth rows expire with no grace — the model TTLs used expireAfterSeconds: 0.
  const nonces = await db.delete(authNonces).where(lt(authNonces.expiresAt, now)).returning({ n: authNonces.nonce });
  removed.authNonces = nonces.length;

  // …except auth sessions, which are also the tombstone that makes a revocation
  // stick. `authenticateRequest` lazily creates a row for any sid it has never
  // seen, so deleting a revoked row the moment it expires hands the still-held
  // JWT a brand-new, un-revoked session. One JWT lifetime of grace outlives
  // every token that could still name the row.
  const sessionCutoff = new Date(now.getTime() - SESSION_LIFETIME_MS);
  const sessions = await db
    .delete(authSessions)
    .where(lt(authSessions.expiresAt, sessionCutoff))
    .returning({ id: authSessions.id });
  removed.authSessions = sessions.length;

  const codes = await db
    .delete(emailSignInCodes)
    .where(lt(emailSignInCodes.expiresAt, now))
    .returning({ id: emailSignInCodes.id });
  removed.emailSignInCodes = codes.length;

  const passkeyChallengeRows = await db
    .delete(passkeyChallenges)
    .where(lt(passkeyChallenges.expiresAt, now))
    .returning({ challenge: passkeyChallenges.challenge });
  removed.passkeyChallenges = passkeyChallengeRows.length;

  const attempts = await db
    .delete(desktopAuthAttempts)
    .where(lt(desktopAuthAttempts.expiresAt, now))
    .returning({ id: desktopAuthAttempts.attemptId });
  removed.desktopAuthAttempts = attempts.length;

  // Authenticator tombstones, on their own 30-day clock rather than the note
  // sweep's one hour: a tombstone is what tells a device that has been offline
  // that a credential was deleted, so purging one early lets that device
  // resurrect it from its local cache on the next full-snapshot sync.
  removed.otpRecords = await purgeOtpTombstones(new Date(now.getTime() - OTP_TOMBSTONE_RETENTION_MS));

  // Attachment rows whose S3 object was already removed an hour ago.
  const files = await db
    .delete(fileAttachments)
    .where(and(isNotNull(fileAttachments.storageDeletedAt), lt(fileAttachments.storageDeletedAt, cutoff)))
    .returning({ id: fileAttachments.id });
  removed.fileAttachments = files.length;

  return removed;
}

/** Kept separate so a caller can reclaim disk after a large sweep. */
export async function vacuumAnalyze(): Promise<void> {
  await getDb().execute(sql`analyze`);
}
