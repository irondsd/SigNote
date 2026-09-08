/** @jest-environment jsdom */
import '@/test/webcrypto';

import * as nodeTimers from 'node:timers';
import { act, renderHook } from '@testing-library/react';
import { useDraftRecovery } from '../useDraftRecovery';
import { decryptDraftContent, importMEK } from '@/lib/crypto';
import { loadDrafts, recoverableDrafts, DRAFT_RECOVERY_EVENT } from '@/lib/draft';

/** A real MEK, so the encrypted tiers run their actual key derivation. */
const makeMek = () => importMEK(new Uint8Array(32).fill(7));

// Captured at import, before `useFakeTimers` replaces it — and from `node:timers`
// because jsdom has no `setImmediate` of its own. Web Crypto resolves off the
// microtask queue, so awaiting a promise is not enough to see an encrypted
// checkpoint land: the real event loop has to turn.
const realSetImmediate = nodeTimers.setImmediate;
const turn = () => new Promise((resolve) => realSetImmediate(resolve));

/** Turns the real event loop until `done`, since a key derivation plus an
 *  encryption take an unpredictable number of turns to land. */
const settle = async (done: () => boolean = () => true) => {
  for (let i = 0; i < 50; i += 1) {
    await act(async () => {
      await turn();
    });
    if (done()) return;
  }
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  // Drain the encryption the previous test's teardown left in flight — React
  // Testing Library unmounts after the test, and an unmount flushes — so its
  // checkpoint cannot land inside this one.
  jest.useRealTimers();
  for (let i = 0; i < 10; i += 1) await turn();
  localStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('saves title-only typing and flushes the latest edit before the debounce on pagehide', () => {
  const { rerender } = renderHook(
    ({ title }) => useDraftRecovery('note', { title, content: '', sourceId: 'original' }, true),
    { initialProps: { title: 'First' } },
  );
  act(() => jest.advanceTimersByTime(500));
  expect(loadDrafts()[0]).toMatchObject({ title: 'First', sourceId: 'original' });
  rerender({ title: 'Latest' });
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(loadDrafts()[0].title).toBe('Latest');
});

it('cleans up a confirmed save after the editor has unmounted, preserving another form', async () => {
  const mek = await makeMek();
  const first = renderHook(() => useDraftRecovery('note', { title: 'First', content: 'body' }, true));
  const request = deferred();
  act(() => first.result.current.save(() => request.promise));
  first.unmount();
  const second = renderHook(() => useDraftRecovery('seal', { title: 'Second', content: 'private' }, true, mek));
  act(() => jest.advanceTimersByTime(500));
  await settle(() => loadDrafts().length === 2);
  expect(loadDrafts()).toHaveLength(2);
  await act(async () => request.resolve());
  expect(loadDrafts()).toHaveLength(1);
  expect(loadDrafts()[0].title).toBe('Second');
  second.unmount();
  await settle();
});

it('retains failed encrypted edits and emits recovery after the editor unmounts', async () => {
  const mek = await makeMek();
  const editor = renderHook(() =>
    useDraftRecovery('secret', { title: 'Edit', content: 'recover me', sourceId: 'secret-1' }, true, mek),
  );
  const request = deferred();
  const onError = jest.fn();
  const listener = jest.fn();
  window.addEventListener(DRAFT_RECOVERY_EVENT, listener);
  act(() => editor.result.current.save(() => request.promise, onError));
  await settle(() => loadDrafts().length === 1);
  editor.unmount();
  expect(recoverableDrafts()).toHaveLength(0);
  await act(async () => request.reject(new Error('offline')));
  await settle(() => recoverableDrafts().length === 1);
  expect(onError).not.toHaveBeenCalled();

  const [kept] = recoverableDrafts();
  expect(kept).toMatchObject({ sourceId: 'secret-1', title: 'Edit' });
  expect(kept.content).toBeUndefined();
  expect(await decryptDraftContent(mek, kept.enc!)).toBe('recover me');
  expect(listener).toHaveBeenCalled();
  window.removeEventListener(DRAFT_RECOVERY_EVENT, listener);
});

it('an old success cannot erase newer typing in the same editor', async () => {
  const editor = renderHook(({ content }) => useDraftRecovery('note', { title: 'Edit', content }, true), {
    initialProps: { content: 'First' },
  });
  const request = deferred();
  act(() => editor.result.current.save(() => request.promise));
  editor.rerender({ content: 'Second' });
  act(() => jest.advanceTimersByTime(500));
  await act(async () => request.resolve());
  expect(loadDrafts()[0].content).toBe('Second');
});

it('discard cancels the debounce and removes only its own draft', () => {
  const first = renderHook(() => useDraftRecovery('note', { title: 'First', content: 'one' }, true));
  renderHook(() => useDraftRecovery('note', { title: 'Second', content: 'two' }, true));
  act(() => jest.advanceTimersByTime(500));
  act(() => first.result.current.discard());
  first.unmount();
  act(() => jest.advanceTimersByTime(1000));
  expect(loadDrafts().map((d) => d.title)).toEqual(['Second']);
});

// ─── Encrypted tiers ─────────────────────────────────────────────────────────

it('never writes Secret or Seal content in the clear', async () => {
  const mek = await makeMek();
  const secret = 'PLAINTEXT_PROBE_SECRET';
  renderHook(() => useDraftRecovery('secret', { title: 'Card PIN', content: secret }, true, mek));
  act(() => jest.advanceTimersByTime(500));
  await settle(() => loadDrafts().length === 1);

  const [stored] = loadDrafts();
  expect(stored.content).toBeUndefined();
  expect(stored.enc).toBeDefined();
  // The whole slot, not just the parsed body — nothing may echo the plaintext.
  expect(JSON.stringify(localStorage)).not.toContain(secret);
  // The title is deliberately still readable: it is a plaintext column on the
  // server too, and the recovery toast needs it without a key.
  expect(stored.title).toBe('Card PIN');
  expect(await decryptDraftContent(mek, stored.enc!)).toBe(secret);
});

it('keeps checkpointing after the vault locks mid-edit', async () => {
  const mek = await makeMek();
  const editor = renderHook(({ content, key }) => useDraftRecovery('seal', { title: 'Locked', content }, true, key), {
    initialProps: { content: 'before lock', key: mek as CryptoKey | null },
  });
  act(() => jest.advanceTimersByTime(500));
  await settle(() => loadDrafts().length === 1);

  // Hard lock: the MEK is gone from the context. The draft key was derived at
  // mount, so typing must still reach disk — and still encrypted.
  editor.rerender({ content: 'typed while locked', key: null });
  act(() => jest.advanceTimersByTime(500));
  await settle(() => Boolean(loadDrafts()[0]?.enc));

  const [stored] = loadDrafts();
  expect(stored.content).toBeUndefined();
  expect(JSON.stringify(localStorage)).not.toContain('typed while locked');
  expect(await decryptDraftContent(mek, stored.enc!)).toBe('typed while locked');
});

it('writes nothing rather than plaintext when no key was ever available', async () => {
  renderHook(() => useDraftRecovery('secret', { title: 'No key', content: 'must not land' }, true, null));
  act(() => jest.advanceTimersByTime(500));
  await settle();

  expect(loadDrafts()).toHaveLength(0);
  expect(JSON.stringify(localStorage)).not.toContain('must not land');
});

it("cannot be recovered with a different account's key", async () => {
  const mine = await makeMek();
  const theirs = await importMEK(new Uint8Array(32).fill(9));
  renderHook(() => useDraftRecovery('secret', { title: 'Mine', content: 'my content' }, true, mine));
  act(() => jest.advanceTimersByTime(500));
  await settle(() => loadDrafts().length === 1);

  await expect(decryptDraftContent(theirs, loadDrafts()[0].enc!)).rejects.toThrow();
});
