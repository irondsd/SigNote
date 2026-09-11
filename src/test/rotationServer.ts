/**
 * An in-memory stand-in for the rotation service, enforcing the rules the
 * engine actually has to satisfy.
 *
 * It is not a mock of the engine's calls: it holds real staged rows, binds
 * idempotency keys to payload digests, refuses a Seal body whose wrapper is not
 * staged, and keeps a real object store with checksum and conditional-create
 * behaviour. It shares `digest()` with the production server rather than
 * reimplementing it, so a client digest that disagrees fails here too.
 *
 * What it deliberately does not model is authorization, account locking or the
 * session prerequisite — those are the database's, and are covered by the
 * part-1 PostgreSQL integration tests.
 */

import { createHash } from 'node:crypto';

import { digest } from '@/server/rotation/contracts';
import type { RotationCipherValue, RotationKind } from '@/db/schema';
import type { RotationApi, RotationItem, RotationStatus } from '@/lib/rotation/engine';

export type SeedItem = {
  kind: RotationKind;
  resourceId: string;
  parentId?: string | null;
  source: RotationCipherValue;
};

type Row = {
  kind: RotationKind;
  resourceId: string;
  parentId: string | null;
  source: RotationCipherValue;
  sourceDigest: string;
  replacement: RotationCipherValue;
  replacementDigest: string | null;
  verifiedDigest: string | null;
  stageKey: string | null;
  stagedBytes: number;
  fileGrant: { key: string; bytes: number; checksum: string; iv: string } | null;
  grantExpiresAt: Date | null;
  fileVerified: boolean;
};

export class FakeRotationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FakeRotationError';
  }
}

export type FakeServerOptions = {
  operationId?: string;
  pageSize?: number;
  /** Objects the frozen inventory's files already live in. */
  objects?: Map<string, ArrayBuffer>;
  /** Thrown once, at the start of the named call, then cleared. */
  faults?: Map<string, Error>;
};

const key = (kind: RotationKind, resourceId: string) => `${kind}:${resourceId}`;
const sha256 = (bytes: ArrayBuffer) => createHash('sha256').update(Buffer.from(bytes)).digest('base64');

