import { trpcClient } from '@/lib/trpcClient';

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
  tier: TierKey,
  params: { archived?: boolean; search?: string; tags?: string[]; tagMode?: 'or' | 'and'; pageParam: number },
): Promise<T[]> {
  const { archived, search = '', tags, tagMode = 'or', pageParam } = params;
  const normalizedSearch = search.trim();
  const isFirstPage = pageParam === 0;
  const limit = isFirstPage ? INITIAL_PAGE_SIZE : PAGE_SIZE;
  const offset = isFirstPage ? 0 : INITIAL_PAGE_SIZE + (pageParam - 1) * PAGE_SIZE;

  const input = {
    archived,
    search: normalizedSearch || undefined,
    tags: tags && tags.length > 0 ? tags : undefined,
    tagMode,
    limit,
    offset,
  };

  const rows = await trpcClient[tier].list.query(input);
  return rows as unknown as T[];
}

export function buildTierPrefetchOptions<T>(config: TierConfig, userId: string) {
  return {
    queryKey: [config.key, userId, 'active', ''] as const,
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchTierPage<T>(config.key, { archived: false, search: '', pageParam }),
    initialPageParam: 0,
    pages: 1,
    getNextPageParam,
  };
}
