'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import type { TagColor } from '@/config/noteStyles';

export type ClientTag = { _id: string; name: string; color: TagColor };
export type TagsResponse = { tags: ClientTag[]; counts: Record<string, number> };

const EMPTY_TAGS: ClientTag[] = [];
const EMPTY_COUNTS: Record<string, number> = {};

/**
 * The user's tags plus per-tag usage counts. Components resolve a note's
 * `tags` (id list) → tag objects via `resolve`/`byId`; because resolution
 * drops unknown ids, a deleted/renamed tag updates everywhere as soon as this
 * cache refreshes.
 */
export function useTags() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const query = useQuery({
    queryKey: ['tags', userId],
    queryFn: () => api.get('/api/tags').json<TagsResponse>(),
    enabled: userId !== undefined,
    staleTime: 60_000,
  });

  const tags = query.data?.tags ?? EMPTY_TAGS;
  const counts = query.data?.counts ?? EMPTY_COUNTS;

  const byId = useMemo(() => {
    const map = new Map<string, ClientTag>();
    for (const t of tags) map.set(t._id, t);
    return map;
  }, [tags]);

  // Accepts string ids or Mongoose ObjectIds (server document types expose the
  // latter even though the client only ever holds JSON strings at runtime).
  const resolve = useCallback(
    (ids: ReadonlyArray<string | { toString(): string }> | undefined | null): ClientTag[] =>
      (ids ?? []).map((id) => byId.get(String(id))).filter((t): t is ClientTag => t !== undefined),
    [byId],
  );

  return { tags, counts, byId, resolve, isLoading: query.isLoading };
}
