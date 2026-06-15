// Precedence + payload mapping for the client-side polymorphic-update dispatch
// that replaced the old REST PATCH. Mirrors the server's old `handleCommonPatch`
// branch order: deleted > archived > color > pattern > tags > position > meta.

const procedures = ['delete', 'restore', 'setArchived', 'setColor', 'setPattern', 'setTags', 'setPosition', 'setMeta'];

function makeTier() {
  return Object.fromEntries(
    procedures.map((p) => [p, { mutate: jest.fn(() => Promise.resolve({ ok: true })) }]),
  ) as Record<string, { mutate: jest.Mock }>;
}

jest.mock('@/lib/trpcClient', () => ({
  trpcClient: { notes: makeTier(), secrets: makeTier(), seals: makeTier() },
}));

import { trpcClient } from '@/lib/trpcClient';
import { dispatchCommonUpdate } from '@/hooks/internal/tierClient';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tier = (name: 'notes' | 'secrets' | 'seals') => trpcClient[name] as any;
const ID = '507f1f77bcf86cd799439011';

beforeEach(() => {
  for (const name of ['notes', 'secrets', 'seals'] as const) {
    for (const p of procedures) tier(name)[p].mutate.mockClear();
  }
});

/** Names every procedure whose `.mutate` was called for the given tier. */
function called(name: 'notes' | 'secrets' | 'seals'): string[] {
  return procedures.filter((p) => tier(name)[p].mutate.mock.calls.length > 0);
}

describe('dispatchCommonUpdate — routing', () => {
  it('deleted:true → delete', () => {
    dispatchCommonUpdate('notes', ID, { deleted: true });
    expect(called('notes')).toEqual(['delete']);
    expect(tier('notes').delete.mutate).toHaveBeenCalledWith({ id: ID });
  });

  it('deleted:false → restore', () => {
    dispatchCommonUpdate('notes', ID, { deleted: false });
    expect(called('notes')).toEqual(['restore']);
  });

  it('archived → setArchived with the flag', () => {
    dispatchCommonUpdate('secrets', ID, { archived: true });
    expect(tier('secrets').setArchived.mutate).toHaveBeenCalledWith({ id: ID, archived: true });
  });

  it('color (incl. null) → setColor', () => {
    dispatchCommonUpdate('notes', ID, { color: null });
    expect(tier('notes').setColor.mutate).toHaveBeenCalledWith({ id: ID, color: null });
  });

  it('pattern → setPattern', () => {
    dispatchCommonUpdate('notes', ID, { pattern: 'dots' });
    expect(tier('notes').setPattern.mutate).toHaveBeenCalledWith({ id: ID, pattern: 'dots' });
  });

  it('tags (defaults missing to []) → setTags', () => {
    dispatchCommonUpdate('notes', ID, { tags: undefined });
    expect(tier('notes').setTags.mutate).toHaveBeenCalledWith({ id: ID, tags: [] });
  });

  it('position → setPosition', () => {
    dispatchCommonUpdate('seals', ID, { position: 3 });
    expect(tier('seals').setPosition.mutate).toHaveBeenCalledWith({ id: ID, position: 3 });
  });

  it('pinned → setMeta', () => {
    dispatchCommonUpdate('notes', ID, { pinned: true });
    expect(tier('notes').setMeta.mutate).toHaveBeenCalledWith({ id: ID, pinned: true });
  });

  it('expiry + burn → setMeta carries both', () => {
    dispatchCommonUpdate('notes', ID, { expiresAt: null, burnAfterReading: true });
    expect(tier('notes').setMeta.mutate).toHaveBeenCalledWith({ id: ID, expiresAt: null, burnAfterReading: true });
  });

  it('content-only payload routes nowhere (returns null for the caller to fall through)', () => {
    const result = dispatchCommonUpdate('notes', ID, { title: 'x', content: 'y' } as never);
    expect(result).toBeNull();
    expect(called('notes')).toEqual([]);
  });
});

describe('dispatchCommonUpdate — precedence (one branch wins per call)', () => {
  it('deleted outranks every other field', () => {
    dispatchCommonUpdate('notes', ID, { deleted: true, archived: true, color: 'red', tags: [], pinned: true });
    expect(called('notes')).toEqual(['delete']);
  });

  it('color outranks tags/position/meta', () => {
    dispatchCommonUpdate('notes', ID, { color: 'red', tags: [ID], position: 1, pinned: true });
    expect(called('notes')).toEqual(['setColor']);
  });

  it('tags outranks position and meta', () => {
    dispatchCommonUpdate('notes', ID, { tags: [ID], position: 1, pinned: true });
    expect(called('notes')).toEqual(['setTags']);
  });
});
