/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, exists, gt, inArray, isNotNull, isNull, lt, lte, or, sum } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, MAX_USER_STORAGE } from '@/config/fileConstants';
import { getDb } from '@/db/client';
import { currentRequestGeneration, withVaultMaintenance, withVaultRead, withVaultWrite } from '@/db/encryptionState';
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
  generation: number;
};

type RawFile = typeof fileAttachments.$inferSelect;

const mapFile = ({ id, ...rest }: RawFile, generation = 0): FileRow => ({ _id: id, ...rest, generation });

export async function getUserStorageUsed(userId: string): Promise<number> {
  return withVaultRead(userId, async () => {
    const rows = await getDb()
      .select({ total: sum(fileAttachments.size) })
      .from(fileAttachments)
      .where(and(eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)));
    return Number(rows[0]?.total ?? 0);
  });
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
  return withVaultWrite(userId, async () => {
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new Error('File too large');
    }
    if (!file.encrypted && !ALLOWED_MIME_TYPES.has(file.mimeType)) {
      throw new Error('File type not allowed');
    }

    const usedRows = await getDb()
      .select({ total: sum(fileAttachments.size) })
      .from(fileAttachments)
      .where(and(eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)));
    const used = Number(usedRows[0]?.total ?? 0);
    if (used + file.size > MAX_USER_STORAGE) {
      throw new Error('Storage quota exceeded');
    }

    const fileId = uuidv7();
    const s3Key = file.encrypted
      ? `uploads/${userId}/${fileId}/encrypted`
      : `uploads/${userId}/${fileId}/${file.filename}`;
    const s3ContentType = file.encrypted ? 'application/octet-stream' : file.mimeType;

    // The account lock is deliberately held across the external upload and the
    // publication insert. This makes the final DB write a fenced publication:
    // begin/activation cannot snapshot the account between quota check, upload,
    // and pointer creation. Activation itself never performs S3 I/O.
    await uploadToS3(s3Key, file.buffer, s3ContentType);
    try {
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

      return mapFile(rows[0], currentRequestGeneration());
    } catch (err) {
      // A DB publication failure must not leave a live object for orphan
      // cleanup to discover later. The delete is best effort; the fenced row
      // was never published, so a retry cannot activate this object.
      try {
        await deleteFromS3(s3Key);
      } catch {
        // The cleanup worker can only see DB rows, so there is no safe durable
        // claim to enqueue here. Log enough context for the storage provider's
        // own lifecycle cleanup without returning it to the caller.
        console.error('[files upload orphan]', { userId, s3Key });
      }
      throw err;
    }
  });
}

export async function getFileAttachment(id: string, userId: string): Promise<FileRow | null> {
  return withVaultRead(userId, async ({ generation }) => {
    const db = getDb();
    const now = new Date();
    const rows = await db
      .select()
      .from(fileAttachments)
      .where(
        and(
          eq(fileAttachments.id, id),
          eq(fileAttachments.userId, userId),
          isNull(fileAttachments.deletedAt),
          or(
            // Uploads are created before the note is saved and linked.
            and(isNull(fileAttachments.noteId), isNull(fileAttachments.noteTier)),
            and(
              eq(fileAttachments.noteTier, 'note'),
              exists(
                db
                  .select({ id: notes.id })
                  .from(notes)
                  .where(
                    and(
                      eq(notes.id, fileAttachments.noteId),
                      eq(notes.userId, userId),
                      isNull(notes.deletedAt),
                      or(isNull(notes.expiresAt), gt(notes.expiresAt, now)),
                    ),
                  ),
              ),
            ),
            and(
              eq(fileAttachments.noteTier, 'secret'),
              exists(
                db
                  .select({ id: secretNotes.id })
                  .from(secretNotes)
                  .where(
                    and(
                      eq(secretNotes.id, fileAttachments.noteId),
                      eq(secretNotes.userId, userId),
                      isNull(secretNotes.deletedAt),
                      or(isNull(secretNotes.expiresAt), gt(secretNotes.expiresAt, now)),
                    ),
                  ),
              ),
            ),
            and(
              eq(fileAttachments.noteTier, 'seal'),
              exists(
                db
                  .select({ id: sealNotes.id })
                  .from(sealNotes)
                  .where(
                    and(
                      eq(sealNotes.id, fileAttachments.noteId),
                      eq(sealNotes.userId, userId),
                      isNull(sealNotes.deletedAt),
                      or(isNull(sealNotes.expiresAt), gt(sealNotes.expiresAt, now)),
                    ),
                  ),
              ),
            ),
          ),
        ),
      )
      .limit(1);
    return rows[0] ? mapFile(rows[0], generation) : null;
  });
}

