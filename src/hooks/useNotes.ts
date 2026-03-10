import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type UseNotesProps = {
  archived?: boolean;
  search?: string;
};

const INITIAL_PAGE_SIZE = 30;
const PAGE_SIZE = 10;

const SEARCH_DEBOUNCE_MS = 100;

export const useNotes = ({ archived, search = '' }: UseNotesProps) => {
  const { data: session } = useSession();
  const address = session?.user?.address;
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [search]);

  return useInfiniteQuery({
    queryKey: [
      'notes',
      address,
      archived === undefined ? 'all' : archived ? 'archived' : 'active',
      debouncedSearch.trim(),
    ],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const searchParams = new URLSearchParams();
      if (archived !== undefined) searchParams.set('archived', String(archived));
      const normalizedSearch = debouncedSearch.trim();
      if (normalizedSearch) searchParams.set('q', normalizedSearch);

      // First page uses INITIAL_PAGE_SIZE, subsequent pages use PAGE_SIZE
      const isFirstPage = pageParam === 0;
      const limit = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
      const offset = isFirstPage ? 0 : INITIAL_PAGE_SIZE + (pageParam - 1) * PAGE_SIZE;

      searchParams.set('limit', String(limit));
      searchParams.set('offset', String(offset));

      const endpoint = `/api/notes?${searchParams.toString()}`;

      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error('Failed to fetch notes');
      }
      return res.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      // If the last page has fewer items than expected, there are no more pages
      if (allPages.length === 0) return undefined;

      const isFirstPage = allPages.length === 1;
      const expectedSize = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;

      if (lastPage.length < expectedSize) {
        return undefined; // No more pages
      }

      return allPages.length; // Return page number for infinite query
    },
    initialPageParam: 0,
    enabled: address !== undefined,
  });
};
