import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { POSITION_STEP } from '@/config/constants';
import { getDb } from '@/db/client';
import { currentRequestGeneration, withVaultRead, withVaultWrite } from '@/db/encryptionState';
import {
  fileAttachments,
  notes,
  noteTags,
  noteVersions,
  sealNotes,
  sealNoteTags,
  sealNoteVersions,
  secretNotes,
  secretNoteTags,
  secretNoteVersions,
} from '@/db/schema';
import type { EncryptedPayload } from '@/types/crypto';

export type PromotionErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'BURN_ARMED' | 'INVALID_FILES';

export class PromotionError extends Error {
  constructor(readonly code: PromotionErrorCode) {
    super(code);
    this.name = 'PromotionError';
  }
}

type EncryptedVersion = { id: string; encryptedBody: EncryptedPayload | null };
type FileReplacement = { sourceId: string; encryptedId: string };

const sameInstant = (value: Date, expected: string) => value.getTime() === new Date(expected).getTime();

/** Exactly one distinct replacement for every source file, and nothing else. */
const assertReplacementSet = (sourceIds: string[], replacements: FileReplacement[]): string[] => {
  const replacementBySource = new Map(replacements.map((item) => [item.sourceId, item.encryptedId]));
  const encryptedIds = replacements.map((item) => item.encryptedId);
  if (
    replacementBySource.size !== replacements.length ||
    new Set(encryptedIds).size !== encryptedIds.length ||
    sourceIds.length !== replacements.length ||
    sourceIds.some((id) => !replacementBySource.has(id))
  ) {
    throw new PromotionError('INVALID_FILES');
  }
  return encryptedIds;
};

const assertVersionSet = (storedIds: string[], supplied: EncryptedVersion[]): void => {
  const suppliedIds = supplied.map((version) => version.id);
  if (
    new Set(suppliedIds).size !== suppliedIds.length ||
    storedIds.length !== suppliedIds.length ||
    storedIds.some((id, index) => id !== suppliedIds[index])
  ) {
    throw new PromotionError('CONFLICT');
  }
};

export async function prepareNotePromotion(userId: string, id: string) {
  return withVaultRead(userId, async ({ generation }) => {
    const db = getDb();
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId), isNull(notes.deletedAt)))
      .limit(1);
    if (!note) throw new PromotionError('NOT_FOUND');
    if (note.burnAfterReading && note.expiresAt) throw new PromotionError('BURN_ARMED');

    const [versions, attachments] = await Promise.all([
      db
        .select()
        .from(noteVersions)
        .where(and(eq(noteVersions.userId, userId), eq(noteVersions.noteId, id)))
        .orderBy(asc(noteVersions.seq)),
      db
        .select({
          id: fileAttachments.id,
          filename: fileAttachments.filename,
          size: fileAttachments.size,
          mimeType: fileAttachments.mimeType,
          encrypted: fileAttachments.encrypted,
        })
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.userId, userId),
            eq(fileAttachments.noteId, id),
            eq(fileAttachments.noteTier, 'note'),
            isNull(fileAttachments.deletedAt),
          ),
        ),
    ]);

    return {
      note: { _id: note.id, content: note.content, updatedAt: note.updatedAt, generation },
      versions: versions.map((version) => ({
        _id: version.id,
        content: version.content,
        createdAt: version.createdAt,
        generation,
      })),
      attachments: attachments.map(({ id: attachmentId, ...attachment }) => ({
        _id: attachmentId,
        ...attachment,
      })),
    };
  });
}

export async function prepareSecretPromotion(userId: string, id: string) {
  return withVaultRead(userId, async ({ generation }) => {
    const db = getDb();
    const [secret] = await db
      .select()
      .from(secretNotes)
      .where(and(eq(secretNotes.id, id), eq(secretNotes.userId, userId), isNull(secretNotes.deletedAt)))
      .limit(1);
    if (!secret) throw new PromotionError('NOT_FOUND');
    if (secret.burnAfterReading && secret.expiresAt) throw new PromotionError('BURN_ARMED');

    const [versions, attachments] = await Promise.all([
      db
        .select()
        .from(secretNoteVersions)
        .where(and(eq(secretNoteVersions.userId, userId), eq(secretNoteVersions.noteId, id)))
        .orderBy(asc(secretNoteVersions.seq)),
      db
        .select({
          id: fileAttachments.id,
          filename: fileAttachments.filename,
          size: fileAttachments.size,
          mimeType: fileAttachments.mimeType,
          encrypted: fileAttachments.encrypted,
        })
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.userId, userId),
            eq(fileAttachments.noteId, id),
            eq(fileAttachments.noteTier, 'secret'),
            isNull(fileAttachments.deletedAt),
          ),
        ),
    ]);

    return {
      secret: {
        _id: secret.id,
        encryptedBody: secret.encryptedBody,
        updatedAt: secret.updatedAt,
        generation,
      },
      versions: versions.map((version) => ({
        _id: version.id,
        encryptedBody: version.encryptedBody,
        createdAt: version.createdAt,
        generation,
      })),
      // Every one is re-encrypted under the new Seal's own key before the move.
      attachments: attachments.map(({ id: attachmentId, ...attachment }) => ({
        _id: attachmentId,
        ...attachment,
      })),
    };
  });
}

