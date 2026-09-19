import { packTar } from 'modern-tar';

import {
  createEncryptedVaultBackupArchive,
  createVaultBackupTarStream,
  readVaultBackupTarEntries,
  validateVaultBackupArchivePath,
} from '../archive';
import { decryptVaultBackupStream } from '../envelope';
import { collectChunks, readableStreamValues } from '../stream';

const TEST_OPTIONS = {
  opsLimit: 2,
  memLimit: 19 * 1024 * 1024,
  chunkBytes: 64 * 1024,
} as const;

const encoder = new TextEncoder();
const text = (value: string) => encoder.encode(value);

describe('vault backup TAR integration spike', () => {
  it('streams a standard TAR through the password envelope and parser', async () => {
    const manifest = text('{"format":"signote-vault","version":1}');
    const notes = text('{"id":"note-1","content":"hello"}\n');
    const attachment = Uint8Array.from([0, 1, 2, 3, 4]);
    const archive = await createEncryptedVaultBackupArchive(
      [
        { path: 'manifest.json', size: manifest.length, source: [manifest] },
        { path: 'data/notes.ndjson', size: notes.length, source: [notes] },
        { path: 'attachments/file-1', size: attachment.length, source: [attachment] },
      ],
      'archive test password',
      TEST_OPTIONS,
    );

    const encrypted = await collectChunks(archive.readable);
    await archive.completed;
    const tarStream = await decryptVaultBackupStream([encrypted], 'archive test password');

    const extracted: Array<readonly [string, Uint8Array]> = [];
    for await (const entry of readableStreamValues(readVaultBackupTarEntries(tarStream))) {
      extracted.push([entry.path, await collectChunks(entry.body)] as const);
    }

    expect(extracted.map(([path]) => path)).toEqual(['manifest.json', 'data/notes.ndjson', 'attachments/file-1']);
    expect(new TextDecoder().decode(extracted[0][1])).toBe('{"format":"signote-vault","version":1}');
    expect(new TextDecoder().decode(extracted[1][1])).toBe('{"id":"note-1","content":"hello"}\n');
    expect(extracted[2][1]).toEqual(attachment);
  });

  it('rejects a source whose byte length does not match its declaration', async () => {
    const archive = createVaultBackupTarStream([{ path: 'short.bin', size: 2, source: [Uint8Array.of(1)] }]);
    const consumed = collectChunks(archive.readable);
    await expect(archive.completed).rejects.toThrow('Size mismatch for "short.bin"');
    await expect(consumed).rejects.toThrow('Size mismatch for "short.bin"');
  });

  it.each(['', '/absolute', 'trailing/', 'a//b', 'a/../b', 'a/./b', 'a\\b', 'a\0b', 'a\nb', 'café'])(
    'rejects unsafe path %p',
    (path) => {
      expect(() => validateVaultBackupArchivePath(path)).toThrow();
    },
  );

  it('rejects duplicate paths before starting the TAR stream', () => {
    expect(() =>
      createVaultBackupTarStream([
        { path: 'manifest.json', size: 2, source: [text('{}')] },
        { path: 'manifest.json', size: 2, source: [text('{}')] },
      ]),
    ).toThrow('Unsafe or invalid vault archive path: manifest.json');
  });

  it('rejects case-colliding paths before starting the TAR stream', () => {
    expect(() =>
      createVaultBackupTarStream([
        { path: 'data/notes.ndjson', size: 0, source: [] },
        { path: 'DATA/NOTES.NDJSON', size: 0, source: [] },
      ]),
    ).toThrow('Unsafe or invalid vault archive path: DATA/NOTES.NDJSON');
  });

  it('rejects links while reading an external TAR', async () => {
    const archive = await packTar([
      { header: { name: 'safe.txt', size: 0, type: 'file' }, body: new Uint8Array() },
      { header: { name: 'escape', size: 0, type: 'symlink', linkname: '../../outside' } },
    ]);
    const reader = readVaultBackupTarEntries([archive]).getReader();
    const first = await reader.read();
    expect(first.value?.path).toBe('safe.txt');
    await first.value?.body.cancel();
    await expect(reader.read()).rejects.toThrow('Unsupported vault archive entry type: symlink');
  });

  it('rejects a traversal path while reading an external TAR', async () => {
    const archive = await packTar([{ header: { name: '../escape', size: 1, type: 'file' }, body: Uint8Array.of(1) }]);
    const reader = readVaultBackupTarEntries([archive]).getReader();
    await expect(reader.read()).rejects.toThrow('Unsafe or invalid vault archive path: ../escape');
  });

  it('fails strict parsing when a TAR header checksum is damaged', async () => {
    const archive = await packTar([{ header: { name: 'safe.txt', size: 1, type: 'file' }, body: Uint8Array.of(1) }]);
    const damaged = Uint8Array.from(archive);
    damaged[0] ^= 1;
    const reader = readVaultBackupTarEntries([damaged]).getReader();
    await expect(reader.read()).rejects.toThrow(/checksum/i);
  });

  it('enforces entry count and declared-byte limits before yielding excess data', async () => {
    const archive = await packTar([
      { header: { name: 'one.bin', size: 1, type: 'file' }, body: Uint8Array.of(1) },
      { header: { name: 'two.bin', size: 1, type: 'file' }, body: Uint8Array.of(2) },
    ]);
    const reader = readVaultBackupTarEntries([archive], {
      maxEntries: 1,
      maxEntryBytes: 1,
      maxTotalBytes: 1,
    }).getReader();
    const first = await reader.read();
    expect(first.value?.path).toBe('one.bin');
    await first.value?.body.cancel();
    await expect(reader.read()).rejects.toThrow('Vault archive contains too many entries');
  });

  it('rejects an entry larger than the configured limit', async () => {
    const archive = await packTar([
      { header: { name: 'large.bin', size: 2, type: 'file' }, body: Uint8Array.of(1, 2) },
    ]);
    const reader = readVaultBackupTarEntries([archive], {
      maxEntries: 1,
      maxEntryBytes: 1,
      maxTotalBytes: 2,
    }).getReader();
    await expect(reader.read()).rejects.toThrow('Vault archive entry exceeds its byte limit: large.bin');
  });
});
