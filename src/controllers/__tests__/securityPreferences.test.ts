import type { Db } from '@/db/client';
import {
  eraseSecurityPreferences,
  getSecurityPreferences,
  setSecurityPreferences,
} from '@/controllers/securityPreferences';
import { securityPreferences } from '@/db/schema';
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

const userId = 'security-prefs-user';
const rows = () => db.select().from(securityPreferences);

describe('securityPreferences controller', () => {
  it('defaults to the conservative answer for an account with no row', async () => {
    expect(await getSecurityPreferences(userId)).toEqual({ cacheServerShare: false, blurAuthCodes: true });
    expect(await rows()).toHaveLength(0);
  });

  it('writes one switch without carrying a column default onto the other', async () => {
    await setSecurityPreferences(userId, { cacheServerShare: true });

    // `blurAuthCodes` defaults to true and `cacheServerShare` to false, so a
    // patch that ignored the current row would flip whichever it omitted.
    expect(await getSecurityPreferences(userId)).toEqual({ cacheServerShare: true, blurAuthCodes: true });

    await setSecurityPreferences(userId, { blurAuthCodes: false });

    expect(await getSecurityPreferences(userId)).toEqual({ cacheServerShare: true, blurAuthCodes: false });
  });

  it('upserts rather than inserting a second row per user', async () => {
    await setSecurityPreferences(userId, { cacheServerShare: true });
    await setSecurityPreferences(userId, { cacheServerShare: false });

    expect(await rows()).toHaveLength(1);
    expect(await getSecurityPreferences(userId)).toEqual({ cacheServerShare: false, blurAuthCodes: true });
  });

  it('returns the value it wrote', async () => {
    expect(await setSecurityPreferences(userId, { blurAuthCodes: false })).toEqual({
      cacheServerShare: false,
      blurAuthCodes: false,
    });
  });

  it('keeps accounts apart', async () => {
    await setSecurityPreferences(userId, { cacheServerShare: true });

    expect(await getSecurityPreferences('someone-else')).toEqual({ cacheServerShare: false, blurAuthCodes: true });
  });

  it('erases, which returns the account to the defaults', async () => {
    await setSecurityPreferences(userId, { cacheServerShare: true, blurAuthCodes: false });

    await eraseSecurityPreferences(userId);

    expect(await rows()).toHaveLength(0);
    expect(await getSecurityPreferences(userId)).toEqual({ cacheServerShare: false, blurAuthCodes: true });
  });
});