/** Best-effort cleanup for encrypted replacements prepared in the browser.
 * Linked files are deliberately ignored, so this is safe after an ambiguous
 * network failure where the promotion may actually have committed. */
export async function cleanupPromotionUploads(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withVaultWrite(userId, async () => {
    await getDb()
      .update(fileAttachments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(fileAttachments.userId, userId),
          inArray(fileAttachments.id, ids),
          isNull(fileAttachments.noteId),
          isNull(fileAttachments.noteTier),
          isNull(fileAttachments.deletedAt),
        ),
      );
  });
}

export async function promoteNoteToSecret(
  userId: string,
  input: {
    id: string;
    expectedUpdatedAt: string;
    encryptedBody: EncryptedPayload | null;
    versions: EncryptedVersion[];
    fileReplacements: FileReplacement[];
  },
) {
  return withVaultWrite(userId, async () => {
    const db = getDb();
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, input.id), eq(notes.userId, userId), isNull(notes.deletedAt)))
      .limit(1);
    if (!note) throw new PromotionError('NOT_FOUND');
    if (note.burnAfterReading && note.expiresAt) throw new PromotionError('BURN_ARMED');
    if (!sameInstant(note.updatedAt, input.expectedUpdatedAt)) throw new PromotionError('CONFLICT');

    const [existingDestination] = await db
      .select({ id: secretNotes.id })
      .from(secretNotes)
      .where(and(eq(secretNotes.userId, userId), eq(secretNotes.id, input.id)));
    if (existingDestination) throw new PromotionError('CONFLICT');

    const versions = await db
      .select()
      .from(noteVersions)
      .where(and(eq(noteVersions.userId, userId), eq(noteVersions.noteId, input.id)))
      .orderBy(asc(noteVersions.seq));
    assertVersionSet(
      versions.map((version) => version.id),
      input.versions,
    );

    const sourceFiles = await db
      .select()
      .from(fileAttachments)
      .where(
        and(
          eq(fileAttachments.userId, userId),
          eq(fileAttachments.noteId, input.id),
          eq(fileAttachments.noteTier, 'note'),
          isNull(fileAttachments.deletedAt),
        ),
      );
    const plaintextIds = sourceFiles.filter((file) => !file.encrypted).map((file) => file.id);
    const encryptedIds = assertReplacementSet(plaintextIds, input.fileReplacements);

    if (encryptedIds.length > 0) {
      const replacements = await db
        .select({ id: fileAttachments.id })
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.userId, userId),
            inArray(fileAttachments.id, encryptedIds),
            isNull(fileAttachments.noteId),
            isNull(fileAttachments.noteTier),
            isNull(fileAttachments.deletedAt),
            eq(fileAttachments.encrypted, true),
            // A Secret decrypts with the vault file key; a Seal-keyed upload
            // would link fine and then never open.
            eq(fileAttachments.keyScope, 'vault'),
          ),
        );
      if (replacements.length !== encryptedIds.length) throw new PromotionError('INVALID_FILES');
    }

    const [top] = await db
      .select({ position: secretNotes.position })
      .from(secretNotes)
      .where(and(eq(secretNotes.userId, userId), isNull(secretNotes.deletedAt)))
      .orderBy(desc(secretNotes.position))
      .limit(1);

    await db.insert(secretNotes).values({
      id: note.id,
      userId,
      title: note.title,
      encryptedBody: input.encryptedBody,
      position: (top?.position ?? 0) + POSITION_STEP,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      archived: note.archived,
      color: note.color,
      pattern: note.pattern,
      pinned: note.pinned,
      expiresAt: note.expiresAt,
      burnAfterReading: note.burnAfterReading,
    });

    if (versions.length > 0) {
      const encryptedById = new Map(input.versions.map((version) => [version.id, version.encryptedBody]));
      await db.insert(secretNoteVersions).values(
        versions.map((version) => ({
          id: version.id,
          userId,
          noteId: input.id,
          title: version.title,
          encryptedBody: encryptedById.get(version.id) ?? null,
          createdAt: version.createdAt,
        })),
      );
    }

    const tags = await db
      .select()
      .from(noteTags)
      .where(and(eq(noteTags.userId, userId), eq(noteTags.noteId, input.id)));
    if (tags.length > 0) await db.insert(secretNoteTags).values(tags);

    if (encryptedIds.length > 0) {
      await db
        .update(fileAttachments)
        .set({ noteId: input.id, noteTier: 'secret' })
        .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, encryptedIds)));
    }
    const alreadyEncryptedIds = sourceFiles.filter((file) => file.encrypted).map((file) => file.id);
    if (alreadyEncryptedIds.length > 0) {
      await db
        .update(fileAttachments)
        .set({ noteTier: 'secret' })
        .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, alreadyEncryptedIds)));
    }
    if (plaintextIds.length > 0) {
      await db
        .update(fileAttachments)
        .set({ deletedAt: new Date() })
        .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, plaintextIds)));
    }

    await db.delete(notes).where(and(eq(notes.id, input.id), eq(notes.userId, userId)));
    return { id: input.id, archived: note.archived, generation: currentRequestGeneration() };
  });
}

