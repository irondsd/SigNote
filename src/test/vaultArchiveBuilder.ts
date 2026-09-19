import { createHash } from 'node:crypto';

import { createEncryptedVaultBackupArchive, type VaultBackupArchiveEntry } from '../lib/vaultBackup/archive';
import { vaultExportManifestWithoutDigest } from '../lib/vaultBackup/manifest';
import { collectChunks } from '../lib/vaultBackup/stream';

/**
 * Builds real, correctly encrypted v1 archives whose *contents* can be bent in
 * every way the format forbids. Used by the importer's adversarial tests.
 */

export const PASSWORD = 'correct horse battery staple';
const OPTIONS = { opsLimit: 2, memLimit: 19 * 1024 * 1024, chunkBytes: 64 * 1024 } as const;
const encoder = new TextEncoder();
export const bytes = (value: string) => encoder.encode(value);
export const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const NOW = '2026-09-18T12:00:00.000Z';

export const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'Portable',
  content: '<p>Hello</p>',
  position: 1000,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  archived: false,
  color: null,
  pattern: null,
  pinned: false,
  expiresAt: null,
  burnAfterReading: false,
  history: [],
  tagRefs: [],
  attachmentRefs: [],
  ...extra,
});

export const file = (id: string, recordId: string, extra: Record<string, unknown> = {}) => ({
  id,
  owner: { category: 'notes', recordId },
  filename: 'a.txt',
  size: 3,
  mimeType: 'text/plain',
  encrypted: false,
  encryptionIv: null,
  keyScope: 'vault',
  keyNoteId: null,
  createdAt: NOW,
  ...extra,
});

export const ndjson = (values: unknown[]) => bytes(values.map((value) => `${JSON.stringify(value)}\n`).join(''));

export type Body = { path: string; body: Uint8Array };
export type Build = {
  notes?: unknown[];
  tags?: unknown[];
  attachments?: unknown[];
  files?: Record<string, Uint8Array>;
  /** Rewrite the entry list after it is built (drop, add, reorder, corrupt). */
  entries?: (entries: Body[]) => Body[];
  /** Rewrite the manifest before its digest is computed. */
  manifest?: (manifest: Record<string, any>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Rewrite the final manifest JSON (after the digest). */
  manifestBytes?: (json: string) => string;
  /** Manifest entries describe these instead of the real bodies. */
  declared?: (entries: Body[]) => Body[];
};

export async function archive(build: Build = {}) {
  const notes = build.notes ?? [note('note-one')];
  const attachments = build.attachments ?? [];
  let bodies: Body[] = [
    { path: 'data/notes.ndjson', body: ndjson(notes) },
    { path: 'data/tags.json', body: bytes(JSON.stringify(build.tags ?? [])) },
    { path: 'attachments/index.ndjson', body: ndjson(attachments) },
    ...Object.entries(build.files ?? {}).map(([id, body]) => ({ path: `attachments/${id}`, body })),
  ];
  if (build.entries) bodies = build.entries(bodies);
  const declared = build.declared ? build.declared(bodies) : bodies;
  const manifestEntries = declared.map(({ path, body }) => ({ path, bytes: body.byteLength, sha256: hash(body) }));
  const base = {
    type: 'signote-vault-export' as const,
    formatVersion: 1 as const,
    minimumReaderVersion: 1 as const,
    exportId: '01999999-9999-7999-8999-999999999999',
    createdAt: NOW,
    source: { schemaVersion: 1 as const, profileId: null, encryptionGeneration: 0, vaultKeyId: null },
    selection: ['notes'],
    counts: { notes: notes.length, secrets: 0, seals: 0, authenticators: 0, attachments: attachments.length },
    categoryBytes: { notes: bodies[0]?.body.byteLength ?? 0, secrets: 0, seals: 0, authenticators: 0 },
    includesRetainedDeletedRecords: true as const,
  };
  const withoutDigest = vaultExportManifestWithoutDigest(base as any, manifestEntries) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  build.manifest?.(withoutDigest);
  let json = JSON.stringify({ ...withoutDigest, digest: hash(bytes(JSON.stringify(withoutDigest))) });
  if (build.manifestBytes) json = build.manifestBytes(json);
  const manifest = bytes(json);
  const entries: VaultBackupArchiveEntry[] = [
    ...bodies.map(({ path, body }) => ({ path, size: body.byteLength, source: [body] })),
    { path: 'manifest.json', size: manifest.byteLength, source: [manifest] },
  ];
  const result = await createEncryptedVaultBackupArchive(entries, PASSWORD, OPTIONS);
  const encrypted = await collectChunks(result.readable);
  await result.completed;
  return encrypted;
}
