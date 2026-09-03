import { and, count, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { encryptionProfiles, notes, sealNotes, secretNotes, users } from '@/db/schema';

export const getProfileData = async (userId: string) => {
  const db = getDb();

  const countActive = async (table: typeof notes | typeof secretNotes | typeof sealNotes) => {
    const rows = await db
      .select({ n: count() })
      .from(table)
      .where(and(eq(table.userId, userId), isNull(table.deletedAt)));
    return Number(rows[0].n);
  };

  const [userRows, notesCount, secretsCount, sealsCount, profileRows] = await Promise.all([
    db
      .select({ displayName: users.displayName, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    countActive(notes),
    countActive(secretNotes),
    countActive(sealNotes),
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
    notesCount,
    secretsCount,
    sealsCount,
    hasEncryptionProfile: profileRows[0] !== undefined,
    encryptionProfileCreatedAt: profileRows[0]?.createdAt ?? null,
  };
};
