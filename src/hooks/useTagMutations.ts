'use client';

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import { api } from '@/lib/api';
import type { TagColor } from '@/config/noteStyles';
import type { ClientTag, TagsResponse } from './useTags';

const TAGS_KEY = ['tags'] as const;
// Roots whose cached docs embed tag ids — refreshed after a tag is deleted.
const TIER_ROOTS = ['notes', 'secrets', 'seals'] as const;

async function apiCreateTag(input: { name: string; color?: TagColor }): Promise<ClientTag> {
  return api.post('/api/tags', { json: input }).json<ClientTag>();
}

async function apiUpdateTag({ id, ...patch }: { id: string; name?: string; color?: TagColor }): Promise<ClientTag> {
  return api.patch(`/api/tags/${id}`, { json: patch }).json<ClientTag>();
}

async function apiDeleteTag(id: string): Promise<unknown> {
  return api.delete(`/api/tags/${id}`).json();
}

/**
 * Optimistically adjust the per-tag usage counts in the tags cache when a
 * note gains or loses tags. Purely cosmetic — keeps the picker/manager counts
 * in step without forcing a refetch; the next natural refetch corrects drift.
 */
export function useTagCountBump() {
  const qc = useQueryClient();
  return useCallback(
    (added: string[], removed: string[]) => {
      if (added.length === 0 && removed.length === 0) return;
      qc.setQueriesData<TagsResponse>({ queryKey: TAGS_KEY }, (old) => {
        if (!old) return old;
        const counts = { ...old.counts };
        for (const id of added) counts[id] = (counts[id] ?? 0) + 1;
        for (const id of removed) counts[id] = Math.max(0, (counts[id] ?? 0) - 1);
        return { ...old, counts };
      });
    },
    [qc],
  );
}

export function useTagMutations() {
  const qc = useQueryClient();

  const snapshotTags = () => qc.getQueriesData<TagsResponse>({ queryKey: TAGS_KEY });
  const restoreTags = (snapshots: ReturnType<typeof snapshotTags>) =>
    snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
  const patchTagsCache = (updater: (tags: ClientTag[]) => ClientTag[]) =>
    qc.setQueriesData<TagsResponse>({ queryKey: TAGS_KEY }, (old) => (old ? { ...old, tags: updater(old.tags) } : old));

  const create = useMutation({
    mutationFn: apiCreateTag,
    onSuccess: (tag) => {
      posthog.capture('tag_created');
      // Insert immediately so chips/lookup reflect the new tag before refetch.
      patchTagsCache((tags) =>
        tags.some((t) => t._id === tag._id) ? tags : [...tags, tag].sort((a, b) => a.name.localeCompare(b.name)),
      );
    },
    onError: () => toast.error('Failed to create tag'),
    onSettled: () => qc.invalidateQueries({ queryKey: TAGS_KEY }),
  });

  const update = useMutation({
    mutationFn: apiUpdateTag,
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: TAGS_KEY });
      const snapshots = snapshotTags();
      patchTagsCache((tags) => tags.map((t) => (t._id === id ? { ...t, ...patch } : t)));
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreTags(context.snapshots);
      toast.error('Failed to update tag');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TAGS_KEY }),
  });

  const remove = useMutation({
    mutationFn: apiDeleteTag,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: TAGS_KEY });
      const snapshots = snapshotTags();
      patchTagsCache((tags) => tags.filter((t) => t._id !== id));
      return { snapshots };
    },
    onSuccess: () => posthog.capture('tag_deleted'),
    onError: (_err, _id, context) => {
      if (context) restoreTags(context.snapshots);
      toast.error('Failed to delete tag');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TAGS_KEY });
      // Cards/lists embed the deleted id; refresh so it's dropped server-side too.
      for (const root of TIER_ROOTS) qc.invalidateQueries({ queryKey: [root] });
    },
  });

  return { create, update, remove };
}
