import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { withVaultRead, withVaultWrite } from '@/db/encryptionState';
import { securityPreferences } from '@/db/schema';

export type SecurityPreferences = {
  /** Keep `serverShare` on the device so the vault can be unlocked offline. */
  cacheServerShare: boolean;
  /** Blur Authenticator codes until hovered, on pointer devices. */
  blurAuthCodes: boolean;
};

/**
 * No row means the account has never opened the page, which must read as the
 * conservative answer to both questions — not as "nothing is set, so allow it".
 */
const DEFAULTS: SecurityPreferences = { cacheServerShare: false, blurAuthCodes: true };

export const getSecurityPreferences = async (userId: string): Promise<SecurityPreferences> => {
  return withVaultRead(userId, async () => {
    const rows = await getDb()
      .select({
        cacheServerShare: securityPreferences.cacheServerShare,
        blurAuthCodes: securityPreferences.blurAuthCodes,
      })
      .from(securityPreferences)
      .where(eq(securityPreferences.userId, userId))
      .limit(1);

    return rows[0] ?? DEFAULTS;
  });
};

/**
 * Upserts a partial change. The insert spells out the full row because the two
 * defaults differ: a first-time write of one switch must not carry the other's
 * column default into a row that now means "the user decided this".
 */
export const setSecurityPreferences = async (
  userId: string,
  patch: Partial<SecurityPreferences>,
): Promise<SecurityPreferences> => {
  return withVaultWrite(userId, async () => {
    const rows = await getDb()
      .select({
        cacheServerShare: securityPreferences.cacheServerShare,
        blurAuthCodes: securityPreferences.blurAuthCodes,
      })
      .from(securityPreferences)
      .where(eq(securityPreferences.userId, userId))
      .limit(1);
    const current = rows[0] ?? DEFAULTS;
    const next = { ...current, ...patch };

    await getDb()
      .insert(securityPreferences)
      .values({ userId, ...next })
      .onConflictDoUpdate({ target: securityPreferences.userId, set: next });

    return next;
  });
};

export const eraseSecurityPreferences = (userId: string) =>
  withVaultWrite(userId, async () => {
    await getDb().delete(securityPreferences).where(eq(securityPreferences.userId, userId));
  });
