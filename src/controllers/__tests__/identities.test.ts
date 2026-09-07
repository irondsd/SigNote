import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { authIdentities, passkeyCredentials, users } from '@/db/schema';
import { linkIdentity, unlinkIdentity } from '@/controllers/identities';
import { insertPasskey } from '@/controllers/passkeys';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(teardownTestDb);
beforeEach(async () => resetTestDb(db));

const addPasskey = (userId: string, credentialId: string) =>
  insertPasskey({
    userId,
    credentialId,
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
    transports: [],
    aaguid: '00000000-0000-0000-0000-000000000000',
    deviceType: 'multiDevice',
    backedUp: true,
    nickname: 'Synced passkey',
  });

describe('identities with passkeys', () => {
  it('allows an identity to be unlinked when a passkey remains', async () => {
    await db.insert(users).values({ id: 'primary', displayName: 'Primary' });
    await db.insert(authIdentities).values({ userId: 'primary', provider: 'google', providerSubject: 'google-1' });
    await addPasskey('primary', 'credential-1');

    expect(await unlinkIdentity('primary', 'google')).toBe(true);
    expect(await db.select().from(authIdentities)).toHaveLength(0);
    expect(await db.select().from(passkeyCredentials)).toHaveLength(1);
  });

  it('moves passkeys when an identity merge absorbs a secondary account', async () => {
    await db.insert(users).values([
      { id: 'primary', displayName: 'Primary' },
      { id: 'secondary', displayName: 'Secondary' },
    ]);
    await db.insert(authIdentities).values({
      userId: 'secondary',
      provider: 'google',
      providerSubject: 'merge-subject',
    });
    await addPasskey('secondary', 'credential-2');

    await linkIdentity('primary', 'google', 'merge-subject', {});

    const passkey = (
      await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.credentialId, 'credential-2'))
    )[0];
    expect(passkey.userId).toBe('primary');
    expect((await db.select().from(users).where(eq(users.id, 'secondary')))[0]).toBeUndefined();
  });
});
