import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { fetchTierPage, getNextPageParam, viewLabel, type TierConfig, type TierKey } from './tierPagination';

export type { TierConfig, TierKey };
export { fetchTierPage, buildTierPrefetchOptions } from './tierPagination';

const SEARCH_DEBOUNCE_MS = 100;

export const useNoteTier = <T>(
  config: TierConfig,
  params: { archived?: boolean; search?: string; tags?: string[]; tagMode?: 'or' | 'and'; enabled?: boolean },
) => {
  const { archived, search = '', tags, tagMode = 'or', enabled = true } = params;
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  // Stable, order-independent key fragment; empty when no tag filter is active
  // so non-filtered views keep their original 4-element key (and prefetch hits).
  const tagsKey = tags && tags.length > 0 ? `${tagMode}:${[...tags].sort().join(',')}` : '';
  const baseKey = [config.key, userId, viewLabel(archived), debouncedSearch.trim()];

  return useInfiniteQuery({
    queryKey: tagsKey ? [...baseKey, tagsKey] : baseKey,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchTierPage<T>(config.endpoint, { archived, search: debouncedSearch, tags, tagMode, pageParam }),
    getNextPageParam,
    initialPageParam: 0,
    enabled: userId !== undefined && enabled,
  });
};
