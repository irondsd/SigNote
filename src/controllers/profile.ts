import { and, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { withVaultRead } from '@/db/encryptionState';
import { encryptionProfiles, notes, otpRecords, sealNotes, secretNotes, users } from '@/db/schema';

export type TierCounts = { active: number; archived: number };

type CountableTable = typeof notes | typeof secretNotes | typeof sealNotes | typeof otpRecords;

export const getProfileData = async (userId: string) => {
  return withVaultRead(userId, async ({ generation }) => {
    const db = getDb();

    // Soft-deleted rows never count — for the note tiers they are in the trash,
    // and for otp_records a deleted row lingers only as a tombstone for offline
    // devices to notice.
    const countTier = async (table: CountableTable): Promise<TierCounts> => {
      const rows = await db
        .select({
          active: sql<number>`count(*) filter (where not ${table.archived})`,
          archived: sql<number>`count(*) filter (where ${table.archived})`,
        })
        .from(table)
        .where(and(eq(table.userId, userId), isNull(table.deletedAt)));
      return { active: Number(rows[0].active), archived: Number(rows[0].archived) };
    };

    const [userRows, notesCount, secretsCount, sealsCount, authCount, profileRows] = await Promise.all([
      db
        .select({ displayName: users.displayName, createdAt: users.createdAt, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      countTier(notes),
      countTier(secretNotes),
      countTier(sealNotes),
      countTier(otpRecords),
      db
        .select({ createdAt: encryptionProfiles.createdAt })
        .from(encryptionProfiles)
        .where(eq(encryptionProfiles.userId, userId))
        .limit(1),
    ]);

    const user = userRows[0];
    if (!user) return null;

    return {
      displayName: user.displayName,
      createdAt: user.createdAt,
      // Null for a wallet-only account. Gates the notification settings, which
      // have nothing to act on without an address.
      email: user.email,
      counts: {
        notes: notesCount,
        secrets: secretsCount,
        seals: sealsCount,
        auth: authCount,
      },
      hasEncryptionProfile: profileRows[0] !== undefined,
      encryptionProfileCreatedAt: profileRows[0]?.createdAt ?? null,
      generation,
    };
  });
};
