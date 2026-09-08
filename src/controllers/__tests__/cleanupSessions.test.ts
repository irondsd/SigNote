import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { SESSION_LIFETIME_MS, upsertSessionIfMissing } from '@/controllers/authSessions';
import { cleanupExpiredRows } from '@/controllers/cleanup';
import type { Db } from '@/db/client';
import { authSessions } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

const seedSession = async (expiresAt: Date, revoked: boolean) => {
  const sid = uuidv7();
  await upsertSessionIfMissing({
    sid,
    userId: 'cleanup-user',
    provider: 'siwe',
    ip: '1.2.3.4',
    userAgent: 'UA',
    browser: 'Chrome 120',
    os: 'macOS 14',
    deviceType: 'desktop',
  });
  await db
    .update(authSessions)
    .set({ expiresAt, ...(revoked ? { revokedAt: new Date() } : {}) })
    .where(eq(authSessions.id, sid));
  return sid;
};

const survives = async (sid: string) =>
  (await db.select().from(authSessions).where(eq(authSessions.id, sid))).length === 1;

/**
 * A session row is not only an audit record: it is the tombstone that keeps a
 * revocation enforced. `authenticateRequest` creates a row for any sid it has
 * never seen, so a row deleted while its JWT is still valid would be recreated
 * un-revoked by the very device that was signed out.
 */
describe('cleanupExpiredRows — auth sessions', () => {
  it('keeps a just-expired session for one more JWT lifetime', async () => {
    const revoked = await seedSession(new Date(Date.now() - 1000), true);
    const plain = await seedSession(new Date(Date.now() - 1000), false);

    await cleanupExpiredRows();

    expect(await survives(revoked)).toBe(true);
    expect(await survives(plain)).toBe(true);
  });

  it('deletes a session once no JWT naming it can still be valid', async () => {
    const sid = await seedSession(new Date(Date.now() - SESSION_LIFETIME_MS - 60_000), true);

    await cleanupExpiredRows();

    expect(await survives(sid)).toBe(false);
  });

  it('keeps a live session', async () => {
    const sid = await seedSession(new Date(Date.now() + SESSION_LIFETIME_MS), false);

    await cleanupExpiredRows();

    expect(await survives(sid)).toBe(true);
  });
});
