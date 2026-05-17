import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  fetchTierPage,
  getNextPageParam,
  viewLabel,
  type TierConfig,
  type TierKey,
} from './tierPagination';

export type { TierConfig, TierKey };
export { fetchTierPage, buildTierPrefetchOptions } from './tierPagination';

const SEARCH_DEBOUNCE_MS = 100;

export const useNoteTier = <T>(config: TierConfig, params: { archived?: boolean; search?: string }) => {
  const { archived, search = '' } = params;
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  return useInfiniteQuery({
    queryKey: [config.key, userId, viewLabel(archived), debouncedSearch.trim()],
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchTierPage<T>(config.endpoint, { archived, search: debouncedSearch, pageParam }),
    getNextPageParam,
    initialPageParam: 0,
    enabled: userId !== undefined,
  });
};
