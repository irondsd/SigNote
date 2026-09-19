'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { toast } from 'sonner';

import {
  decryptSecretBody,
  encryptSealBodyWithExistingKey,
  encryptSecretBody,
  generateSealKey,
  importSealKey,
  wrapSealKey,
} from '@/lib/crypto';
import {
  encryptAttachmentsForSeal,
  encryptPromotionAttachments,
  type FileReplacement,
  type PromotionAttachment,
} from '@/lib/promotionFiles';
import { filterOut, type Snapshot, type WithId } from '@/lib/queryCache';
import { queueTierWrite } from '@/lib/tierWriteQueue';
import { trpcClient } from '@/lib/trpcClient';
import { versionsKey } from '@/hooks/useVersions';
import type { EncryptedPayload } from '@/types/crypto';

type Progress = (message: string) => void;
type PromotionInput = { id: string; mek: CryptoKey; onProgress?: Progress };

type NotePreparation = {
  note: { _id: string; content: string; updatedAt: string | Date };
  versions: { _id: string; content: string }[];
  attachments: PromotionAttachment[];
};

type SecretPreparation = {
  secret: { _id: string; encryptedBody: EncryptedPayload | null; updatedAt: string | Date };
  versions: { _id: string; encryptedBody: EncryptedPayload | null }[];
  attachments: PromotionAttachment[];
};

/** A new Seal note key, wrapped under the MEK straight away. */
async function mintSealKey(mek: CryptoKey, id: string): Promise<EncryptedPayload> {
  const nek = generateSealKey();
  try {
    return await wrapSealKey(mek, id, nek);
  } finally {
    nek.fill(0);
  }
}

/** Every retained body under the one Seal key, so history stays readable. */
async function encryptForSeal(
  mek: CryptoKey,
  id: string,
  bodies: string[],
  wrappedNoteKey: EncryptedPayload | null,
): Promise<(EncryptedPayload | null)[]> {
  return Promise.all(
    bodies.map(async (body) =>
      body.trim() && wrappedNoteKey
        ? (await encryptSealBodyWithExistingKey(mek, body, id, wrappedNoteKey)).encryptedBody
        : null,
    ),
  );
}

function usePromotionCache(source: 'notes' | 'secrets', destination: 'secrets' | 'seals') {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user.id;
  return {
    cancelSourceVersions: (id: string) =>
      qc.cancelQueries({ queryKey: versionsKey(source, id, userId), exact: true }),
    reconcile: async (id: string) => {
      const sourceSnapshots = qc.getQueriesData({ queryKey: [source] }) as Snapshot<WithId>[];
      filterOut(qc, sourceSnapshots, id);
      qc.removeQueries({ queryKey: versionsKey(source, id, userId) });
      await Promise.all([
        qc.invalidateQueries({ queryKey: [source] }),
        qc.invalidateQueries({ queryKey: [destination] }),
      ]);
    },
  };
}

function promotedNoteUrl(destination: 'secrets' | 'seals', result: { id: string; archived: boolean }) {
  const path = result.archived ? `/${destination}/archive` : `/${destination}`;
  return `${path}?id=${encodeURIComponent(result.id)}`;
}

