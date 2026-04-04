import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';

type TierKey = 'notes' | 'seals' | 'secrets';

interface TierConfig {
  readonly key: TierKey;
  readonly endpoint: `/api/${TierKey}`;
}

const INITIAL_PAGE_SIZE = 30;
const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 100;

export const useNoteTier = <T>(
  config: TierConfig,
  params: { archived?: boolean; search?: string },
) => {
  const { archived, search = '' } = params;
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  return useInfiniteQuery({
    queryKey: [
      config.key,
      userId,
      archived === undefined ? 'all' : archived ? 'archived' : 'active',
      debouncedSearch.trim(),
    ],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const searchParams = new URLSearchParams();
      if (archived !== undefined) searchParams.set('archived', String(archived));
      const normalizedSearch = debouncedSearch.trim();
      if (normalizedSearch) searchParams.set('q', normalizedSearch);

      const isFirstPage = pageParam === 0;
      const limit = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
      const offset = isFirstPage ? 0 : INITIAL_PAGE_SIZE + (pageParam - 1) * PAGE_SIZE;
      searchParams.set('limit', String(limit));
      searchParams.set('offset', String(offset));

      return api.get(config.endpoint, { searchParams }).json<T[]>();
    },
    getNextPageParam: (lastPage, allPages) => {
      if (allPages.length === 0) return undefined;
      const isFirstPage = allPages.length === 1;
      const expectedSize = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
      if ((lastPage as T[]).length < expectedSize) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
    enabled: userId !== undefined,
  });
};
