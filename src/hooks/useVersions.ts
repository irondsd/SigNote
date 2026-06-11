'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { api } from '@/lib/api';
import { patchInPlace, type Snapshot, type WithId } from '@/lib/queryCache';
import type { InfiniteData } from '@tanstack/react-query';
import type { EncryptedPayload } from '@/types/crypto';

// Wire shapes of GET /api/{tier}/[id]/versions entries. The tier string doubles
// as the endpoint segment and the root cache key of the tier's list queries.
export type VersionTier = 'notes' | 'secrets' | 'seals';

export type PlainVersion = {
  _id: string;
  title: string;
  content: string;
  createdAt: string;
};

export type EncryptedVersion = {
  _id: string;
  title: string;
  encryptedBody: EncryptedPayload | null;
  createdAt: string;
};

export const versionsKey = (tier: VersionTier, id: string) => ['versions', tier, id] as const;

/**
 * Version history of one note, newest first. The endpoint returns oldest →
 * newest; the cache keeps that raw order and `select` flips it for display.
 * For secrets/seals the bodies are ciphertext — callers decrypt with the MEK.
 */
export function useVersions<V extends PlainVersion | EncryptedVersion>(
  tier: VersionTier,
  id: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: versionsKey(tier, id),
    queryFn: () => api.get(`/api/${tier}/${id}/versions`).json<V[]>(),
    select: (versions) => [...versions].reverse(),
    enabled,
  });
}

/**
 * Restores a past version into the head. The response is the updated head doc
 * (sans versions): it's patched into the tier's list caches, and the versions
 * query is refetched — restore pushed the pre-restore head as a new snapshot,
 * and the toast's Undo needs its id.
 */
export function useRestoreVersion<H extends WithId>(tier: VersionTier) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId: string }) =>
      api.post(`/api/${tier}/${id}/versions/${versionId}/restore`).json<H>(),
    onSuccess: async (updated, { id }) => {
      const snapshots = qc.getQueriesData<InfiniteData<H[]>>({ queryKey: [tier] }) as Snapshot<H>[];
      patchInPlace(qc, snapshots, id, updated);
      posthog.capture('version_restored', { tier });
      await qc.invalidateQueries({ queryKey: versionsKey(tier, id) });
    },
  });
}

/** Deletes one version row, optimistically removing it from the timeline. */
export function useDeleteVersion(tier: VersionTier) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId: string }) =>
      api.delete(`/api/${tier}/${id}/versions/${versionId}`).json(),
    onMutate: async ({ id, versionId }) => {
      const key = versionsKey(tier, id);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ _id: string }[]>(key);
      if (previous) {
        qc.setQueryData(
          key,
          previous.filter((v) => v._id !== versionId),
        );
      }
      return { previous };
    },
    onError: (_err, { id }, context) => {
      if (context?.previous) qc.setQueryData(versionsKey(tier, id), context.previous);
    },
    onSettled: (_data, _err, { id }) => {
      posthog.capture('version_deleted', { tier });
      return qc.invalidateQueries({ queryKey: versionsKey(tier, id) });
    },
  });
}
