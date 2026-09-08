/**
 * @jest-environment jsdom
 */

import {
  clearDraft,
  loadDraft,
  loadDrafts,
  plaintextOf,
  saveDraft,
  type DraftData,
  type StoredDraft,
} from '@/lib/draft';

const DRAFT_KEY = 'sn_draft';

const sample: DraftData = {
  type: 'note',
  title: 'My title',
  content: '<p>hello</p>',
  savedAt: 1_700_000_000_000,
};

const editSample: DraftData = {
  ...sample,
  title: 'Recovered edit',
  sourceId: '507f1f77bcf86cd799439011',
};

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('saveDraft / loadDraft', () => {
  it('round-trips the data', () => {
    saveDraft(sample);
    expect(loadDraft()).toEqual(sample);
  });

  it('loadDraft returns null when nothing is saved', () => {
    expect(loadDraft()).toBeNull();
  });

  it('round-trips edit recovery metadata', () => {
    saveDraft(editSample);
    expect(loadDraft()).toEqual(editSample);
  });

  it('loadDraft returns null when stored value is malformed JSON', () => {
    localStorage.setItem(DRAFT_KEY, 'not json');
    expect(loadDraft()).toBeNull();
  });
});

describe('clearDraft', () => {
  it('removes the entry', () => {
    saveDraft(sample);
    clearDraft();
    expect(loadDraft()).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('storage error handling', () => {
  it('saveDraft swallows storage errors', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveDraft(sample)).not.toThrow();
  });

  it('loadDraft swallows storage errors', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(loadDraft()).toBeNull();
  });

  it('clearDraft swallows storage errors', () => {
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => clearDraft()).not.toThrow();
  });
});

describe('encrypted envelopes', () => {
  const envelope: StoredDraft = {
    type: 'secret',
    title: 'Card PIN',
    savedAt: 1_700_000_000_000,
    draftId: 'draft-1',
    enc: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y3Q=' },
  };

  it('round-trips a draft that carries ciphertext instead of content', () => {
    saveDraft(envelope);

    expect(loadDraft()).toEqual(envelope);
  });

  it('needs a key, and says so by returning no plaintext', () => {
    expect(plaintextOf(envelope)).toBeNull();
  });

  it('hands back a plaintext draft untouched — notes, and pre-encryption leftovers', () => {
    expect(plaintextOf(sample)).toMatchObject({ title: 'My title', content: '<p>hello</p>' });
  });

  it('rejects a slot that has neither content nor a usable payload', () => {
    localStorage.setItem(`${DRAFT_KEY}:broken`, JSON.stringify({ ...envelope, enc: { iv: 'aXY=' } }));

    expect(loadDrafts()).toHaveLength(0);
  });
});
