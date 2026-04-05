'use client';

import { useIdlePreload } from '@/hooks/useIdlePreload';

export function OfflineManager() {
  useIdlePreload();
  return null;
}
