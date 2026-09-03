'use client';

import { useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc';
import type { TagColor } from '@/config/noteStyles';

export type ClientTag = { _id: string; name: string; color: TagColor; createdAt: string };
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

  const query = trpc.tags.list.useQuery(undefined, {
    enabled: userId !== undefined,
    staleTime: 60_000,
  });

  // tRPC has no data transformer here, so the inferred type still says `Date`
  // where the wire actually carries an ISO string. ClientTag is that runtime
  // shape.
  const tags = (query.data?.tags as unknown as ClientTag[] | undefined) ?? EMPTY_TAGS;
  const counts = query.data?.counts ?? EMPTY_COUNTS;

  const byId = useMemo(() => {
    const map = new Map<string, ClientTag>();
    for (const t of tags) map.set(t._id, t);
    return map;
  }, [tags]);

  // Accepts anything stringifiable so a caller can pass ids straight through
  // from a note's `tags` list without pre-mapping.
  const resolve = useCallback(
    (ids: ReadonlyArray<string | { toString(): string }> | undefined | null): ClientTag[] =>
      (ids ?? []).map((id) => byId.get(String(id))).filter((t): t is ClientTag => t !== undefined),
    [byId],
  );

  return { tags, counts, byId, resolve, isLoading: query.isLoading };
}
