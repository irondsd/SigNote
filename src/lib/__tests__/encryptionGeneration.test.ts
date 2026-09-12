/**
 * @jest-environment jsdom
 */

import {
  ENCRYPTION_GENERATION_HEADER,
  announceGeneration,
  bindGenerationUser,
  boundGenerationUser,
  clearMarker,
  completeReconciliation,
  currentGeneration,
  generationConflictOf,
  generationHeaders,
  needsReconciliation,
  observeGeneration,
  readMarker,
  resetGenerationState,
  subscribeGeneration,
  writeMarker,
} from '@/lib/encryptionGeneration';

const ALICE = 'user-alice';
const BOB = 'user-bob';

beforeEach(() => {
  localStorage.clear();
  resetGenerationState();
});

describe('marker persistence', () => {
  it('round-trips a marker and keeps accounts separate', () => {
    writeMarker(ALICE, { generation: 3, reconciled: true });
    writeMarker(BOB, { generation: 7, reconciled: false });

    expect(readMarker(ALICE)).toEqual({ generation: 3, reconciled: true });
    expect(readMarker(BOB)).toEqual({ generation: 7, reconciled: false });
  });

  it('reports unknown rather than zero for absent or corrupt storage', () => {
    expect(readMarker(ALICE)).toBeNull();

    localStorage.setItem(`sn_enc_gen:${ALICE}`, 'not json');
    expect(readMarker(ALICE)).toBeNull();

    localStorage.setItem(`sn_enc_gen:${ALICE}`, JSON.stringify({ generation: -1, reconciled: true }));
    expect(readMarker(ALICE)).toBeNull();

    localStorage.setItem(`sn_enc_gen:${ALICE}`, JSON.stringify({ generation: 2 }));
    expect(readMarker(ALICE)).toBeNull();
  });

  it('clears one account without touching another', () => {
    writeMarker(ALICE, { generation: 1, reconciled: true });
    writeMarker(BOB, { generation: 1, reconciled: true });
    clearMarker(ALICE);

    expect(readMarker(ALICE)).toBeNull();
    expect(readMarker(BOB)).not.toBeNull();
  });
});

describe('headers', () => {
  it('sends nothing until the generation is known', () => {
    bindGenerationUser(ALICE);

    expect(currentGeneration()).toBeNull();
    expect(generationHeaders()).toEqual({});
  });

  it('claims the recorded generation once a marker exists', () => {
    writeMarker(ALICE, { generation: 4, reconciled: true });
    bindGenerationUser(ALICE);

    expect(boundGenerationUser()).toBe(ALICE);
    expect(generationHeaders()).toEqual({ [ENCRYPTION_GENERATION_HEADER]: '4' });
  });

  it('stops claiming anything after sign-out', () => {
    writeMarker(ALICE, { generation: 4, reconciled: true });
    bindGenerationUser(ALICE);
    bindGenerationUser(null);

    expect(boundGenerationUser()).toBeNull();
    expect(generationHeaders()).toEqual({});
  });

  it('does not carry one account generation into another', () => {
    writeMarker(ALICE, { generation: 4, reconciled: true });
    bindGenerationUser(ALICE);
    bindGenerationUser(BOB);

    expect(generationHeaders()).toEqual({});
  });

  it('follows an observation made after binding', () => {
    bindGenerationUser(ALICE);
    observeGeneration(ALICE, 6);

    expect(generationHeaders()).toEqual({ [ENCRYPTION_GENERATION_HEADER]: '6' });
  });
});

describe('observation', () => {
  it('adopts a first value without demanding a purge', () => {
    expect(observeGeneration(ALICE, 5)).toBe('adopted');
    expect(readMarker(ALICE)).toEqual({ generation: 5, reconciled: true });
    expect(needsReconciliation(ALICE)).toBe(false);
  });

  it('is unchanged when the server agrees with a reconciled marker', () => {
    observeGeneration(ALICE, 5);
    expect(observeGeneration(ALICE, 5)).toBe('unchanged');
  });

  it('treats an advancement as needing reconciliation', () => {
    observeGeneration(ALICE, 1);
    expect(observeGeneration(ALICE, 2)).toBe('advanced');
    expect(readMarker(ALICE)).toEqual({ generation: 2, reconciled: false });
    expect(needsReconciliation(ALICE)).toBe(true);
  });

  it('keeps reporting an unfinished purge even when the value stops moving', () => {
    observeGeneration(ALICE, 1);
    observeGeneration(ALICE, 2);
    // A reload re-reads the marker and asks again; the answer must not decay
    // to "unchanged" just because the numbers now match.
    expect(observeGeneration(ALICE, 2)).toBe('advanced');
  });

  it('flags a backwards move as divergence and invalidates anyway', () => {
    observeGeneration(ALICE, 4);
    expect(observeGeneration(ALICE, 2)).toBe('diverged');
    expect(readMarker(ALICE)).toEqual({ generation: 2, reconciled: false });
  });

  it('ignores values that are not generations', () => {
    observeGeneration(ALICE, 2);
    expect(observeGeneration(ALICE, -1)).toBe('unchanged');
    expect(observeGeneration(ALICE, 1.5)).toBe('unchanged');
    expect(readMarker(ALICE)).toEqual({ generation: 2, reconciled: true });
  });
});

describe('completing reconciliation', () => {
  it('marks the recorded generation clean', () => {
    observeGeneration(ALICE, 1);
    observeGeneration(ALICE, 2);
    completeReconciliation(ALICE, 2);

    expect(readMarker(ALICE)).toEqual({ generation: 2, reconciled: true });
    expect(needsReconciliation(ALICE)).toBe(false);
  });

  it('refuses to clean a generation the device is no longer on', () => {
    observeGeneration(ALICE, 1);
    observeGeneration(ALICE, 2);
    observeGeneration(ALICE, 3);
    completeReconciliation(ALICE, 2);

    expect(readMarker(ALICE)).toEqual({ generation: 3, reconciled: false });
  });
});

describe('conflict classification', () => {
  it('names the vault fence codes', () => {
    expect(generationConflictOf({ message: 'GENERATION_MISMATCH' })).toBe('GENERATION_MISMATCH');
    expect(generationConflictOf({ message: 'ROTATION_IN_PROGRESS' })).toBe('ROTATION_IN_PROGRESS');
    expect(generationConflictOf({ message: 'INVALID_GENERATION' })).toBe('INVALID_GENERATION');
  });

  it('leaves an ordinary optimistic conflict alone', () => {
    expect(generationConflictOf({ message: 'Revision mismatch', data: { code: 'CONFLICT' } })).toBeNull();
    expect(generationConflictOf(undefined)).toBeNull();
    expect(generationConflictOf(new Error('boom'))).toBeNull();
  });
});

describe('notification', () => {
  it('reaches the tab that made the announcement', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeGeneration((message) => {
      if (message.userId === ALICE) seen.push(message.generation);
    });

    announceGeneration(ALICE, 9);
    expect(seen).toEqual([9]);

    unsubscribe();
    announceGeneration(ALICE, 10);
    expect(seen).toEqual([9]);
  });

  it('drops malformed announcements', () => {
    const seen: unknown[] = [];
    subscribeGeneration((message) => seen.push(message));

    announceGeneration('', 1);
    announceGeneration(ALICE, -3);
    expect(seen).toEqual([]);
  });
});
