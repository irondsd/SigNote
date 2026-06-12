import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TagModel } from '@/models/Tag';
import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import {
  createTag,
  deleteTagAndDetach,
  getOwnedTagIds,
  getTagUsageCounts,
  isDuplicateKeyError,
  listTags,
  normalizeTagName,
  tagNameTaken,
  touchTags,
  updateTag,
} from '../tags';
import { getNotesByUserId } from '../notes';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // Build the { userId, name } unique index up front — the concurrent-create
  // race test relies on it existing.
  await TagModel.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    TagModel.deleteMany({}),
    NoteModel.deleteMany({}),
    SecretNoteModel.deleteMany({}),
    SealNoteModel.deleteMany({}),
  ]);
});

const userId = '0xowner';
const other = '0xstranger';

describe('createTag', () => {
  it('normalizes the name and auto-assigns a color when none given', async () => {
    const tag = await createTag(userId, '  Work  ');
    expect(tag.name).toBe('work');
    expect(tag.color).toBeTruthy();
  });

  it('is idempotent on duplicate names (returns the existing tag)', async () => {
    const a = await createTag(userId, 'Work', 'red');
    const b = await createTag(userId, 'work');
    expect(b._id.toString()).toBe(a._id.toString());
    expect(b.color).toBe('red'); // unchanged
    expect(await TagModel.countDocuments({ userId })).toBe(1);
  });

  it('honors an explicit valid color', async () => {
    const tag = await createTag(userId, 'blue-things', 'blue');
    expect(tag.color).toBe('blue');
  });

  it('survives a concurrent create of the same name (unique-index race)', async () => {
    const results = await Promise.all([
      createTag(userId, 'race'),
      createTag(userId, 'race'),
      createTag(userId, 'race'),
    ]);
    const ids = new Set(results.map((t) => t._id.toString()));
    expect(ids.size).toBe(1);
    expect(await TagModel.countDocuments({ userId })).toBe(1);
  });
});

describe('normalizeTagName', () => {
  it('trims, lowercases and truncates to 50 characters', () => {
    expect(normalizeTagName('  Work  ')).toBe('work');
    expect(normalizeTagName('x'.repeat(60))).toBe('x'.repeat(50));
  });

  it('truncates by code points so an emoji is never cut in half', () => {
    // 49 chars + emoji = 50 code points but 51 UTF-16 units; a naive slice
    // would leave a lone surrogate at the end.
    const name = normalizeTagName('a'.repeat(49) + '🔥');
    expect(name.endsWith('🔥')).toBe(true);
    expect([...name].length).toBe(50);
  });
});

