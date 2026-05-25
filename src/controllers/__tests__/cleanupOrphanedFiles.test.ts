import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FileAttachmentModel } from '@/models/FileAttachment';
import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { cleanupOrphanedFiles } from '../files';

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
    FileAttachmentModel.deleteMany({}),
    NoteModel.deleteMany({}),
    SecretNoteModel.deleteMany({}),
    SealNoteModel.deleteMany({}),
  ]);
});

const userId = '0xabc';

async function seedNote() {
  return NoteModel.create({ userId, title: 't', content: 'c', position: 1 });
}
async function seedSecret() {
  return SecretNoteModel.create({ userId, title: 't', encryptedBody: null, position: 1 });
}
async function seedSeal() {
  return SealNoteModel.create({
    userId,
    title: 't',
    encryptedBody: null,
    wrappedNoteKey: null,
    position: 1,
  });
}

async function seedFile(noteId: string, noteTier: 'note' | 'secret' | 'seal') {
  return FileAttachmentModel.create({
    userId,
    noteId,
    noteTier,
    s3Key: `uploads/${userId}/${noteId}/x`,
    filename: 'x',
    size: 1,
    mimeType: 'application/octet-stream',
  });
}

describe('cleanupOrphanedFiles', () => {
  it('returns scanned=0, orphaned=0 when there are no linked files', async () => {
    const result = await cleanupOrphanedFiles();
    expect(result).toEqual({ scanned: 0, orphaned: 0 });
  });

  it('does not flag files whose linked note is alive', async () => {
    const note = await seedNote();
    const secret = await seedSecret();
    const seal = await seedSeal();
    await seedFile(note._id.toString(), 'note');
    await seedFile(secret._id.toString(), 'secret');
    await seedFile(seal._id.toString(), 'seal');

    const result = await cleanupOrphanedFiles();
    expect(result.orphaned).toBe(0);

    const alive = await FileAttachmentModel.find({ deletedAt: null }).countDocuments();
    expect(alive).toBe(3);
  });

  it('soft-deletes files whose linked note has been removed', async () => {
    const note = await seedNote();
    const file = await seedFile(note._id.toString(), 'note');

    // Note vanishes (e.g., TTL fired).
    await NoteModel.deleteOne({ _id: note._id });

    const result = await cleanupOrphanedFiles();
    expect(result.scanned).toBe(1);
    expect(result.orphaned).toBe(1);

    const reloaded = await FileAttachmentModel.findById(file._id);
    expect(reloaded?.deletedAt).toBeInstanceOf(Date);
  });

  it('only treats a file as orphaned if its OWN tier has no matching note', async () => {
    // Edge case: a file linked to tier 'note' with a noteId that ALSO exists
    // (with the same ObjectId) as a secret should still be considered orphaned.
    const sharedId = new mongoose.Types.ObjectId();
    await SecretNoteModel.create({
      _id: sharedId,
      userId,
      title: 't',
      encryptedBody: null,
      position: 1,
    });
    const file = await seedFile(sharedId.toString(), 'note'); // linked to NOTE tier, not secret

    const result = await cleanupOrphanedFiles();
    expect(result.orphaned).toBe(1);

    const reloaded = await FileAttachmentModel.findById(file._id);
    expect(reloaded?.deletedAt).toBeInstanceOf(Date);
  });

  it('does not re-process files that are already soft-deleted', async () => {
    const note = await seedNote();
    const file = await seedFile(note._id.toString(), 'note');
    file.deletedAt = new Date();
    await file.save();
    await NoteModel.deleteOne({ _id: note._id });

    const result = await cleanupOrphanedFiles();
    expect(result.scanned).toBe(0); // already deleted file not in scan
    expect(result.orphaned).toBe(0);
  });

  it('mixes tiers in one pass', async () => {
    const liveNote = await seedNote();
    const deadSecret = await seedSecret();
    const deadSeal = await seedSeal();
    await seedFile(liveNote._id.toString(), 'note');
    const orphanA = await seedFile(deadSecret._id.toString(), 'secret');
    const orphanB = await seedFile(deadSeal._id.toString(), 'seal');

    await SecretNoteModel.deleteOne({ _id: deadSecret._id });
    await SealNoteModel.deleteOne({ _id: deadSeal._id });

    const result = await cleanupOrphanedFiles();
    expect(result.scanned).toBe(3);
    expect(result.orphaned).toBe(2);

    const aliveStill = await FileAttachmentModel.find({ deletedAt: null });
    expect(aliveStill).toHaveLength(1);
    expect(aliveStill[0].noteId).toBe(liveNote._id.toString());

    expect((await FileAttachmentModel.findById(orphanA._id))?.deletedAt).toBeInstanceOf(Date);
    expect((await FileAttachmentModel.findById(orphanB._id))?.deletedAt).toBeInstanceOf(Date);
  });
});
