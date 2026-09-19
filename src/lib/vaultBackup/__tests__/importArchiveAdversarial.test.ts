import { parseVaultImportArchive } from '../importArchive';
import { PASSWORD, archive, bytes, file, hash, ndjson, note, type Build } from '@/test/vaultArchiveBuilder';

/**
 * Every archive here is correctly encrypted under the right password: the
 * envelope authenticates it, so these probe what a hostile *writer* can do.
 * Import must treat an authenticated archive as untrusted all the same.
 */

const rejects = async (build: Build) =>
  expect(parseVaultImportArchive([await archive(build)], PASSWORD)).rejects.toMatchObject({
    code: 'INVALID_ARCHIVE',
  });

describe('hostile but authenticated archives', () => {
  it('accepts the unmodified baseline', async () => {
    const parsed = await parseVaultImportArchive(
      [
        await archive({
          notes: [note('note-one', { attachmentRefs: ['f1'], tagRefs: ['t1'] })],
          tags: [{ sourceId: 't1', normalizedName: 'work' }],
          attachments: [file('f1', 'note-one')],
          files: { f1: bytes('abc') },
        }),
      ],
      PASSWORD,
    );
    expect(parsed.analysis.attachments).toMatchObject([{ id: 'f1', size: 3, checksum: hash(bytes('abc')) }]);
  });

  it('accepts a Notes-only export that names its source vault without carrying its profile', async () => {
    const parsed = await parseVaultImportArchive(
      [
        await archive({
          manifest: (manifest) => (manifest.source.vaultKeyId = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
        }),
      ],
      PASSWORD,
    );
    expect(parsed.analysis.profile).toBeNull();
  });

  describe('manifest integrity', () => {
    it('rejects an entry whose bytes differ from its declared checksum', async () => {
      await rejects({
        declared: (entries) =>
          entries.map((entry) =>
            entry.path === 'data/notes.ndjson' ? { ...entry, body: ndjson([note('someone-else')]) } : entry,
          ),
      });
    });

    it('rejects a manifest whose digest does not cover its contents', async () => {
      await rejects({ manifestBytes: (json) => json.replace('"encryptionGeneration":0', '"encryptionGeneration":7') });
    });

    it('rejects counts that disagree with the records', async () => {
      await rejects({ manifest: (manifest) => (manifest.counts.notes = 2) });
    });

    it('rejects an unsupported format version even with a valid digest', async () => {
      await rejects({ manifest: (manifest) => (manifest.formatVersion = 2) });
    });

    it('rejects unknown manifest members', async () => {
      await rejects({ manifest: (manifest) => (manifest.surprise = true) });
    });
  });

  describe('entry set', () => {
    it('rejects a missing required entry', async () => {
      await rejects({
        entries: (entries) => entries.filter((entry) => entry.path !== 'data/tags.json'),
      });
    });

    it('rejects an undeclared extra entry', async () => {
      await rejects({
        entries: (entries) => [...entries, { path: 'extra/notes.txt', body: bytes('x') }],
        declared: (entries) => entries.filter((entry) => entry.path !== 'extra/notes.txt'),
      });
    });

    it('rejects data for a category outside the selection', async () => {
      await rejects({
        entries: (entries) => [...entries, { path: 'data/seals.ndjson', body: new Uint8Array() }],
      });
    });

    it('rejects entries in an order other than the manifest declares', async () => {
      await rejects({ declared: (entries) => [...entries].reverse() });
    });

    it('rejects an attachment body with no index entry', async () => {
      await rejects({ files: { orphan: bytes('abc') } });
    });
  });

  describe('records', () => {
    it('rejects duplicate record ids', async () => {
      await rejects({ notes: [note('twice'), note('twice')] });
    });

    it('rejects unknown record fields', async () => {
      await rejects({ notes: [note('n', { ownerUserId: 'someone' })] });
    });

    it('rejects an oversized title', async () => {
      await rejects({ notes: [note('n', { title: 'x'.repeat(10_000) })] });
    });

    it('rejects pathologically nested JSON without exhausting the stack', async () => {
      const nested = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
      await rejects({
        entries: (entries) =>
          entries.map((entry) =>
            entry.path === 'data/notes.ndjson' ? { ...entry, body: bytes(`${nested}\n`) } : entry,
          ),
      });
    });

    it('rejects invalid UTF-8', async () => {
      await rejects({
        entries: (entries) =>
          entries.map((entry) =>
            entry.path === 'data/notes.ndjson' ? { ...entry, body: Uint8Array.of(0xff, 0xfe, 0x0a) } : entry,
          ),
      });
    });

    it('rejects a record line without its terminating newline', async () => {
      await rejects({
        entries: (entries) =>
          entries.map((entry) =>
            entry.path === 'data/notes.ndjson' ? { ...entry, body: bytes(JSON.stringify(note('n'))) } : entry,
          ),
      });
    });
  });

  describe('relationships', () => {
    it('rejects a tag reference with no tag', async () => {
      await rejects({ notes: [note('n', { tagRefs: ['missing'] })] });
    });

    it('rejects an attachment reference with no attachment', async () => {
      await rejects({ notes: [note('n', { attachmentRefs: ['missing'] })] });
    });

    it('rejects an attachment claimed by a record that does not own it', async () => {
      await rejects({
        notes: [note('a', { attachmentRefs: ['f1'] }), note('b')],
        attachments: [file('f1', 'b')],
        files: { f1: bytes('abc') },
      });
    });

    it('rejects an attachment no record references', async () => {
      await rejects({ attachments: [file('f1', 'note-one')], files: { f1: bytes('abc') } });
    });

    it('rejects an attachment whose declared size disagrees with its body', async () => {
      await rejects({
        notes: [note('n', { attachmentRefs: ['f1'] })],
        attachments: [file('f1', 'n', { size: 99 })],
        files: { f1: bytes('abc') },
      });
    });

    it('rejects a Seal-keyed attachment outside its Seal', async () => {
      await rejects({
        notes: [note('n', { attachmentRefs: ['f1'] })],
        attachments: [
          file('f1', 'n', { keyScope: 'seal', keyNoteId: 'n', encrypted: true, encryptionIv: 'AAAAAAAAAAAAAAAA' }),
        ],
        files: { f1: bytes('abc') },
      });
    });
  });
});
