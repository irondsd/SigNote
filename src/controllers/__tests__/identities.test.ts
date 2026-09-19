import { and, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { authIdentities, fileAttachments, notes, noteTags, passkeyCredentials, tags, users } from '@/db/schema';
import { AccountMergeCollisionError, linkIdentity, unlinkIdentity } from '@/controllers/identities';
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

  it('moves plaintext Notes, attachments and normalized tags as one account merge', async () => {
    await db.insert(users).values([
      { id: 'primary', displayName: 'Primary' },
      { id: 'secondary', displayName: 'Secondary' },
    ]);
    await db.insert(authIdentities).values({
      userId: 'secondary',
      provider: 'google',
      providerSubject: 'merge-content',
    });
    await db.insert(tags).values([
      { id: 'primary-shared', userId: 'primary', name: 'shared', color: 'red' },
      { id: 'secondary-shared', userId: 'secondary', name: 'shared', color: 'blue' },
      { id: 'secondary-unique', userId: 'secondary', name: 'unique', color: 'green' },
    ]);
    await db.insert(notes).values({ id: 'secondary-note', userId: 'secondary', title: 'Moved', position: 1 });
    await db.insert(noteTags).values([
      { userId: 'secondary', noteId: 'secondary-note', tagId: 'secondary-shared', sortOrder: 0 },
      { userId: 'secondary', noteId: 'secondary-note', tagId: 'secondary-unique', sortOrder: 1 },
    ]);
    await db.insert(fileAttachments).values({
      id: 'secondary-file',
      userId: 'secondary',
      noteId: 'secondary-note',
      noteTier: 'note',
      s3Key: 'uploads/secondary/secondary-file/a.txt',
      filename: 'a.txt',
      size: 1,
      mimeType: 'text/plain',
    });

    await linkIdentity('primary', 'google', 'merge-content', {});

    expect(await db.select().from(notes)).toEqual([expect.objectContaining({ id: 'secondary-note', userId: 'primary' })]);
    expect(await db.select().from(fileAttachments)).toEqual([
      expect.objectContaining({ id: 'secondary-file', userId: 'primary', noteId: 'secondary-note' }),
    ]);
    expect(await db.select().from(noteTags).orderBy(noteTags.sortOrder)).toEqual([
      expect.objectContaining({ userId: 'primary', tagId: 'primary-shared' }),
      expect.objectContaining({ userId: 'primary', tagId: 'secondary-unique' }),
    ]);
    expect(await db.select().from(tags).where(eq(tags.userId, 'secondary'))).toHaveLength(0);
    expect(await db.select().from(tags).where(eq(tags.id, 'secondary-shared'))).toHaveLength(0);
    expect(await db.select().from(tags).where(eq(tags.id, 'secondary-unique'))).toEqual([
      expect.objectContaining({ userId: 'primary' }),
    ]);
  });

  it.each(['note', 'attachment'] as const)('rejects an account merge with a duplicate portable %s id', async (kind) => {
    await db.insert(users).values([
      { id: 'primary', displayName: 'Primary' },
      { id: 'secondary', displayName: 'Secondary' },
    ]);
    await db.insert(authIdentities).values({
      userId: 'secondary',
      provider: 'google',
      providerSubject: `merge-collision-${kind}`,
    });
    if (kind === 'note') {
      await db.insert(notes).values([
        { id: 'same-id', userId: 'primary', title: 'Primary', position: 1 },
        { id: 'same-id', userId: 'secondary', title: 'Secondary', position: 1 },
      ]);
    } else {
      await db.insert(fileAttachments).values([
        {
          id: 'same-id',
          userId: 'primary',
          s3Key: 'uploads/primary/same-id/a.txt',
          filename: 'a.txt',
          size: 1,
          mimeType: 'text/plain',
        },
        {
          id: 'same-id',
          userId: 'secondary',
          s3Key: 'uploads/secondary/same-id/a.txt',
          filename: 'a.txt',
          size: 1,
          mimeType: 'text/plain',
        },
      ]);
    }

    await expect(linkIdentity('primary', 'google', `merge-collision-${kind}`, {})).rejects.toMatchObject({
      name: 'AccountMergeCollisionError',
      resource: kind,
    } satisfies Partial<AccountMergeCollisionError>);

    expect(await db.select().from(users).where(eq(users.id, 'secondary'))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.userId, 'secondary'),
            eq(authIdentities.providerSubject, `merge-collision-${kind}`),
          ),
        ),
    ).toHaveLength(1);
  });
});
