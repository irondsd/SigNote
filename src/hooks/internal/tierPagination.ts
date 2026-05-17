import { api } from '@/lib/api';

export type TierKey = 'notes' | 'seals' | 'secrets';

export interface TierConfig {
  readonly key: TierKey;
  readonly endpoint: `/api/${TierKey}`;
}

export type TierView = 'active' | 'archived' | 'all';

export const INITIAL_PAGE_SIZE = 30;
export const PAGE_SIZE = 10;

export function viewLabel(archived?: boolean): TierView {
  return archived === undefined ? 'all' : archived ? 'archived' : 'active';
}

export function getNextPageParam<T>(lastPage: T[], allPages: T[][]): number | undefined {
  if (allPages.length === 0) return undefined;
  const isFirstPage = allPages.length === 1;
  const expectedSize = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
  if (lastPage.length < expectedSize) return undefined;
  return allPages.length;
}

export async function fetchTierPage<T>(
  endpoint: string,
  params: { archived?: boolean; search?: string; pageParam: number },
): Promise<T[]> {
  const { archived, search = '', pageParam } = params;
  const searchParams = new URLSearchParams();
  if (archived !== undefined) searchParams.set('archived', String(archived));
  const normalizedSearch = search.trim();
  if (normalizedSearch) searchParams.set('q', normalizedSearch);
  const isFirstPage = pageParam === 0;
  const limit = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
  const offset = isFirstPage ? 0 : INITIAL_PAGE_SIZE + (pageParam - 1) * PAGE_SIZE;
  searchParams.set('limit', String(limit));
  searchParams.set('offset', String(offset));
  return api.get(endpoint, { searchParams }).json<T[]>();
}

export function buildTierPrefetchOptions<T>(config: TierConfig, userId: string) {
  return {
    queryKey: [config.key, userId, 'active', ''] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchTierPage<T>(config.endpoint, { archived: false, search: '', pageParam }),
    initialPageParam: 0,
    pages: 1,
    getNextPageParam,
  };
}