export async function deleteFileAttachment(id: string, userId: string): Promise<FileRow | null> {
  return withVaultWrite(userId, async () => {
    const rows = await getDb()
      .update(fileAttachments)
      .set({ deletedAt: new Date() })
      .where(and(eq(fileAttachments.id, id), eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)))
      .returning();
    return rows[0] ? mapFile(rows[0], currentRequestGeneration()) : null;
  });
}

export async function linkFilesToNote(
  userId: string,
  noteId: string,
  noteTier: NoteTier,
  fileIds: string[],
): Promise<void> {
  if (!fileIds.length) return;
  await withVaultWrite(userId, async () => {
    await getDb()
      .update(fileAttachments)
      .set({ noteId, noteTier })
      .where(
        and(
          inArray(fileAttachments.id, fileIds),
          eq(fileAttachments.userId, userId),
          isNull(fileAttachments.deletedAt),
        ),
      );
  });
}

export async function softDeleteFilesByNoteId(noteId: string, userId?: string): Promise<void> {
  const run = async (ownerId?: string) => {
    await getDb()
      .update(fileAttachments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(fileAttachments.noteId, noteId),
          ...(ownerId ? [eq(fileAttachments.userId, ownerId)] : []),
          isNull(fileAttachments.deletedAt),
        ),
      );
  };
  if (userId) return withVaultWrite(userId, () => run(userId));
  const rows = await getDb()
    .select({ userId: fileAttachments.userId })
    .from(fileAttachments)
    .where(eq(fileAttachments.noteId, noteId));
  for (const ownerId of [...new Set(rows.map((row) => row.userId))]) {
    await withVaultWrite(ownerId, () => run(ownerId));
  }
}

export async function restoreFilesByNoteId(noteId: string, userId: string): Promise<void> {
  await withVaultWrite(userId, async () => {
    await getDb()
      .update(fileAttachments)
      .set({ deletedAt: null })
      .where(and(eq(fileAttachments.noteId, noteId), eq(fileAttachments.userId, userId)));
  });
}

