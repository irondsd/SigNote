import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { authIdentities, passkeyCredentials, users } from '@/db/schema';
import { LastIdentityError, countSignInMethods } from '@/controllers/identities';
import {
  createPasskeyUser,
  deletePasskey,
  findPasskeyByCredentialId,
  insertPasskey,
  listPasskeys,
  recordPasskeyUse,
  renamePasskey,
} from '@/controllers/passkeys';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

let db: Db;
const userId = 'user-passkeys';

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTestDb(db);
  await db.insert(users).values({ id: userId, displayName: 'Test user' });
});

const addPasskey = (credentialId: string, nickname = 'Passkey') =>
  insertPasskey({
    userId,
    credentialId,
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
    transports: ['internal'],
    aaguid: '00000000-0000-0000-0000-000000000000',
    deviceType: 'singleDevice',
    backedUp: false,
    nickname,
  });

describe('passkeys controller', () => {
  it('inserts, finds, lists, and renames only an owned passkey', async () => {
    const inserted = await addPasskey('credential-a', 'Laptop');

    expect(await findPasskeyByCredentialId('credential-a')).toMatchObject({ id: inserted.id, nickname: 'Laptop' });
    expect(await listPasskeys(userId)).toHaveLength(1);
    expect(await renamePasskey(userId, inserted.id, 'Security key')).toBe(true);
    expect((await listPasskeys(userId))[0].nickname).toBe('Security key');
    expect(await renamePasskey('someone-else', inserted.id, 'Stolen')).toBe(false);
  });

  it('records the counter and last-used time', async () => {
    const inserted = await addPasskey('credential-b');
    expect(await recordPasskeyUse(inserted.id, 7)).toBe(true);

    const row = await findPasskeyByCredentialId('credential-b');
    expect(row?.counter).toBe(7);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('refuses to remove the final sign-in method', async () => {
    const inserted = await addPasskey('credential-c');

    await expect(deletePasskey(userId, inserted.id)).rejects.toBeInstanceOf(LastIdentityError);
    expect(await listPasskeys(userId)).toHaveLength(1);
  });

  it('removes a passkey when email or another identity remains', async () => {
    const inserted = await addPasskey('credential-d');
    await db.update(users).set({ email: 'test@example.com' }).where(eq(users.id, userId));

    expect(await deletePasskey(userId, inserted.id)).toBe(true);
    expect(await findPasskeyByCredentialId('credential-d')).toBeNull();
  });

  it('counts identities, passkeys, and email through one helper', async () => {
    await addPasskey('credential-e');
    await db.insert(authIdentities).values({
      userId,
      provider: 'google',
      providerSubject: 'google-subject',
    });
    await db.update(users).set({ email: 'test@example.com' }).where(eq(users.id, userId));

    expect(await countSignInMethods(userId)).toBe(3);
    expect(await db.select().from(passkeyCredentials)).toHaveLength(1);
  });

  it('creates a passkey-only user and credential atomically', async () => {
    const result = await createPasskeyUser({
      userId: 'new-passkey-user',
      credentialId: 'new-user-credential',
      publicKey: 'cHVibGljLWtleQ',
      counter: 0,
      transports: ['internal'],
      aaguid: '00000000-0000-0000-0000-000000000000',
      deviceType: 'singleDevice',
      backedUp: false,
      nickname: 'Laptop',
    });

    expect(result).toMatchObject({
      user: { id: 'new-passkey-user', displayName: 'Passkey user' },
      credential: { userId: 'new-passkey-user', credentialId: 'new-user-credential' },
      created: true,
    });
    expect(await db.select().from(users).where(eq(users.id, 'new-passkey-user'))).toHaveLength(1);
    expect(
      await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.userId, 'new-passkey-user')),
    ).toHaveLength(1);
  });

  it('refuses to create a passkey account with an existing user id', async () => {
    const result = await createPasskeyUser({
      userId,
      credentialId: 'must-not-be-inserted',
      publicKey: 'cHVibGljLWtleQ',
      counter: 0,
      transports: [],
      aaguid: '00000000-0000-0000-0000-000000000000',
      deviceType: 'multiDevice',
      backedUp: true,
      nickname: 'Synced passkey',
    });

    expect(result).toBeNull();
    expect(
      await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.credentialId, 'must-not-be-inserted')),
    ).toHaveLength(0);
  });
});
