'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';
import { toast } from 'sonner';

import { decryptSecretBody, encryptSealBody, encryptSealBodyWithExistingKey, encryptSecretBody } from '@/lib/crypto';
import { encryptPromotionAttachments, type PromotionAttachment } from '@/lib/promotionFiles';
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
};

async function encryptForSeal(
  mek: CryptoKey,
  id: string,
  bodies: string[],
): Promise<{ encryptedBodies: (EncryptedPayload | null)[]; wrappedNoteKey: EncryptedPayload | null }> {
  const encryptedBodies: (EncryptedPayload | null)[] = Array.from({ length: bodies.length }, () => null);
  const first = bodies.findIndex((body) => body.trim().length > 0);
  if (first < 0) return { encryptedBodies, wrappedNoteKey: null };

  const initial = await encryptSealBody(mek, bodies[first], id);
  encryptedBodies[first] = initial.encryptedBody;
  for (const [index, body] of bodies.entries()) {
    if (index === first || !body.trim()) continue;
    encryptedBodies[index] = (
      await encryptSealBodyWithExistingKey(mek, body, id, initial.wrappedNoteKey)
    ).encryptedBody;
  }
  return { encryptedBodies, wrappedNoteKey: initial.wrappedNoteKey };
}

function usePromotionCache(source: 'notes' | 'secrets', destination: 'secrets' | 'seals') {
  const qc = useQueryClient();
  return {
    cancelSourceVersions: (id: string) =>
      qc.cancelQueries({ queryKey: versionsKey(source, id), exact: true }),
    reconcile: async (id: string) => {
      const sourceSnapshots = qc.getQueriesData({ queryKey: [source] }) as Snapshot<WithId>[];
      filterOut(qc, sourceSnapshots, id);
      qc.removeQueries({ queryKey: versionsKey(source, id) });
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
        onProgress?.('Re-encrypting history with a unique key…');
        const plaintext = await Promise.all(
          ciphertext.map((body) => (body ? decryptSecretBody(mek, body) : Promise.resolve(''))),
        );
        const sealed = await encryptForSeal(mek, id, plaintext);
        onProgress?.('Moving to Seals…');
        return trpcClient.promotions.secretToSeal.mutate({
          id,
          expectedUpdatedAt: new Date(prepared.secret.updatedAt).toISOString(),
          encryptedBody: sealed.encryptedBodies[0],
          wrappedNoteKey: sealed.wrappedNoteKey,
          versions: prepared.versions.map((version, index) => ({
            id: version._id,
            encryptedBody: sealed.encryptedBodies[index + 1],
          })),
        });
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
