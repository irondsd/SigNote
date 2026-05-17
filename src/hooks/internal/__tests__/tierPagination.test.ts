jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));

import { api } from '@/lib/api';
import {
  viewLabel,
  getNextPageParam,
  fetchTierPage,
  buildTierPrefetchOptions,
  INITIAL_PAGE_SIZE,
  PAGE_SIZE,
  type TierConfig,
} from '@/hooks/internal/tierPagination';

const mockGet = api.get as unknown as jest.Mock;

function setApiResponse<T>(body: T[]) {
  mockGet.mockReturnValue({ json: jest.fn().mockResolvedValue(body) });
}

function lastCallSearchParams(): URLSearchParams {
  const call = mockGet.mock.calls[mockGet.mock.calls.length - 1];
  return call[1].searchParams as URLSearchParams;
}

beforeEach(() => {
  mockGet.mockReset();
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
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 0 });
    const sp = lastCallSearchParams();
    expect(sp.get('limit')).toBe(String(INITIAL_PAGE_SIZE));
    expect(sp.get('offset')).toBe('0');
  });

  it('uses PAGE_SIZE and correct offset for second page (pageParam=1)', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 1 });
    const sp = lastCallSearchParams();
    expect(sp.get('limit')).toBe(String(PAGE_SIZE));
    expect(sp.get('offset')).toBe(String(INITIAL_PAGE_SIZE));
  });

  it('uses correct offset for third page (pageParam=2)', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 2 });
    const sp = lastCallSearchParams();
    expect(sp.get('offset')).toBe(String(INITIAL_PAGE_SIZE + PAGE_SIZE));
  });

  it('omits archived param when archived is undefined', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 0 });
    expect(lastCallSearchParams().has('archived')).toBe(false);
  });

  it('includes archived=true when archived is true', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 0, archived: true });
    expect(lastCallSearchParams().get('archived')).toBe('true');
  });

  it('includes archived=false when archived is false', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 0, archived: false });
    expect(lastCallSearchParams().get('archived')).toBe('false');
  });

  it('trims search and includes q when non-empty', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 0, search: '  hello  ' });
    expect(lastCallSearchParams().get('q')).toBe('hello');
  });

  it('omits q param when search is whitespace-only', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/notes', { pageParam: 0, search: '   ' });
    expect(lastCallSearchParams().has('q')).toBe(false);
  });

  it('returns the JSON body unchanged', async () => {
    const body = [{ id: '1' }, { id: '2' }];
    setApiResponse(body);
    const result = await fetchTierPage<{ id: string }>('/api/notes', { pageParam: 0 });
    expect(result).toEqual(body);
  });

  it('passes the endpoint through to api.get', async () => {
    setApiResponse([]);
    await fetchTierPage('/api/secrets', { pageParam: 0 });
    expect(mockGet.mock.calls[0][0]).toBe('/api/secrets');
  });
});

describe('buildTierPrefetchOptions', () => {
  const config: TierConfig = { key: 'notes', endpoint: '/api/notes' };

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
    setApiResponse([]);
    const opts = buildTierPrefetchOptions(config, 'user-1');
    await opts.queryFn({ pageParam: 0 });
    const sp = lastCallSearchParams();
    expect(mockGet.mock.calls[0][0]).toBe('/api/notes');
    expect(sp.get('archived')).toBe('false');
    expect(sp.has('q')).toBe(false);
    expect(sp.get('limit')).toBe(String(INITIAL_PAGE_SIZE));
    expect(sp.get('offset')).toBe('0');
  });

  it('exposes getNextPageParam', () => {
    const opts = buildTierPrefetchOptions(config, 'user-1');
    expect(opts.getNextPageParam).toBe(getNextPageParam);
  });
});
