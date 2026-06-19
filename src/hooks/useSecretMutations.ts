'use client';

import { type EncryptedPayload } from '@/types/crypto';
import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { trpcClient } from '@/lib/trpcClient';
import { dispatchCommonUpdate } from './internal/tierClient';
import { commonTempNote, useCreateTier, useDeleteTier, useUndeleteTier, useUpdateTier } from './internal/useTierMutations';

export type CachedSecretNote = {
  _id: string;
  title: string;
  encryptedBody: EncryptedPayload | null;
  archived: boolean;
  deletedAt: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  color: string | null;
  pattern: string | null;
  pinned: boolean;
  expiresAt: string | null;
  burnAfterReading: boolean;
  tags: string[];
};

type CreateSecretInput = {
  title: string;
  encryptedBody: EncryptedPayload | null;
  color?: string | null;
  pattern?: string | null;
  fileIds?: string[];
  tags?: string[];
};
type UpdateSecretInput = {
  id: string;
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  archived?: boolean;
  deleted?: boolean;
  color?: string | null;
  pattern?: string | null;
  fileIds?: string[];
  pinned?: boolean;
  expiresAt?: string | null;
  burnAfterReading?: boolean;
  tags?: string[];
};

const ROOT = 'secrets';

async function apiCreateSecret(input: CreateSecretInput): Promise<CachedSecretNote> {
  return (await trpcClient.secrets.create.mutate({
    ...input,
    color: input.color as NoteColor | null | undefined,
    pattern: input.pattern as NotePattern | null | undefined,
  })) as unknown as CachedSecretNote;
}

async function apiDeleteSecret(id: string) {
  return trpcClient.secrets.delete.mutate({ id });
}

async function apiUndeleteSecret({ id }: { id: string; note: CachedSecretNote }) {
  return trpcClient.secrets.restore.mutate({ id });
}

async function apiUpdateSecret({ id, ...data }: UpdateSecretInput) {
  const handled = dispatchCommonUpdate('secrets', id, data);
  if (handled) return handled;
  return (await trpcClient.secrets.update.mutate({
    id,
    title: data.title,
    encryptedBody: data.encryptedBody,
    fileIds: data.fileIds,
  })) as unknown as CachedSecretNote;
}

export const useCreateSecret = (callbacks?: { onError?: () => void }) =>
  useCreateTier<CachedSecretNote, CreateSecretInput>(
    ROOT,
    apiCreateSecret,
    (input, tempId) => ({ ...commonTempNote(input, tempId), encryptedBody: input.encryptedBody }),
    callbacks,
  );

export const useDeleteSecret = () => useDeleteTier<CachedSecretNote>(ROOT, apiDeleteSecret);
export const useUndeleteSecret = () => useUndeleteTier<CachedSecretNote>(ROOT, apiUndeleteSecret);
export const useUpdateSecret = () => useUpdateTier<CachedSecretNote>(ROOT, apiUpdateSecret, 'encryptedBody');
