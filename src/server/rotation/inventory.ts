import { asc, eq, inArray, isNull, and, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  secretNotes,
  secretNoteVersions,
  sealNotes,
  sealNoteVersions,
  secretNoteTags,
  sealNoteTags,
  otpRecords,
  fileAttachments,
  type RotationKind,
  type RotationCipherValue,
} from '@/db/schema';
import { digest, jsonBytes, payloadSchema, RotationError, type RotationLimits } from './contracts';

export type InventoryEntry = {
  kind: RotationKind;
  resourceId: string;
  parentId: string | null;
  source: RotationCipherValue;
  sourceDigest: string;
};
export async function captureInventory(db: Db, userId: string, limits: RotationLimits) {
  // Admission before materializing JSON: 501 maximum-sized rows can otherwise
  // allocate hundreds of MB just to discover the 32 MiB limit. Ciphertext-only
  // bytes are a lower bound; exact serialized accounting follows below.
  const admission = await db.execute(sql`
    select count(*)::int as items, coalesce(sum(bytes), 0)::bigint as bytes from (
      select coalesce(octet_length(encrypted_body->>'ciphertext'), 0) as bytes from secret_notes where user_id = ${userId}
      union all select coalesce(octet_length(encrypted_body->>'ciphertext'), 0) from seal_notes where user_id = ${userId}
      union all select coalesce(octet_length(wrapped_note_key->>'ciphertext'), 0) from seal_notes where user_id = ${userId}
      union all select coalesce(octet_length(v.encrypted_body->>'ciphertext'), 0) from secret_note_versions v join secret_notes n on n.id = v.note_id where n.user_id = ${userId}
      union all select coalesce(octet_length(v.encrypted_body->>'ciphertext'), 0) from seal_note_versions v join seal_notes n on n.id = v.note_id where n.user_id = ${userId}
      union all select coalesce(octet_length(payload->>'ciphertext'), 0) from otp_records where user_id = ${userId}
      union all select 0 from file_attachments where user_id = ${userId} and encrypted and storage_deleted_at is null
    ) resources
  `);
  const raw = admission as unknown as
    { rows?: { items: number; bytes: string | number }[] } | { items: number; bytes: string | number }[];
  const bound = (Array.isArray(raw) ? raw : raw.rows!)[0];
  if (Number(bound.items) > limits.maxItems || Number(bound.bytes) > limits.maxSourceBytes)
    throw new RotationError('LIMIT');
  const entries: InventoryEntry[] = [];
  let sourceBytes = 0;
  let fileBytes = 0;
  const add = (
    kind: RotationKind,
    row: { id: string },
    source: RotationCipherValue,
    parentId: string | null = null,
    metadata: unknown = row,
  ) => {
    if (kind !== 'file' && source !== null && !payloadSchema.safeParse(source).success)
      throw new RotationError('SOURCE_CORRUPT');
    sourceBytes += jsonBytes(source);
    if (entries.length >= limits.maxItems || sourceBytes > limits.maxSourceBytes) throw new RotationError('LIMIT');
    entries.push({ kind, resourceId: row.id, parentId, source, sourceDigest: digest(metadata) });
  };
  const secrets = await db
    .select()
    .from(secretNotes)
    .where(eq(secretNotes.userId, userId))
    .orderBy(asc(secretNotes.id))
    .limit(limits.maxItems + 1);
  const seals = await db
    .select()
    .from(sealNotes)
    .where(eq(sealNotes.userId, userId))
    .orderBy(asc(sealNotes.id))
    .limit(limits.maxItems + 1);
  // Query every retained row, without normal list visibility or burn side effects.
  const secretTags = secrets.length
    ? await db
        .select()
        .from(secretNoteTags)
        .where(
          inArray(
            secretNoteTags.noteId,
            secrets.map((row) => row.id),
          ),
        )
        .orderBy(asc(secretNoteTags.noteId), asc(secretNoteTags.sortOrder), asc(secretNoteTags.tagId))
    : [];
  const sealTags = seals.length
    ? await db
        .select()
        .from(sealNoteTags)
        .where(
          inArray(
            sealNoteTags.noteId,
            seals.map((row) => row.id),
          ),
        )
        .orderBy(asc(sealNoteTags.noteId), asc(sealNoteTags.sortOrder), asc(sealNoteTags.tagId))
    : [];
  for (const row of secrets)
    add('secret', row, row.encryptedBody, null, { row, tags: secretTags.filter((tag) => tag.noteId === row.id) });
  for (const row of seals) {
    if (row.encryptedBody !== null && row.wrappedNoteKey === null) throw new RotationError('SOURCE_CORRUPT');
    add('seal-wrapper', row, row.wrappedNoteKey);
    add('seal', row, row.encryptedBody, row.id, { row, tags: sealTags.filter((tag) => tag.noteId === row.id) });
  }
  if (secrets.length) {
    const versions = await db
      .select()
      .from(secretNoteVersions)
      .where(
        inArray(
          secretNoteVersions.noteId,
          secrets.map((row) => row.id),
        ),
      )
      .orderBy(asc(secretNoteVersions.seq))
      .limit(limits.maxItems + 1);
    for (const row of versions) add('secret-version', row, row.encryptedBody, row.noteId);
  }
  if (seals.length) {
    const versions = await db
      .select()
      .from(sealNoteVersions)
      .where(
        inArray(
          sealNoteVersions.noteId,
          seals.map((row) => row.id),
        ),
      )
      .orderBy(asc(sealNoteVersions.seq))
      .limit(limits.maxItems + 1);
    for (const row of versions) {
      if (row.encryptedBody !== null && !seals.find((head) => head.id === row.noteId)?.wrappedNoteKey)
        throw new RotationError('SOURCE_CORRUPT');
      add('seal-version', row, row.encryptedBody, row.noteId);
    }
  }
  const auths = await db
    .select()
    .from(otpRecords)
    .where(eq(otpRecords.userId, userId))
    .orderBy(asc(otpRecords.id))
    .limit(limits.maxItems + 1);
  for (const row of auths) {
    if (row.payload !== null && (row.payloadVersion !== 1 || row.deletedAt !== null))
      throw new RotationError('SOURCE_CORRUPT');
    add('auth', row, row.payload);
  }
  const files = await db
    .select()
    .from(fileAttachments)
    .where(
      and(
        eq(fileAttachments.userId, userId),
        eq(fileAttachments.encrypted, true),
        isNull(fileAttachments.storageDeletedAt),
      ),
    )
    .orderBy(asc(fileAttachments.id))
    .limit(limits.maxItems + 1);
  for (const row of files) {
    if (
      !row.encryptionIv ||
      !row.s3Key ||
      row.size < 16 ||
      row.size > limits.maxFileSize ||
      Buffer.from(row.encryptionIv, 'base64').length !== 12
    )
      throw new RotationError('SOURCE_CORRUPT');
    fileBytes += row.size;
    if (fileBytes > limits.maxFileBytes) throw new RotationError('LIMIT');
    add('file', row, { key: row.s3Key, iv: row.encryptionIv, bytes: row.size, checksum: '' });
  }
  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.resourceId.localeCompare(b.resourceId));
  return {
    entries,
    sourceBytes,
    fileBytes,
    inventoryDigest: digest(entries.map(({ kind, resourceId, sourceDigest }) => ({ kind, resourceId, sourceDigest }))),
  };
}
