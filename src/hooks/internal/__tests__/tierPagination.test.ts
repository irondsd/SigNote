jest.mock('@/lib/trpcClient', () => ({
  trpcClient: {
    notes: { list: { query: jest.fn() } },
    secrets: { list: { query: jest.fn() } },
    seals: { list: { query: jest.fn() } },
  },
}));

import { trpcClient } from '@/lib/trpcClient';
import {
  viewLabel,
  getNextPageParam,
  fetchTierPage,
  buildTierPrefetchOptions,
  INITIAL_PAGE_SIZE,
  PAGE_SIZE,
  type TierConfig,
} from '@/hooks/internal/tierPagination';

type ListInput = {
  archived?: boolean;
  search?: string;
  tags?: string[];
  tagMode?: 'or' | 'and';
  limit: number;
  offset: number;
};

const notesQuery = trpcClient.notes.list.query as unknown as jest.Mock;
const secretsQuery = trpcClient.secrets.list.query as unknown as jest.Mock;

function setResponse(query: jest.Mock, body: unknown[]) {
  query.mockResolvedValue(body);
}

function lastInput(query: jest.Mock): ListInput {
  return query.mock.calls[query.mock.calls.length - 1][0] as ListInput;
}

beforeEach(() => {
  notesQuery.mockReset();
  secretsQuery.mockReset();
});

describe('viewLabel', () => {
  it('returns "all" when archived is undefined', () => {
    expect(viewLabel(undefined)).toBe('all');
  });

  it('returns "archived" when archived is true', () => {
    expect(viewLabel(true)).toBe('archived');
  });

  it('returns "active" when archived is false', () => {
    expect(viewLabel(false)).toBe('active');
  });
});

describe('getNextPageParam', () => {
  it('returns undefined when allPages is empty', () => {
    expect(getNextPageParam([], [])).toBeUndefined();
  });

  it('returns 1 when first page is full', () => {
    const fullFirst = new Array(INITIAL_PAGE_SIZE).fill({});
    expect(getNextPageParam(fullFirst, [fullFirst])).toBe(1);
  });

  it('returns undefined when first page is partial', () => {
    const partial = new Array(INITIAL_PAGE_SIZE - 1).fill({});
    expect(getNextPageParam(partial, [partial])).toBeUndefined();
  });

  it('returns allPages.length when a subsequent page is full', () => {
    const firstPage = new Array(INITIAL_PAGE_SIZE).fill({});
    const secondPage = new Array(PAGE_SIZE).fill({});
    expect(getNextPageParam(secondPage, [firstPage, secondPage])).toBe(2);
  });

  it('returns undefined when a subsequent page is partial', () => {
    const firstPage = new Array(INITIAL_PAGE_SIZE).fill({});
    const partial = new Array(PAGE_SIZE - 1).fill({});
    expect(getNextPageParam(partial, [firstPage, partial])).toBeUndefined();
  });
});

describe('fetchTierPage', () => {
  it('uses INITIAL_PAGE_SIZE and offset=0 for first page (pageParam=0)', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 0 });
    const input = lastInput(notesQuery);
    expect(input.limit).toBe(INITIAL_PAGE_SIZE);
    expect(input.offset).toBe(0);
  });

  it('uses PAGE_SIZE and correct offset for second page (pageParam=1)', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 1 });
    const input = lastInput(notesQuery);
    expect(input.limit).toBe(PAGE_SIZE);
    expect(input.offset).toBe(INITIAL_PAGE_SIZE);
  });

  it('uses correct offset for third page (pageParam=2)', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 2 });
    expect(lastInput(notesQuery).offset).toBe(INITIAL_PAGE_SIZE + PAGE_SIZE);
  });

  it('omits archived when archived is undefined', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 0 });
    expect(lastInput(notesQuery).archived).toBeUndefined();
  });

  it('passes archived=true when archived is true', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 0, archived: true });
    expect(lastInput(notesQuery).archived).toBe(true);
  });

  it('passes archived=false when archived is false', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 0, archived: false });
    expect(lastInput(notesQuery).archived).toBe(false);
  });

  it('trims search and includes it when non-empty', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 0, search: '  hello  ' });
    expect(lastInput(notesQuery).search).toBe('hello');
  });

  it('omits search when whitespace-only', async () => {
    setResponse(notesQuery, []);
    await fetchTierPage('notes', { pageParam: 0, search: '   ' });
    expect(lastInput(notesQuery).search).toBeUndefined();
  });

  it('returns the response body unchanged', async () => {
    const body = [{ id: '1' }, { id: '2' }];
    setResponse(notesQuery, body);
    const result = await fetchTierPage<{ id: string }>('notes', { pageParam: 0 });
    expect(result).toEqual(body);
  });

  it('routes to the requested tier client', async () => {
    setResponse(secretsQuery, []);
    await fetchTierPage('secrets', { pageParam: 0 });
    expect(secretsQuery).toHaveBeenCalledTimes(1);
    expect(notesQuery).not.toHaveBeenCalled();
  });
});

describe('buildTierPrefetchOptions', () => {
  const config: TierConfig = { key: 'notes' };

  it('returns queryKey [config.key, userId, "active", ""]', () => {
    const opts = buildTierPrefetchOptions(config, 'user-1');
    expect(opts.queryKey).toEqual(['notes', 'user-1', 'active', '']);
  });

  it('returns initialPageParam=0 and pages=1', () => {
    const opts = buildTierPrefetchOptions(config, 'user-1');
    expect(opts.initialPageParam).toBe(0);
    expect(opts.pages).toBe(1);
  });

  it('queryFn invokes fetchTierPage with archived=false, search="", and the passed pageParam', async () => {
    setResponse(notesQuery, []);
    const opts = buildTierPrefetchOptions(config, 'user-1');
    await opts.queryFn({ pageParam: 0 });
    const input = lastInput(notesQuery);
    expect(input.archived).toBe(false);
    expect(input.search).toBeUndefined();
    expect(input.limit).toBe(INITIAL_PAGE_SIZE);
    expect(input.offset).toBe(0);
  });

  it('exposes getNextPageParam', () => {
    const opts = buildTierPrefetchOptions(config, 'user-1');
    expect(opts.getNextPageParam).toBe(getNextPageParam);
  });
});