export function usePromoteNoteToSecret() {
  const router = useRouter();
  const { cancelSourceVersions, reconcile } = usePromotionCache('notes', 'secrets');
  return useMutation({
    networkMode: 'always',
    mutationKey: ['notes', 'promotion'],
    onMutate: ({ id }) => cancelSourceVersions(id),
    mutationFn: ({ id, mek, onProgress }: PromotionInput) =>
      queueTierWrite('notes', id, async () => {
        onProgress?.('Preparing note…');
        const prepared = (await trpcClient.promotions.prepareNote.query({ id })) as unknown as NotePreparation;
        const allContent = [prepared.note.content, ...prepared.versions.map((version) => version.content)];
        const secured = await encryptPromotionAttachments(prepared.attachments, allContent, mek, onProgress);
        const uploadedIds = secured.replacements.map((replacement) => replacement.encryptedId);

        try {
          onProgress?.('Encrypting note history…');
          const bodies = await Promise.all(
            secured.contents.map((content) =>
              content.trim() ? encryptSecretBody(mek, content) : Promise.resolve(null),
            ),
          );
          onProgress?.('Moving to Secrets…');
          return await trpcClient.promotions.noteToSecret.mutate({
            id,
            expectedUpdatedAt: new Date(prepared.note.updatedAt).toISOString(),
            encryptedBody: bodies[0],
            versions: prepared.versions.map((version, index) => ({
              id: version._id,
              encryptedBody: bodies[index + 1],
            })),
            fileReplacements: secured.replacements,
          });
        } catch (error) {
          // Safe even when the commit response was lost: the server only
          // removes still-unlinked uploads, never files attached by a commit.
          await trpcClient.promotions.cleanupUploads.mutate({ ids: uploadedIds }).catch(() => undefined);
          throw error;
        }
      }),
    onSuccess: async (data, { id }) => {
      await reconcile(id);
      posthog.capture('note_promoted', { from: 'note', to: 'secret' });
      toast.success('Moved to Secrets', {
        description: 'The note and its history are now encrypted.',
        action: { label: 'Open', onClick: () => router.push(promotedNoteUrl('secrets', data)) },
      });
    },
    onError: () => {
      posthog.capture('mutation_failed', { tier: 'note', operation: 'promote' });
    },
  });
}

export function usePromoteSecretToSeal() {
  const router = useRouter();
  const { cancelSourceVersions, reconcile } = usePromotionCache('secrets', 'seals');
  return useMutation({
    networkMode: 'always',
    mutationKey: ['secrets', 'promotion'],
    onMutate: ({ id }) => cancelSourceVersions(id),
    mutationFn: ({ id, mek, onProgress }: PromotionInput) =>
      queueTierWrite('secrets', id, async () => {
        onProgress?.('Preparing secret…');
        const prepared = (await trpcClient.promotions.prepareSecret.query({ id })) as unknown as SecretPreparation;
        const ciphertext = [
          prepared.secret.encryptedBody,
          ...prepared.versions.map((version) => version.encryptedBody),
        ];
        const plaintext = await Promise.all(
          ciphertext.map((body) => (body ? decryptSecretBody(mek, body) : Promise.resolve(''))),
        );
        // The Seal's key exists before its attachments are moved, because they
        // are re-encrypted under it rather than carried over on the vault key.
        const needsKey = plaintext.some((body) => body.trim()) || prepared.attachments.length > 0;
        const wrappedNoteKey = needsKey ? await mintSealKey(mek, id) : null;

        let contents = plaintext;
        let replacements: FileReplacement[] = [];
        if (wrappedNoteKey && prepared.attachments.length > 0) {
          const noteKey = await importSealKey(mek, id, wrappedNoteKey);
          const secured = await encryptAttachmentsForSeal(
            prepared.attachments,
            plaintext,
            { mek, sealId: id, noteKey },
            onProgress,
          );
          contents = secured.contents;
          replacements = secured.replacements;
        }
        const uploadedIds = replacements.map((replacement) => replacement.encryptedId);

        try {
          onProgress?.('Re-encrypting history with a unique key…');
          const bodies = await encryptForSeal(mek, id, contents, wrappedNoteKey);
          onProgress?.('Moving to Seals…');
          return await trpcClient.promotions.secretToSeal.mutate({
            id,
            expectedUpdatedAt: new Date(prepared.secret.updatedAt).toISOString(),
            encryptedBody: bodies[0],
            wrappedNoteKey,
            versions: prepared.versions.map((version, index) => ({
              id: version._id,
              encryptedBody: bodies[index + 1],
            })),
            fileReplacements: replacements,
          });
        } catch (error) {
          // Safe even when the commit response was lost: the server only
          // removes still-unlinked uploads, never files attached by a commit.
          await trpcClient.promotions.cleanupUploads.mutate({ ids: uploadedIds }).catch(() => undefined);
          throw error;
        }
      }),
    onSuccess: async (data, { id }) => {
      await reconcile(id);
      posthog.capture('note_promoted', { from: 'secret', to: 'seal' });
      toast.success('Moved to Seals', {
        description: 'This item now has its own encryption key.',
        action: { label: 'Open', onClick: () => router.push(promotedNoteUrl('seals', data)) },
      });
    },
    onError: () => {
      posthog.capture('mutation_failed', { tier: 'secret', operation: 'promote' });
    },
  });
}
