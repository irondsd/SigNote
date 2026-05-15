'use client';

import { useSyncExternalStore } from 'react';

function subscribe(cb: () => void) {
  const root = document.documentElement;
  const observer = new MutationObserver(cb);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getSnapshot() {
  return document.documentElement.classList.contains('dark');
}

function getServerSnapshot() {
  return false;
}

export function useIsDark() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
