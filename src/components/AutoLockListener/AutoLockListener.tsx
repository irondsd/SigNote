'use client';

import { useAutoLock } from '@/hooks/useAutoLock';

export function AutoLockListener() {
  useAutoLock();
  return null;
}
