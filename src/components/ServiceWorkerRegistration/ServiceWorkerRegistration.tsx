'use client';

import { useEffect } from 'react';
import { isDesktopApp } from '@/lib/desktop';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (isDesktopApp()) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      return;
    }

    if (process.env.NODE_ENV === 'production') void navigator.serviceWorker.register('/sw.js');
  }, []);
  return null;
}
