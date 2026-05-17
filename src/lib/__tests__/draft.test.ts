/**
 * @jest-environment jsdom
 */

import { saveDraft, loadDraft, clearDraft, type DraftData } from '@/lib/draft';

const DRAFT_KEY = 'sn_draft';

const sample: DraftData = {
  type: 'note',
  title: 'My title',
  content: '<p>hello</p>',
  savedAt: 1_700_000_000_000,
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
