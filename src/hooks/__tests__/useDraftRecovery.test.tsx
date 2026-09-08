/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { useDraftRecovery } from '../useDraftRecovery';
import { loadDrafts, recoverableDrafts, DRAFT_RECOVERY_EVENT } from '@/lib/draft';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
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
  const first = renderHook(() => useDraftRecovery('note', { title: 'First', content: 'body' }, true));
  const request = deferred();
  act(() => first.result.current.save(() => request.promise));
  first.unmount();
  renderHook(() => useDraftRecovery('seal', { title: 'Second', content: 'private' }, true));
  act(() => jest.advanceTimersByTime(500));
  expect(loadDrafts()).toHaveLength(2);
  await act(async () => request.resolve());
  expect(loadDrafts()).toHaveLength(1);
  expect(loadDrafts()[0].title).toBe('Second');
});

it('retains failed encrypted edits and emits recovery after the editor unmounts', async () => {
  const editor = renderHook(() =>
    useDraftRecovery('secret', { title: 'Edit', content: 'recover me', sourceId: 'secret-1' }, true),
  );
  const request = deferred();
  const onError = jest.fn();
  const listener = jest.fn();
  window.addEventListener(DRAFT_RECOVERY_EVENT, listener);
  act(() => editor.result.current.save(() => request.promise, onError));
  editor.unmount();
  expect(recoverableDrafts()).toHaveLength(0);
  await act(async () => request.reject(new Error('offline')));
  expect(onError).not.toHaveBeenCalled();
  expect(recoverableDrafts()[0]).toMatchObject({ sourceId: 'secret-1', content: 'recover me' });
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
