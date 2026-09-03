import { v7 as uuidv7 } from 'uuid';

import type { Db } from '@/db/client';
import { createNote, getNotesByUserId } from '@/controllers/notes';
import { createSecret, getSecretsByUserId } from '@/controllers/secrets';
import { buildPrefixTsQuery } from '@/db/tier';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

let db: Db;
const userId = uuidv7();

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTestDb(db);
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('buildPrefixTsQuery', () => {
  it('makes every term a prefix so incremental typing still matches', () => {
    expect(buildPrefixTsQuery('groc')).toBe('groc:*');
    expect(buildPrefixTsQuery('buy milk')).toBe('buy:* & milk:*');
  });

  it('strips tsquery operators rather than letting them reach to_tsquery', () => {
    expect(buildPrefixTsQuery('a & b | !c')).toBe('a:* & b:* & c:*');
    expect(buildPrefixTsQuery("o'brien (test)")).toBe('obrien:* & test:*');
  });

  it('returns null when nothing searchable is left', () => {
    expect(buildPrefixTsQuery('   ')).toBeNull();
    expect(buildPrefixTsQuery('!!! ???')).toBeNull();
  });
});

describe('tier search', () => {
  it('matches a word prefix, the way the old regex search did', async () => {
    await createNote(userId, 'Groceries', '<p>milk and eggs</p>');
    await createNote(userId, 'Unrelated', '<p>nothing here</p>');

    expect(titles(await getNotesByUserId(userId, undefined, 30, 0, 'groc'))).toEqual(['Groceries']);
  });

  it('ranks a title hit above a body-only hit', async () => {
    await createNote(userId, 'Shopping', '<p>we are out of milk</p>');
    await createNote(userId, 'Milk', '<p>unrelated body</p>');

    expect(titles(await getNotesByUserId(userId, undefined, 30, 0, 'milk'))).toEqual(['Milk', 'Shopping']);
  });

  it('ignores the HTML tags that tier-1 content is stored as', async () => {
    await createNote(userId, 'Note', '<p class="x"><strong>visible</strong></p>');

    expect(await getNotesByUserId(userId, undefined, 30, 0, 'strong')).toHaveLength(0);
    expect(titles(await getNotesByUserId(userId, undefined, 30, 0, 'visible'))).toEqual(['Note']);
  });

  it('stems, so a search for one form finds the other', async () => {
    await createNote(userId, 'Running', '<p>a jog</p>');

    expect(titles(await getNotesByUserId(userId, undefined, 30, 0, 'run'))).toEqual(['Running']);
  });

  it('requires every term to match', async () => {
    await createNote(userId, 'Milk', '<p>dairy</p>');
    await createNote(userId, 'Bread', '<p>bakery</p>');

    expect(await getNotesByUserId(userId, undefined, 30, 0, 'milk bread')).toHaveLength(0);
    expect(titles(await getNotesByUserId(userId, undefined, 30, 0, 'milk dairy'))).toEqual(['Milk']);
  });

  it('searches a secret by its plaintext title only — never the ciphertext', async () => {
    const body = { alg: 'A256GCM' as const, iv: 'aXY=', ciphertext: 'c2VjcmV0' };
    await createSecret(userId, 'Passport', body);

    expect(titles(await getSecretsByUserId(userId, undefined, 30, 0, 'passp'))).toEqual(['Passport']);
    expect(await getSecretsByUserId(userId, undefined, 30, 0, 'c2VjcmV0')).toHaveLength(0);
  });

  it('matches nothing when the search reduces to no searchable terms', async () => {
    await createNote(userId, 'Anything', '<p>body</p>');

    expect(await getNotesByUserId(userId, undefined, 30, 0, '!!!')).toHaveLength(0);
  });

  it('keeps pinned notes on top regardless of relevance', async () => {
    const shopping = await createNote(userId, 'Shopping', '<p>out of milk</p>');
    await createNote(userId, 'Milk', '<p>unrelated</p>');
    await import('@/controllers/notes').then((m) => m.noteOps.applyPatch(shopping._id, { pinned: true }));

    expect(titles(await getNotesByUserId(userId, undefined, 30, 0, 'milk'))).toEqual(['Shopping', 'Milk']);
  });
});