export async function deleteFilesByUserId(userId: string): Promise<void> {
  await withVaultWrite(userId, async () => {
    await getDb()
      .update(fileAttachments)
      .set({ deletedAt: new Date() })
      .where(and(eq(fileAttachments.userId, userId), isNull(fileAttachments.deletedAt)));
  });
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
  const files = await getDb()
    .select({ id: fileAttachments.id, noteId: fileAttachments.noteId, noteTier: fileAttachments.noteTier })
    .from(fileAttachments)
    .where(
      and(isNull(fileAttachments.deletedAt), isNotNull(fileAttachments.noteId), isNotNull(fileAttachments.noteTier)),
    )
    .limit(batchSize);

  if (files.length === 0) return { scanned: 0, orphaned: 0 };

  const byUser = new Map<string, typeof files>();
  const ownerRows = await getDb()
    .select({ id: fileAttachments.id, userId: fileAttachments.userId })
    .from(fileAttachments)
    .where(
      inArray(
        fileAttachments.id,
        files.map((file) => file.id),
      ),
    );
  for (const file of files) {
    const owner = ownerRows.find((row) => row.id === file.id)?.userId;
    if (!owner) continue;
    const list = byUser.get(owner) ?? [];
    list.push(file);
    byUser.set(owner, list);
  }

  let scanned = 0;
  let orphaned = 0;
  for (const [userId, candidates] of byUser) {
    const result = await withVaultMaintenance(userId, async () => {
      const db = getDb();
      const ids = candidates.map((candidate) => candidate.id);
      const current = await db
        .select({ id: fileAttachments.id, noteId: fileAttachments.noteId, noteTier: fileAttachments.noteTier })
        .from(fileAttachments)
        .where(
          and(
            inArray(fileAttachments.id, ids),
            eq(fileAttachments.userId, userId),
            isNull(fileAttachments.deletedAt),
            isNotNull(fileAttachments.noteId),
            isNotNull(fileAttachments.noteTier),
          ),
        );
      if (current.length === 0) return { scanned: 0, orphaned: 0 };

      const idsByTier: Record<NoteTier, Set<string>> = { note: new Set(), secret: new Set(), seal: new Set() };
      for (const f of current) idsByTier[f.noteTier as NoteTier].add(f.noteId as string);
      const aliveByTier: Record<NoteTier, Set<string>> = { note: new Set(), secret: new Set(), seal: new Set() };
      for (const tier of Object.keys(idsByTier) as NoteTier[]) {
        const noteIds = [...idsByTier[tier]];
        if (noteIds.length === 0) continue;
        const table = TIER_TABLES[tier];
        const alive = (await (db as any).select({ id: table.id }).from(table).where(inArray(table.id, noteIds))) as {
          id: string;
        }[];
        for (const row of alive) aliveByTier[tier].add(row.id);
      }
      const orphanIds = current
        .filter((f) => !aliveByTier[f.noteTier as NoteTier].has(f.noteId as string))
        .map((f) => f.id);
      if (orphanIds.length > 0) {
        await db
          .update(fileAttachments)
          .set({ deletedAt: new Date() })
          .where(
            and(
              inArray(fileAttachments.id, orphanIds),
              eq(fileAttachments.userId, userId),
              isNull(fileAttachments.deletedAt),
            ),
          );
      }
      return { scanned: current.length, orphaned: orphanIds.length };
    });
    if (result) {
      scanned += result.scanned;
      orphaned += result.orphaned;
    }
  }
  return { scanned, orphaned };
}

const MAX_DELETE_ATTEMPTS = 5;

export async function cleanupDeletedFiles(batchSize = 50) {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);

  const files = await getDb()
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

  let processed = 0;
  let deleted = 0;
  let failed = 0;
  const byUser = new Map<string, string[]>();
  for (const file of files) {
    const list = byUser.get(file.userId) ?? [];
    list.push(file.id);
    byUser.set(file.userId, list);
  }
  for (const [userId, ids] of byUser) {
    const result = await withVaultMaintenance(userId, async () => {
      const db = getDb();
      let localProcessed = 0;
      let localDeleted = 0;
      let localFailed = 0;
      for (const id of ids) {
        // Re-select after acquiring the fence. A candidate chosen before begin
        // may have become active/referenced during the scan.
        const currentRows = await db
          .select()
          .from(fileAttachments)
          .where(
            and(
              eq(fileAttachments.id, id),
              eq(fileAttachments.userId, userId),
              lte(fileAttachments.deletedAt, cutoff),
              isNull(fileAttachments.storageDeletedAt),
              lt(fileAttachments.deleteAttempts, MAX_DELETE_ATTEMPTS),
            ),
          )
          .limit(1);
        const file = currentRows[0];
        if (!file) continue;
        localProcessed++;
        try {
          // The account fence remains held during physical deletion, so a
          // rotation cannot inventory the object while it is being removed.
          await deleteFromS3(file.s3Key);
          await db
            .update(fileAttachments)
            .set({ storageDeletedAt: new Date() })
            .where(
              and(
                eq(fileAttachments.id, file.id),
                eq(fileAttachments.userId, userId),
                isNull(fileAttachments.storageDeletedAt),
              ),
            );
          localDeleted++;
        } catch (err) {
          await db
            .update(fileAttachments)
            .set({
              deleteAttempts: file.deleteAttempts + 1,
              lastDeleteError: err instanceof Error ? err.message : String(err),
            })
            .where(eq(fileAttachments.id, file.id));
          localFailed++;
        }
      }
      return { processed: localProcessed, deleted: localDeleted, failed: localFailed };
    });
    if (result) {
      processed += result.processed;
      deleted += result.deleted;
      failed += result.failed;
    }
  }

  return { processed, deleted, failed };
}
