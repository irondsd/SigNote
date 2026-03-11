import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type UseSecretsProps = {
  archived?: boolean;
  search?: string;
};

const INITIAL_PAGE_SIZE = 30;
const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 100;

export const useSecrets = ({ archived, search = '' }: UseSecretsProps) => {
  const { data: session } = useSession();
  const address = session?.user?.address;
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  return useInfiniteQuery({
    queryKey: [
      'secrets',
      address,
      archived === undefined ? 'all' : archived ? 'archived' : 'active',
      debouncedSearch.trim(),
    ],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const params = new URLSearchParams();
      if (archived !== undefined) params.set('archived', String(archived));
      const normalizedSearch = debouncedSearch.trim();
      if (normalizedSearch) params.set('q', normalizedSearch);

      const isFirstPage = pageParam === 0;
      const limit = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
      const offset = isFirstPage ? 0 : INITIAL_PAGE_SIZE + (pageParam - 1) * PAGE_SIZE;
      params.set('limit', String(limit));
      params.set('offset', String(offset));

      const res = await fetch(`/api/secrets?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch secrets');
      return res.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      if (allPages.length === 0) return undefined;
      const isFirstPage = allPages.length === 1;
      const expectedSize = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
      if (lastPage.length < expectedSize) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
    enabled: address !== undefined,
  });
};
