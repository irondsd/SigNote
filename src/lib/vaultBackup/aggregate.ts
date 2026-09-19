import type { VaultExportCategory } from './exportTypes';
import type { PortableAttachment, PortableAuthenticator, PortableTierRecord } from './importTypes';

/**
 * The canonical aggregate a merge compares: one record with everything that
 * travels with it — head, retained history, ordered tag *names* and attachment
 * metadata. The import Worker digests the archived copy, the server digests the
 * destination copy, and equal digests mean "identical, skip it".
 *
 * Both sides must produce byte-identical JSON, so this module has no platform
 * dependencies and does its own key ordering. It deliberately leaves out what
 * is destination-specific: owner, storage keys, search vectors, `seq` numbers
 * and tag ids (tags are identified by normalized name across accounts).
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonical(value: unknown): Json {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    // Code-unit order, not localeCompare: the result must not depend on the
    // runtime's locale data.
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out: { [key: string]: Json } = {};
    for (const key of keys) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) out[key] = canonical(entry);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number in aggregate');
  return value as Json;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

/** Dates may arrive as `Date` (database rows) or ISO strings (archive JSON). */
type Datelike = Date | string;
const iso = (value: Datelike | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

type AttachmentLike = Omit<PortableAttachment, 'createdAt'> & { createdAt: Datelike };

export function attachmentAggregate(attachment: AttachmentLike) {
  return {
    id: attachment.id,
    owner: { category: attachment.owner.category, recordId: attachment.owner.recordId },
    filename: attachment.filename,
    size: attachment.size,
    mimeType: attachment.mimeType,
    encrypted: attachment.encrypted,
    encryptionIv: attachment.encryptionIv,
    keyScope: attachment.keyScope,
    keyNoteId: attachment.keyNoteId,
    createdAt: iso(attachment.createdAt),
  };
}

type TierLike = Omit<PortableTierRecord, 'createdAt' | 'updatedAt' | 'deletedAt' | 'expiresAt' | 'history'> & {
  createdAt: Datelike;
  updatedAt: Datelike;
  deletedAt: Datelike | null;
  expiresAt: Datelike | null;
  history: Array<{ title: string; createdAt: Datelike; content?: string; encryptedBody?: unknown }>;
};

/**
 * @param tagNames the record's tags as normalized names, in the record's order
 * @param attachments the record's attachments (any order)
 */
export function tierAggregate(
  category: Exclude<VaultExportCategory, 'authenticators'>,
  record: TierLike,
  tagNames: string[],
  attachments: AttachmentLike[],
) {
  return {
    category,
    id: record.id,
    title: record.title,
    content: category === 'notes' ? (record.content ?? '') : undefined,
    encryptedBody: category === 'notes' ? undefined : (record.encryptedBody ?? null),
    wrappedNoteKey: category === 'seals' ? (record.wrappedNoteKey ?? null) : undefined,
    position: record.position,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: iso(record.deletedAt),
    archived: record.archived,
    color: record.color,
    pattern: record.pattern,
    pinned: record.pinned,
    expiresAt: iso(record.expiresAt),
    burnAfterReading: record.burnAfterReading,
    history: record.history.map((version) => ({
      title: version.title,
      content: category === 'notes' ? (version.content ?? '') : undefined,
      encryptedBody: category === 'notes' ? undefined : (version.encryptedBody ?? null),
      createdAt: iso(version.createdAt),
    })),
    tags: tagNames,
    attachments: attachments.map(attachmentAggregate).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

type AuthenticatorLike = Omit<PortableAuthenticator, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  createdAt: Datelike;
  updatedAt: Datelike;
  deletedAt: Datelike | null;
};

/** `revision` is left out: it counts writes on one deployment, not content. */
export function authenticatorAggregate(record: AuthenticatorLike) {
  return {
    category: 'authenticators' as const,
    id: record.id,
    payload: record.payload,
    payloadVersion: record.payloadVersion,
    position: record.position,
    archived: record.archived,
    color: record.color,
    pattern: record.pattern,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: iso(record.deletedAt),
  };
}