describe('updateTag / uniqueness', () => {
  it('renames and recolors', async () => {
    const tag = await createTag(userId, 'draft', 'gray');
    const renamed = await updateTag(tag._id.toString(), { name: 'final' });
    expect(renamed?.name).toBe('final');
    const recolored = await updateTag(tag._id.toString(), { color: 'green' });
    expect(recolored?.color).toBe('green');
  });

  it('applies name and color together in one write', async () => {
    const tag = await createTag(userId, 'draft', 'gray');
    const updated = await updateTag(tag._id.toString(), { name: 'shipped', color: 'blue' });
    expect(updated?.name).toBe('shipped');
    expect(updated?.color).toBe('blue');
  });

  it('renaming onto a taken name throws a recognizable duplicate-key error', async () => {
    await createTag(userId, 'work');
    const play = await createTag(userId, 'play');
    let caught: unknown;
    try {
      await updateTag(play._id.toString(), { name: 'work' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isDuplicateKeyError(caught)).toBe(true);
    expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
  });

  it('detects a name already taken by another tag', async () => {
    const a = await createTag(userId, 'work');
    const b = await createTag(userId, 'play');
    expect(await tagNameTaken(userId, 'work', b._id.toString())).toBe(true);
    expect(await tagNameTaken(userId, 'work', a._id.toString())).toBe(false); // itself
    expect(await tagNameTaken(userId, 'brand-new', b._id.toString())).toBe(false);
  });
});

describe('getOwnedTagIds', () => {
  it('keeps only valid ids owned by the user, preserving order', async () => {
    const a = await createTag(userId, 'a');
    const b = await createTag(userId, 'b');
    const foreign = await createTag(other, 'c');
    const result = await getOwnedTagIds(userId, [
      b._id.toString(),
      'not-an-objectid',
      foreign._id.toString(),
      a._id.toString(),
    ]);
    expect(result).toEqual([b._id.toString(), a._id.toString()]);
  });
});

describe('listTags / touchTags ordering', () => {
  it('lists most-recently-used first, with never-used tags last alphabetically', async () => {
    const apple = await createTag(userId, 'apple');
    const banana = await createTag(userId, 'banana');
    await createTag(userId, 'cherry'); // never used → null lastUsedAt

    // Explicit timestamps keep ordering independent of DB write timing.
    await TagModel.updateOne({ _id: banana._id }, { lastUsedAt: new Date('2024-01-01') });
    await TagModel.updateOne({ _id: apple._id }, { lastUsedAt: new Date('2024-06-01') });

    const ordered = await listTags(userId);
    expect(ordered.map((t) => t.name)).toEqual(['apple', 'banana', 'cherry']);
  });

  it('stamps lastUsedAt on the given tags', async () => {
    const tag = await createTag(userId, 'work');
    expect(tag.lastUsedAt).toBeNull();
    await touchTags([tag._id.toString()]);
    const fresh = await TagModel.findById(tag._id);
    expect(fresh?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('ignores invalid ids and never throws', async () => {
    await expect(touchTags(['not-an-objectid'])).resolves.toBeUndefined();
    await expect(touchTags([])).resolves.toBeUndefined();
  });
});

describe('getTagUsageCounts', () => {
  it('counts usage across notes, secrets and seals', async () => {
    const work = await createTag(userId, 'work');
    const home = await createTag(userId, 'home');
    const wid = work._id.toString();
    const hid = home._id.toString();

    await NoteModel.create({ userId, title: 'n1', content: '', position: 1, tags: [wid, hid] });
    await NoteModel.create({ userId, title: 'n2', content: '', position: 2, tags: [wid] });
    await SecretNoteModel.create({ userId, title: 's1', encryptedBody: null, position: 1, tags: [wid] });
    await SealNoteModel.create({
      userId,
      title: 'l1',
      encryptedBody: null,
      wrappedNoteKey: null,
      position: 1,
      tags: [hid],
    });
    // soft-deleted note should not count
    await NoteModel.create({ userId, title: 'gone', content: '', position: 3, tags: [wid], deletedAt: new Date() });

    const counts = await getTagUsageCounts(userId);
    expect(counts[wid]).toBe(3); // 2 notes + 1 secret
    expect(counts[hid]).toBe(2); // 1 note + 1 seal
  });

  it('excludes expired docs, matching what tag-filtered lists return', async () => {
    const work = await createTag(userId, 'work');
    const wid = work._id.toString();

    await NoteModel.create({ userId, title: 'live', content: '', position: 1, tags: [wid] });
    await NoteModel.create({
      userId,
      title: 'expired',
      content: '',
      position: 2,
      tags: [wid],
      expiresAt: new Date(Date.now() - 60_000),
    });
    await NoteModel.create({
      userId,
      title: 'expires later',
      content: '',
      position: 3,
      tags: [wid],
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const counts = await getTagUsageCounts(userId);
    expect(counts[wid]).toBe(2); // live + future expiry; past expiry dropped
  });
});

describe('deleteTagAndDetach', () => {
  it('deletes the tag and pulls its id from every tier', async () => {
    const work = await createTag(userId, 'work');
    const keep = await createTag(userId, 'keep');
    const wid = work._id.toString();
    const kid = keep._id.toString();

    const note = await NoteModel.create({ userId, title: 'n', content: '', position: 1, tags: [wid, kid] });
    const secret = await SecretNoteModel.create({ userId, title: 's', encryptedBody: null, position: 1, tags: [wid] });

    await deleteTagAndDetach(wid);

    expect(await TagModel.findById(wid)).toBeNull();
    expect((await NoteModel.findById(note._id))?.tags.map(String)).toEqual([kid]);
    expect((await SecretNoteModel.findById(secret._id))?.tags).toEqual([]);
  });
});

describe('listByUserId tag filtering (via getNotesByUserId)', () => {
  it('filters with OR (any) and AND (all) semantics', async () => {
    const a = await createTag(userId, 'a');
    const b = await createTag(userId, 'b');
    const aid = a._id.toString();
    const bid = b._id.toString();

    await NoteModel.create({ userId, title: 'both', content: '', position: 3, tags: [aid, bid] });
    await NoteModel.create({ userId, title: 'onlyA', content: '', position: 2, tags: [aid] });
    await NoteModel.create({ userId, title: 'none', content: '', position: 1, tags: [] });

    const or = await getNotesByUserId(userId, undefined, 30, 0, '', [aid, bid], 'or');
    expect(or.map((n) => n.title).sort()).toEqual(['both', 'onlyA']);

    const and = await getNotesByUserId(userId, undefined, 30, 0, '', [aid, bid], 'and');
    expect(and.map((n) => n.title)).toEqual(['both']);
  });
});
