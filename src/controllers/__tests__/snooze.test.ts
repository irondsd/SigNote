import { v7 as uuidv7 } from 'uuid';

import type { Db } from '@/db/client';
import { createNote, getNoteById, getNotesByUserId, noteOps } from '@/controllers/notes';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

// Snoozing: a note is archived with a date, and reappears among the active
// notes once the date has passed — decided by the list query at read time, with
// nothing written until the note is opened (`wake`). See `snoozedUntil` in
// src/db/schema.ts.

let db: Db;
const userId = uuidv7();

const DAY = 86_400_000;
const future = () => new Date(Date.now() + DAY);
const past = () => new Date(Date.now() - DAY);

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTestDb(db);
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
const active = async () => titles(await getNotesByUserId(userId, false));
const archive = async () => titles(await getNotesByUserId(userId, true));

describe('snooze', () => {
  it('keeps a snoozed note in the archive until its date', async () => {
    const note = await createNote(userId, 'Later', '');
    await createNote(userId, 'Now', '');
    await noteOps.snooze(userId, note._id, future());

    expect(await active()).toEqual(['Now']);
    expect(await archive()).toEqual(['Later']);
  });

  it('lists a note whose date has passed as active, still archived in storage', async () => {
    const note = await createNote(userId, 'Back', '');
    await noteOps.snooze(userId, note._id, past());

    expect(await active()).toEqual(['Back']);
    expect(await archive()).toEqual([]);
    const stored = await getNoteById(userId, note._id);
    expect(stored?.archived).toBe(true);
    expect(stored?.snoozedUntil).toBeInstanceOf(Date);
  });

  it('puts a returned note ahead of newer notes, but below pinned ones', async () => {
    const back = await createNote(userId, 'Back', '');
    await createNote(userId, 'Newer', '');
    const pinned = await createNote(userId, 'Pinned', '');
    await noteOps.applyPatch(userId, pinned._id, { pinned: true });
    await noteOps.snooze(userId, back._id, past());

    expect(await active()).toEqual(['Pinned', 'Back', 'Newer']);
  });

  it('still finds a snoozed note when searching across both views', async () => {
    const note = await createNote(userId, 'Nocturne', '');
    await noteOps.snooze(userId, note._id, future());

    expect(titles(await getNotesByUserId(userId, undefined, 30, 0, 'noct'))).toEqual(['Nocturne']);
  });
});

describe('wake', () => {
  it('turns a returned note into an ordinary active one at the top', async () => {
    const note = await createNote(userId, 'Back', '');
    await createNote(userId, 'Newer', '');
    await noteOps.snooze(userId, note._id, past());

    const woken = await noteOps.wake(userId, note._id);

    expect(woken?.archived).toBe(false);
    expect(woken?.snoozedUntil).toBeNull();
    expect(await active()).toEqual(['Back', 'Newer']);
  });

  it('wakes a note early, before its date', async () => {
    const note = await createNote(userId, 'Early', '');
    await noteOps.snooze(userId, note._id, future());

    await noteOps.wake(userId, note._id);

    expect(await active()).toEqual(['Early']);
    expect(await archive()).toEqual([]);
  });

  it('does not count as an edit', async () => {
    const note = await createNote(userId, 'Back', '');
    await noteOps.snooze(userId, note._id, past());

    const woken = await noteOps.wake(userId, note._id);

    expect(woken?.updatedAt).toEqual(note.updatedAt);
  });

  it('leaves a plainly archived note alone', async () => {
    const note = await createNote(userId, 'Archived', '');
    await noteOps.archive(userId, note._id);

    const result = await noteOps.wake(userId, note._id);

    expect(result?.archived).toBe(true);
    expect(result?.position).toBe(note.position);
    expect(await archive()).toEqual(['Archived']);
  });
});

describe('archiving by hand', () => {
  it('ends a snooze when a returned note is archived again', async () => {
    const note = await createNote(userId, 'Back', '');
    await noteOps.snooze(userId, note._id, past());

    const archived = await noteOps.archive(userId, note._id);

    expect(archived?.snoozedUntil).toBeNull();
    expect(await active()).toEqual([]);
    expect(await archive()).toEqual(['Back']);
  });

  it('ends a snooze when a snoozed note is unarchived', async () => {
    const note = await createNote(userId, 'Later', '');
    await noteOps.snooze(userId, note._id, future());

    const unarchived = await noteOps.unarchive(userId, note._id);

    expect(unarchived?.archived).toBe(false);
    expect(unarchived?.snoozedUntil).toBeNull();
  });
});
