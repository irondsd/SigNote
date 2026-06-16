'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import { trpc } from '@/lib/trpc';
import type { ClientTag, TagsResponse } from './useTags';

// Roots whose cached docs embed tag ids — refreshed after a tag is deleted.
// Still REST-keyed during the migration; these match the infinite-query keys.
const TIER_ROOTS = ['notes', 'secrets', 'seals'] as const;

/**
 * Optimistically adjust the per-tag usage counts in the tags cache when a
 * note gains or loses tags. Purely cosmetic — keeps the picker/manager counts
 * in step without forcing a refetch; the next natural refetch corrects drift.
 */
export function useTagCountBump() {
  const utils = trpc.useUtils();
  return useCallback(
    (added: string[], removed: string[]) => {
      if (added.length === 0 && removed.length === 0) return;
      utils.tags.list.setData(undefined, (old) => {
        if (!old) return old;
        const counts = { ...old.counts };
        for (const id of added) counts[id] = (counts[id] ?? 0) + 1;
        for (const id of removed) counts[id] = Math.max(0, (counts[id] ?? 0) - 1);
        return { ...old, counts };
      });
    },
    [utils],
  );
}

// The tags.list cache holds hydrated-doc types; at runtime it's the ClientTag
// shape. Narrow once here so the cache updaters read naturally.
type CachedTags = { tags: ClientTag[]; counts: Record<string, number> } | undefined;
const asCached = (old: unknown): CachedTags => old as CachedTags;

export function useTagMutations() {
  const utils = trpc.useUtils();
  const qc = useQueryClient();

  const patchTagsCache = (updater: (tags: ClientTag[]) => ClientTag[]) =>
    utils.tags.list.setData(undefined, (old) => {
      const cached = asCached(old);
      return cached ? ({ ...cached, tags: updater(cached.tags) } as unknown as TagsResponse) : old;
    });

  const create = trpc.tags.create.useMutation({
    onSuccess: (tag) => {
      posthog.capture('tag_created');
      // Insert immediately so chips/lookup reflect the new tag before refetch.
      const created = tag as unknown as ClientTag;
      patchTagsCache((tags) =>
        tags.some((t) => t._id === created._id)
          ? tags
          : [...tags, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
    },
    onError: () => toast.error('Failed to create tag'),
    onSettled: () => utils.tags.list.invalidate(),
  });

  const update = trpc.tags.update.useMutation({
    onMutate: async ({ id, ...patch }) => {
      await utils.tags.list.cancel();
      const snapshot = asCached(utils.tags.list.getData());
      patchTagsCache((tags) => tags.map((t) => (t._id === id ? { ...t, ...patch } : t)));
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) utils.tags.list.setData(undefined, context.snapshot as unknown as TagsResponse);
      toast.error('Failed to update tag');
    },
    onSettled: () => utils.tags.list.invalidate(),
  });

  const remove = trpc.tags.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.tags.list.cancel();
      const snapshot = asCached(utils.tags.list.getData());
      patchTagsCache((tags) => tags.filter((t) => t._id !== id));
      return { snapshot };
    },
    onSuccess: () => posthog.capture('tag_deleted'),
    onError: (_err, _vars, context) => {
      if (context?.snapshot) utils.tags.list.setData(undefined, context.snapshot as unknown as TagsResponse);
      toast.error('Failed to delete tag');
    },
    onSettled: () => {
      utils.tags.list.invalidate();
      // Cards/lists embed the deleted id; refresh so it's dropped server-side too.
      // Tier lists are still REST-keyed during migration.
      for (const root of TIER_ROOTS) qc.invalidateQueries({ queryKey: [root] });
    },
  });

  return { create, update, remove };
}