export async function promoteSecretToSeal(
  userId: string,
  input: {
    id: string;
    expectedUpdatedAt: string;
    encryptedBody: EncryptedPayload | null;
    wrappedNoteKey: EncryptedPayload | null;
    versions: EncryptedVersion[];
    fileReplacements: FileReplacement[];
  },
) {
  return withVaultWrite(userId, async () => {
    const db = getDb();
    const [secret] = await db
      .select()
      .from(secretNotes)
      .where(and(eq(secretNotes.id, input.id), eq(secretNotes.userId, userId), isNull(secretNotes.deletedAt)))
      .limit(1);
    if (!secret) throw new PromotionError('NOT_FOUND');
    if (secret.burnAfterReading && secret.expiresAt) throw new PromotionError('BURN_ARMED');
    if (!sameInstant(secret.updatedAt, input.expectedUpdatedAt)) throw new PromotionError('CONFLICT');

    const [existingDestination] = await db
      .select({ id: sealNotes.id })
      .from(sealNotes)
      .where(and(eq(sealNotes.userId, userId), eq(sealNotes.id, input.id)));
    if (existingDestination) throw new PromotionError('CONFLICT');

    const versions = await db
      .select()
      .from(secretNoteVersions)
      .where(and(eq(secretNoteVersions.userId, userId), eq(secretNoteVersions.noteId, input.id)))
      .orderBy(asc(secretNoteVersions.seq));
    assertVersionSet(
      versions.map((version) => version.id),
      input.versions,
    );

    // A Seal's attachments are under its own note key, not the vault's: every
    // Secret file needs a replacement uploaded under that key, bound to this
    // Seal, and the key itself has to be stored with the Seal.
    const sourceIds = (
      await db
        .select({ id: fileAttachments.id })
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.userId, userId),
            eq(fileAttachments.noteId, input.id),
            eq(fileAttachments.noteTier, 'secret'),
            isNull(fileAttachments.deletedAt),
          ),
        )
    ).map((file) => file.id);
    const encryptedIds = assertReplacementSet(sourceIds, input.fileReplacements);
    if (encryptedIds.length > 0) {
      if (!input.wrappedNoteKey) throw new PromotionError('INVALID_FILES');
      const replacements = await db
        .select({ id: fileAttachments.id })
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.userId, userId),
            inArray(fileAttachments.id, encryptedIds),
            isNull(fileAttachments.noteId),
            isNull(fileAttachments.noteTier),
            isNull(fileAttachments.deletedAt),
            eq(fileAttachments.encrypted, true),
            eq(fileAttachments.keyScope, 'seal'),
            eq(fileAttachments.keyNoteId, input.id),
          ),
        );
      if (replacements.length !== encryptedIds.length) throw new PromotionError('INVALID_FILES');
    }

    const [top] = await db
      .select({ position: sealNotes.position })
      .from(sealNotes)
      .where(and(eq(sealNotes.userId, userId), isNull(sealNotes.deletedAt)))
      .orderBy(desc(sealNotes.position))
      .limit(1);

    await db.insert(sealNotes).values({
      id: secret.id,
      userId,
      title: secret.title,
      encryptedBody: input.encryptedBody,
      wrappedNoteKey: input.wrappedNoteKey,
      position: (top?.position ?? 0) + POSITION_STEP,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      archived: secret.archived,
      color: secret.color,
      pattern: secret.pattern,
      pinned: secret.pinned,
      expiresAt: secret.expiresAt,
      burnAfterReading: secret.burnAfterReading,
    });

    if (versions.length > 0) {
      const encryptedById = new Map(input.versions.map((version) => [version.id, version.encryptedBody]));
      await db.insert(sealNoteVersions).values(
        versions.map((version) => ({
          id: version.id,
          userId,
          noteId: input.id,
          title: version.title,
          encryptedBody: encryptedById.get(version.id) ?? null,
          createdAt: version.createdAt,
        })),
      );
    }

    const tags = await db
      .select()
      .from(secretNoteTags)
      .where(and(eq(secretNoteTags.userId, userId), eq(secretNoteTags.noteId, input.id)));
    if (tags.length > 0) await db.insert(sealNoteTags).values(tags);

    if (encryptedIds.length > 0) {
      await db
        .update(fileAttachments)
        .set({ noteId: input.id, noteTier: 'seal' })
        .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, encryptedIds)));
    }
    if (sourceIds.length > 0) {
      await db
        .update(fileAttachments)
        .set({ deletedAt: new Date() })
        .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, sourceIds)));
    }

    await db.delete(secretNotes).where(and(eq(secretNotes.id, input.id), eq(secretNotes.userId, userId)));
    return { id: input.id, archived: secret.archived, generation: currentRequestGeneration() };
  });
}
