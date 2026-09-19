import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseVaultImportArchive } from '../importArchive';

/** The committed v1 sample (see tests/specs/vault-golden.spec.ts). The reader
 * must keep accepting it exactly as it was written. */
const dir = path.resolve(process.cwd(), 'tests/fixtures/vault-archives');
const expected = JSON.parse(readFileSync(path.join(dir, 'v1-sample.json'), 'utf8'));

it('still reads the committed v1 sample archive', async () => {
  const bytes = new Uint8Array(readFileSync(path.join(dir, 'v1-sample.snvault')));
  const { analysis, records } = await parseVaultImportArchive([bytes], expected.archivePassword);

  expect(analysis.manifest).toMatchObject({ type: 'signote-vault-export', formatVersion: 1 });
  expect(analysis.manifest.selection).toEqual(['notes', 'secrets', 'seals', 'authenticators']);
  expect(analysis.profile?.vaultKeyId).toBe(analysis.manifest.source.vaultKeyId);
  expect(records.notes).toMatchObject([{ id: expected.note.id, content: expected.note.content }]);
  expect(records.secrets).toMatchObject([{ id: expected.secret.id, title: expected.secret.title }]);
  expect(records.seals).toMatchObject([{ id: expected.seal.id, title: expected.seal.title }]);
  expect(records.authenticators).toMatchObject([{ id: expected.authenticator.id }]);
  expect(analysis.attachments.map((file) => file.id).sort()).toEqual(
    expected.files.map((file: { id: string }) => file.id).sort(),
  );
  expect(analysis.tags.map((tag) => tag.normalizedName)).toEqual(expected.note.tags);
});

it('does not open the sample with the wrong password', async () => {
  const bytes = new Uint8Array(readFileSync(path.join(dir, 'v1-sample.snvault')));
  await expect(parseVaultImportArchive([bytes], 'not the sample password')).rejects.toMatchObject({
    code: 'WRONG_PASSWORD',
  });
});
