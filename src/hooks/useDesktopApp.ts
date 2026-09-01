'use client';

import { useSyncExternalStore } from 'react';
import { isDesktopApp } from '@/lib/desktop';

const subscribe = () => () => undefined;

/**
 * Desktop mode is the safe server snapshot: it renders no wallet provider or
 * wallet controls. After hydration, ordinary browsers switch to web mode while
 * Electron keeps the preload-backed desktop tree unchanged.
 */
export function useDesktopApp(): boolean {
  return useSyncExternalStore(subscribe, isDesktopApp, () => true);
}
