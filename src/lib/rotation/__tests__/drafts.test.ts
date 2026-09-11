/**
 * @jest-environment jsdom
 */

import { saveDraft, loadDrafts } from '@/lib/draft';
import {
  collectFreezeAcknowledgements,
  discardDraftKeys,
  draftReadiness,
  freezeDraftWriting,
  isDraftWritingFrozen,
  observeDraftFreeze,
  resetDraftFreeze,
  scanDrafts,
  thawDraftWriting,
} from '@/lib/rotation/drafts';

const encrypted = { alg: 'A256GCM' as const, iv: 'aXY=', ciphertext: 'Y3Q=' };

/**
 * jsdom has no `BroadcastChannel`, so the cross-tab path would otherwise never
 * be exercised. This models the part the freeze depends on: a message reaches
 * every *other* open instance of the same channel name, never the sender.
 */
class TestBroadcastChannel extends EventTarget {
  static open = new Set<TestBroadcastChannel>();
  constructor(readonly name: string) {
    super();
    TestBroadcastChannel.open.add(this);
  }
  postMessage(data: unknown) {
    for (const peer of TestBroadcastChannel.open) {
      if (peer !== this && peer.name === this.name) {
        peer.dispatchEvent(Object.assign(new Event('message'), { data }));
      }
    }
  }
  close() {
    TestBroadcastChannel.open.delete(this);
  }
}

beforeEach(() => {
  localStorage.clear();
  resetDraftFreeze();
  TestBroadcastChannel.open.clear();
  globalThis.BroadcastChannel = TestBroadcastChannel as unknown as typeof BroadcastChannel;
});

afterEach(() => {
  resetDraftFreeze();
  // @ts-expect-error jsdom does not define it, so removal is the true restore
  delete globalThis.BroadcastChannel;
});

describe('scanning', () => {
  it('reports a clean device as ready', () => {
    const readiness = draftReadiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.scan).toEqual({ drafts: [], unreadableKeys: [], storageUnavailable: false });
  });

  it('lists outstanding drafts newest first', () => {
    saveDraft({ type: 'note', title: 'Older', content: 'a', savedAt: 1, draftId: 'one' });
    saveDraft({ type: 'secret', title: 'Newer', enc: encrypted, savedAt: 2, draftId: 'two' });

    const readiness = draftReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness).toMatchObject({ reason: 'drafts' });
    expect(readiness.scan.drafts.map((draft) => draft.title)).toEqual(['Newer', 'Older']);
  });

  it('refuses to call an unparseable entry "no drafts"', () => {
    localStorage.setItem('sn_draft:broken', '{not json');

    const readiness = draftReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness).toMatchObject({ reason: 'unreadable' });
    expect(readiness.scan.unreadableKeys).toEqual(['sn_draft:broken']);
    // The forgiving loader is exactly what this exists to correct.
    expect(loadDrafts()).toEqual([]);
  });

  it('treats a draft-shaped entry missing its body as unreadable, not absent', () => {
    localStorage.setItem('sn_draft:odd', JSON.stringify({ type: 'secret', title: 'x', savedAt: 1 }));

    expect(draftReadiness()).toMatchObject({ ready: false, reason: 'unreadable' });
  });

  it('reports an unavailable storage API rather than assuming an empty device', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      const readiness = draftReadiness();
      expect(readiness).toMatchObject({ ready: false, reason: 'storage' });
      expect(readiness.scan.storageUnavailable).toBe(true);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('removes only keys the user was shown, and only draft keys', () => {
    saveDraft({ type: 'note', title: 'Keep', content: 'a', savedAt: 1, draftId: 'keep' });
    localStorage.setItem('sn_draft:broken', '{');
    localStorage.setItem('sn_theme', 'dark');

    discardDraftKeys(['sn_draft:broken', 'sn_theme']);

    expect(localStorage.getItem('sn_theme')).toBe('dark');
    expect(scanDrafts()).toMatchObject({ unreadableKeys: [], drafts: [{ draftId: 'keep' }] });
  });
});

describe('freezing', () => {
  it('stops encrypted checkpoints and leaves plaintext Note drafts alone', () => {
    freezeDraftWriting();

    saveDraft({ type: 'secret', title: 'Sealed', enc: encrypted, savedAt: 2, draftId: 'sealed' });
    saveDraft({ type: 'note', title: 'Plain', content: 'still fine', savedAt: 1, draftId: 'plain' });

    expect(isDraftWritingFrozen()).toBe(true);
    expect(scanDrafts().drafts.map((draft) => draft.draftId)).toEqual(['plain']);
  });

  it('resumes ordinary checkpointing after a cancellation', () => {
    freezeDraftWriting();
    thawDraftWriting();

    saveDraft({ type: 'seal', title: 'Sealed', enc: encrypted, savedAt: 1, draftId: 'sealed' });

    expect(isDraftWritingFrozen()).toBe(false);
    expect(scanDrafts().drafts).toHaveLength(1);
  });

  it('still freezes this tab where cross-tab messaging is unavailable', async () => {
    // @ts-expect-error deliberately removing the API for this case
    delete globalThis.BroadcastChannel;
    resetDraftFreeze();

    // A tab that cannot hear the broadcast keeps working, which is why the
    // wizard also asks the user to confirm they checked other devices. The tab
    // running the wizard must still stop writing.
    expect(observeDraftFreeze()()).toBeUndefined();
    await expect(collectFreezeAcknowledgements(0)).resolves.toBe(0);
    expect(isDraftWritingFrozen()).toBe(true);
  });

  it('notifies other tabs and counts their acknowledgements', async () => {
    const states: boolean[] = [];
    // A second channel instance stands in for another tab of the same browser.
    const other = new BroadcastChannel('signote-rotation-freeze');
    other.addEventListener('message', (event: MessageEvent<{ type: string }>) => {
      if (event.data?.type === 'freeze') {
        states.push(true);
        other.postMessage({ type: 'ready', tabId: 'other-tab' });
      }
    });

    const acknowledged = await collectFreezeAcknowledgements(5, (ms) => new Promise((r) => setTimeout(r, ms + 20)));

    expect(isDraftWritingFrozen()).toBe(true);
    expect(states).toEqual([true]);
    expect(acknowledged).toBe(1);
    other.close();
  });

  it('a listening tab stops writing when another tab starts a rotation', () => {
    const wizard = new BroadcastChannel('signote-rotation-freeze');
    const unsubscribe = observeDraftFreeze();

    wizard.postMessage({ type: 'freeze' });
    saveDraft({ type: 'secret', title: 'Sealed', enc: encrypted, savedAt: 1, draftId: 'sealed' });

    expect(isDraftWritingFrozen()).toBe(true);
    expect(scanDrafts().drafts).toEqual([]);
    unsubscribe();
    wizard.close();
  });
});
