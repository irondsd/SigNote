/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react';
import { useBurnArming } from '../useBurnArming';

describe('useBurnArming', () => {
  it('fires onArm exactly once when initialBurn=true, no expiresAt, ready', () => {
    const onArm = jest.fn();
    renderHook(() => useBurnArming({ initialBurn: true, expiresAt: null, isReady: true, onArm }));
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when initialBurn=false', () => {
    const onArm = jest.fn();
    renderHook(() => useBurnArming({ initialBurn: false, expiresAt: null, isReady: true, onArm }));
    expect(onArm).not.toHaveBeenCalled();
  });

  it('does NOT fire when expiresAt is already set', () => {
    const onArm = jest.fn();
    renderHook(() =>
      useBurnArming({ initialBurn: true, expiresAt: new Date(Date.now() + 60_000), isReady: true, onArm }),
    );
    expect(onArm).not.toHaveBeenCalled();
  });

  it('waits for isReady before firing', () => {
    const onArm = jest.fn();
    const { rerender } = renderHook(
      ({ isReady }: { isReady: boolean }) => useBurnArming({ initialBurn: true, expiresAt: null, isReady, onArm }),
      { initialProps: { isReady: false } },
    );
    expect(onArm).not.toHaveBeenCalled();

    rerender({ isReady: true });
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire on subsequent re-renders', () => {
    const onArm = jest.fn();
    const { rerender } = renderHook(() => useBurnArming({ initialBurn: true, expiresAt: null, isReady: true, onArm }));
    expect(onArm).toHaveBeenCalledTimes(1);
    rerender();
    rerender();
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('exposes wasInitiallyBurning frozen at mount', () => {
    const { result, rerender } = renderHook(
      ({ initialBurn }: { initialBurn: boolean }) =>
        useBurnArming({ initialBurn, expiresAt: null, isReady: true, onArm: jest.fn() }),
      { initialProps: { initialBurn: false } },
    );
    expect(result.current.wasInitiallyBurning).toBe(false);

    // Even if the underlying note changes, the ref keeps the mount-time value.
    rerender({ initialBurn: true });
    expect(result.current.wasInitiallyBurning).toBe(false);
  });
});
