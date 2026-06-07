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
  recolorTag,
  renameTag,
  tagNameTaken,
} from '../tags';
import { getNotesByUserId } from '../notes';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
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
});

describe('rename / recolor / uniqueness', () => {
  it('renames and recolors', async () => {
    const tag = await createTag(userId, 'draft', 'gray');
    const renamed = await renameTag(tag._id.toString(), 'Final');
    expect(renamed?.name).toBe('final');
    const recolored = await recolorTag(tag._id.toString(), 'green');
    expect(recolored?.color).toBe('green');
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

describe('getTagUsageCounts', () => {
  it('counts usage across notes, secrets and seals', async () => {
    const work = await createTag(userId, 'work');
    const home = await createTag(userId, 'home');
    const wid = work._id.toString();
    const hid = home._id.toString();

    await NoteModel.create({ userId, title: 'n1', content: '', position: 1, tags: [wid, hid] });
    await NoteModel.create({ userId, title: 'n2', content: '', position: 2, tags: [wid] });
    await SecretNoteModel.create({ userId, title: 's1', encryptedBody: null, position: 1, tags: [wid] });
    await SealNoteModel.create({ userId, title: 'l1', encryptedBody: null, wrappedNoteKey: null, position: 1, tags: [hid] });
    // soft-deleted note should not count
    await NoteModel.create({ userId, title: 'gone', content: '', position: 3, tags: [wid], deletedAt: new Date() });

    const counts = await getTagUsageCounts(userId);
    expect(counts[wid]).toBe(3); // 2 notes + 1 secret
    expect(counts[hid]).toBe(2); // 1 note + 1 seal
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
