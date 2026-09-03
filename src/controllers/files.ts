/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, inArray, isNotNull, isNull, lt, lte, sum } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, MAX_USER_STORAGE } from '@/config/fileConstants';
import { getDb } from '@/db/client';
import { fileAttachments, notes, sealNotes, secretNotes, type NoteTier } from '@/db/schema';
import { deleteFromS3, uploadToS3 } from '@/lib/s3';

export { MAX_FILE_SIZE, ALLOWED_MIME_TYPES };
export type { NoteTier };

export type FileRow = {
  _id: string;
  userId: string;
  noteId: string | null;
  noteTier: NoteTier | null;
  s3Key: string;
  filename: string;
  size: number;
  mimeType: string;
  encrypted: boolean;
  encryptionIv: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  storageDeletedAt: Date | null;
  deleteAttempts: number;
  lastDeleteError: string | null;
};

type RawFile = typeof fileAttachments.$inferSelect;

const mapFile = ({ id, ...rest }: RawFile): FileRow => ({ _id: id, ...rest });

export async function getUserStorageUsed(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ total: sum(fileAttachments.size) })
    .from(fileAttachments)
    .where(and(eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)));
  return Number(rows[0]?.total ?? 0);
}

export async function createFileAttachment(
  userId: string,
  file: {
    filename: string;
    size: number;
    mimeType: string;
    buffer: Buffer;
    encrypted?: boolean;
    encryptionIv?: string;
  },
): Promise<FileRow> {
  if (file.buffer.length > MAX_FILE_SIZE) {
    throw new Error('File too large');
  }
  if (!file.encrypted && !ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new Error('File type not allowed');
  }

  const used = await getUserStorageUsed(userId);
  if (used + file.size > MAX_USER_STORAGE) {
    throw new Error('Storage quota exceeded');
  }

  const fileId = uuidv7();
  const s3Key = file.encrypted
    ? `uploads/${userId}/${fileId}/encrypted`
    : `uploads/${userId}/${fileId}/${file.filename}`;
  const s3ContentType = file.encrypted ? 'application/octet-stream' : file.mimeType;

  await uploadToS3(s3Key, file.buffer, s3ContentType);

  const rows = await getDb()
    .insert(fileAttachments)
    .values({
      id: fileId,
      userId,
      filename: file.filename,
      size: file.size,
      mimeType: file.mimeType,
      s3Key,
      encrypted: file.encrypted ?? false,
      encryptionIv: file.encryptionIv ?? null,
      createdAt: new Date(),
    })
    .returning();

  return mapFile(rows[0]);
}

export async function getFileAttachment(id: string, userId: string): Promise<FileRow | null> {
  const rows = await getDb()
    .select()
    .from(fileAttachments)
    .where(and(eq(fileAttachments.id, id), eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)))
    .limit(1);
  return rows[0] ? mapFile(rows[0]) : null;
}

export async function deleteFileAttachment(id: string, userId: string): Promise<FileRow | null> {
  const rows = await getDb()
    .update(fileAttachments)
    .set({ deletedAt: new Date() })
    .where(and(eq(fileAttachments.id, id), eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)))
    .returning();
  return rows[0] ? mapFile(rows[0]) : null;
}

export async function linkFilesToNote(
  userId: string,
  noteId: string,
  noteTier: NoteTier,
  fileIds: string[],
): Promise<void> {
  if (!fileIds.length) return;
  await getDb()
    .update(fileAttachments)
    .set({ noteId, noteTier })
    .where(
      and(inArray(fileAttachments.id, fileIds), eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)),
    );
}

export async function softDeleteFilesByNoteId(noteId: string): Promise<void> {
  await getDb()
    .update(fileAttachments)
    .set({ deletedAt: new Date() })
    .where(and(eq(fileAttachments.noteId, noteId), isNull(fileAttachments.deletedAt)));
}

export async function restoreFilesByNoteId(noteId: string, userId: string): Promise<void> {
  await getDb()
    .update(fileAttachments)
    .set({ deletedAt: null })
    .where(and(eq(fileAttachments.noteId, noteId), eq(fileAttachments.userId, userId)));
}

export async function deleteFilesByUserId(userId: string): Promise<void> {
  await getDb()
    .update(fileAttachments)
    .set({ deletedAt: new Date() })
    .where(and(eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)));
}

const TIER_TABLES: Record<NoteTier, any> = {
  note: notes,
  secret: secretNotes,
  seal: sealNotes,
};

/**
 * Find live file attachments whose linked note no longer exists in the
 * corresponding tier table (typically because the note self-destructed and
 * the cleanup cron removed it) and soft-delete them. The regular
 * `cleanupDeletedFiles` pass will then remove them from S3.
 */
export async function cleanupOrphanedFiles(batchSize = 500) {
  const db = getDb();

  const files = await db
    .select({ id: fileAttachments.id, noteId: fileAttachments.noteId, noteTier: fileAttachments.noteTier })
    .from(fileAttachments)
    .where(
      and(isNull(fileAttachments.deletedAt), isNotNull(fileAttachments.noteId), isNotNull(fileAttachments.noteTier)),
    )
    .limit(batchSize);

  if (files.length === 0) return { scanned: 0, orphaned: 0 };

  // Group noteIds by tier so we only fire one IN query per tier.
  const idsByTier: Record<NoteTier, Set<string>> = { note: new Set(), secret: new Set(), seal: new Set() };
  for (const f of files) idsByTier[f.noteTier as NoteTier].add(f.noteId as string);

  const aliveByTier: Record<NoteTier, Set<string>> = { note: new Set(), secret: new Set(), seal: new Set() };

  for (const tier of Object.keys(idsByTier) as NoteTier[]) {
    const ids = [...idsByTier[tier]];
    if (ids.length === 0) continue;
    const table = TIER_TABLES[tier];
    const alive = (await (db as any).select({ id: table.id }).from(table).where(inArray(table.id, ids))) as {
      id: string;
    }[];
    for (const row of alive) aliveByTier[tier].add(row.id);
  }

  const orphanIds: string[] = [];
  for (const f of files) {
    if (!aliveByTier[f.noteTier as NoteTier].has(f.noteId as string)) orphanIds.push(f.id);
  }

  if (orphanIds.length > 0) {
    await db
      .update(fileAttachments)
      .set({ deletedAt: new Date() })
      .where(and(inArray(fileAttachments.id, orphanIds), isNull(fileAttachments.deletedAt)));
  }

  return { scanned: files.length, orphaned: orphanIds.length };
}

const MAX_DELETE_ATTEMPTS = 5;

export async function cleanupDeletedFiles(batchSize = 50) {
  const db = getDb();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);

  const files = await db
    .select()
    .from(fileAttachments)
    .where(
      and(
        lte(fileAttachments.deletedAt, cutoff),
        isNull(fileAttachments.storageDeletedAt),
        lt(fileAttachments.deleteAttempts, MAX_DELETE_ATTEMPTS),
      ),
    )
    .limit(batchSize);

  let deleted = 0;
  let failed = 0;

  for (const file of files) {
    try {
      await deleteFromS3(file.s3Key);
      await db.update(fileAttachments).set({ storageDeletedAt: new Date() }).where(eq(fileAttachments.id, file.id));
      deleted++;
    } catch (err) {
      await db
        .update(fileAttachments)
        .set({
          deleteAttempts: file.deleteAttempts + 1,
          lastDeleteError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(fileAttachments.id, file.id));
      failed++;
    }
  }

  return { processed: files.length, deleted, failed };
}