export function createFakeRotationServer(seed: SeedItem[], options: FakeServerOptions = {}) {
  const operationId = options.operationId ?? '00000000-0000-7000-8000-000000000001';
  const pageSize = options.pageSize ?? 50;
  const objects = options.objects ?? new Map<string, ArrayBuffer>();
  const faults = options.faults ?? new Map<string, Error>();
  const calls: string[] = [];
  let grantCounter = 0;

  const rows = new Map<string, Row>(
    seed.map((item) => [
      key(item.kind, item.resourceId),
      {
        kind: item.kind,
        resourceId: item.resourceId,
        parentId: item.parentId ?? null,
        source: item.source,
        sourceDigest: digest(item.source),
        replacement: null,
        replacementDigest: null,
        verifiedDigest: null,
        stageKey: null,
        stagedBytes: 0,
        fileGrant: null,
        grantExpiresAt: null,
        fileVerified: false,
      },
    ]),
  );

  /** The server's ordering: lexicographic by kind, then by resource id. */
  const ordered = () =>
    [...rows.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.resourceId.localeCompare(b.resourceId));

  const record = (name: string) => {
    calls.push(name);
    const fault = faults.get(name);
    if (fault) {
      faults.delete(name);
      throw fault;
    }
  };

  const get = (kind: RotationKind, resourceId: string): Row => {
    const row = rows.get(key(kind, resourceId));
    if (!row) throw new FakeRotationError('NOT_FOUND');
    return row;
  };

  const stageValue = (row: Row, value: RotationCipherValue, stageKey: string): Row => {
    const hash = digest(value);
    if (row.replacementDigest !== null) {
      // Same key and same payload replays the receipt; anything else conflicts.
      if (row.replacementDigest !== hash || row.stageKey !== stageKey) throw new FakeRotationError('CONFLICT');
      return row;
    }
    row.replacement = value;
    row.replacementDigest = hash;
    row.stageKey = stageKey;
    row.stagedBytes = Buffer.byteLength(JSON.stringify(value));
    return row;
  };

  const status = (): RotationStatus =>
    ({
      operationId,
      phase: [...rows.values()].every((row) => row.verifiedDigest !== null) ? 'ready' : 'migrating',
      itemCount: rows.size,
    }) as unknown as RotationStatus;

  const api: RotationApi = {
    async inventory({ after }) {
      record('inventory');
      const all = ordered();
      const index = after ? all.findIndex((row) => row.kind === after.kind && row.resourceId === after.resourceId) : -1;
      if (after && index === -1) throw new FakeRotationError('INVALID_INPUT');
      const page = all.slice(index + 1, index + 1 + pageSize);
      const last = page.at(-1);
      const consumed = index + 1 + page.length;
      return {
        items: page.map((row) => ({ ...row, operationId }) as unknown as RotationItem),
        next: last && consumed < all.length ? { kind: last.kind, resourceId: last.resourceId } : null,
      };
    },

    async stage({ item, replacement, stageKey }) {
      record(`stage:${item.kind}:${item.resourceId}`);
      const row = get(item.kind, item.resourceId);
      if (row.kind === 'file') throw new FakeRotationError('INVALID_INPUT');
      if (row.source === null ? replacement !== null : replacement === null) {
        throw new FakeRotationError('INVALID_INPUT');
      }
      // A Seal body can only be staged once its new note key exists.
      if ((row.kind === 'seal' || row.kind === 'seal-version') && row.source !== null) {
        const wrapper = get('seal-wrapper', row.parentId!);
        if (wrapper.replacementDigest === null) throw new FakeRotationError('INCOMPLETE');
      }
      if (row.source !== null && digest(row.source) === digest(replacement)) {
        throw new FakeRotationError('INVALID_INPUT');
      }
      return { ...stageValue(row, replacement, stageKey), operationId } as unknown as RotationItem;
    },

    async verify({ item, replacementDigest }) {
      record(`verify:${item.kind}:${item.resourceId}`);
      const row = get(item.kind, item.resourceId);
      if (row.replacementDigest === null || row.replacementDigest !== replacementDigest) {
        throw new FakeRotationError('CONFLICT');
      }
      if (row.kind === 'file' && !row.fileVerified) throw new FakeRotationError('CONFLICT');
      row.verifiedDigest = replacementDigest;
      return status();
    },

    async sourceFile({ resourceId }) {
      record(`sourceFile:${resourceId}`);
      const row = get('file', resourceId);
      const source = row.source as { key: string; iv: string; bytes: number };
      return { url: `memory://${source.key}`, bytes: source.bytes, iv: source.iv };
    },

    async reserveFile({ resourceId, file }) {
      record(`reserveFile:${resourceId}`);
      const row = get('file', resourceId);
      const source = row.source as { key: string; iv: string; bytes: number };
      if (file.bytes !== source.bytes || file.iv === source.iv) throw new FakeRotationError('INVALID_INPUT');
      if (row.replacementDigest !== null) throw new FakeRotationError('CONFLICT');
      if (!row.fileGrant || row.fileGrant.iv !== file.iv || row.fileGrant.checksum !== file.checksum) {
        row.fileGrant = { key: `rotation/${operationId}/object-${++grantCounter}`, ...file };
      }
      return {
        object: row.fileGrant,
        grant: {
          url: `memory://${row.fileGrant.key}`,
          headers: { 'if-none-match': '*', 'x-amz-checksum-sha256': row.fileGrant.checksum },
        },
        expiresAt: new Date(Date.now() + 60_000),
      };
    },

    async finalizeFile({ resourceId, objectKey, stageKey }) {
      record(`finalizeFile:${resourceId}`);
      const row = get('file', resourceId);
      if (!row.fileGrant || row.fileGrant.key !== objectKey) throw new FakeRotationError('CONFLICT');
      const stored = objects.get(objectKey);
      // Verification reads the origin bytes, never the uploader's claim.
      if (!stored || stored.byteLength !== row.fileGrant.bytes || sha256(stored) !== row.fileGrant.checksum) {
        throw new FakeRotationError('OBJECT_MISMATCH');
      }
      const staged = stageValue(row, row.fileGrant, stageKey);
      staged.fileVerified = true;
      return { ...staged, operationId } as unknown as RotationItem;
    },

    async stagedFile({ resourceId }) {
      record(`stagedFile:${resourceId}`);
      const row = get('file', resourceId);
      if (!row.fileVerified || row.replacementDigest === null) throw new FakeRotationError('INCOMPLETE');
      const replacement = row.replacement as { key: string; iv: string; bytes: number };
      return {
        url: `memory://${replacement.key}`,
        iv: replacement.iv,
        bytes: replacement.bytes,
        replacementDigest: row.replacementDigest,
      };
    },

    async confirmRecovery() {
      record('confirmRecovery');
      return status();
    },

    async commit() {
      record('commit');
      // An untouched row has both digests null, so equality alone would let an
      // empty staging table pass. Presence is checked first, as the real
      // service does.
      const incomplete = [...rows.values()].filter(
        (row) => row.replacementDigest === null || row.verifiedDigest !== row.replacementDigest,
      );
      if (incomplete.length > 0) throw new FakeRotationError('INCOMPLETE');
      return { ...status(), phase: 'committed' } as unknown as RotationStatus;
    },
  };

  /** The signed-transfer side, with conditional create and no overwrite. */
  const transfer = {
    async download(url: string) {
      const fault = faults.get(`download:${url.replace('memory://', '')}`);
      if (fault) {
        faults.delete(`download:${url.replace('memory://', '')}`);
        throw fault;
      }
      const object = objects.get(url.replace('memory://', ''));
      if (!object) throw new Error(`missing object ${url}`);
      return object;
    },
    async upload(url: string, headers: Record<string, string>, body: ArrayBuffer) {
      const objectKey = url.replace('memory://', '');
      const fault = faults.get('upload');
      if (fault) {
        faults.delete('upload');
        throw fault;
      }
      if (headers['if-none-match'] === '*' && objects.has(objectKey)) {
        const error = new Error('PreconditionFailed');
        (error as { data?: unknown }).data = { code: 'CONFLICT', httpStatus: 412 };
        throw error;
      }
      if (headers['x-amz-checksum-sha256'] !== sha256(body)) throw new Error('BadDigest');
      objects.set(objectKey, body);
    },
  };

  return {
    api,
    transfer,
    objects,
    calls,
    rows,
    operationId,
    row: (kind: RotationKind, resourceId: string) => get(kind, resourceId),
    token: { operationId, generation: 0, workerFence: 1 },
  };
}
