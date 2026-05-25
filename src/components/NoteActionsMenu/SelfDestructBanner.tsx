'use client';

import { useEffect, useReducer } from 'react';
import { Flame } from 'lucide-react';
import { formatRemaining } from '@/utils/selfDestruct';
import s from './SelfDestructBanner.module.scss';
import { cn } from '@/utils/cn';

type SelfDestructBannerProps = {
  className?: string;
  expiresAt: Date | string | null;
  burnAfterReading: boolean;
};

export function SelfDestructBanner({ className, expiresAt, burnAfterReading }: SelfDestructBannerProps) {
  const [, tick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!expiresAt) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const remaining = new Date(expiresAt).getTime() - Date.now();
      // Sub-minute window: tick every second so the user sees the countdown.
      const delay = remaining > 60_000 ? 60_000 : 1000;
      timer = setTimeout(() => {
        tick();
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [expiresAt]);

  if (burnAfterReading && !expiresAt) {
    return (
      <div className={cn(s.banner, className)} data-testid="self-destruct-banner">
        <Flame size={13} />
        Self-destructs after closing
      </div>
    );
  }

  if (!expiresAt) return null;

  return (
    <div className={cn(s.banner, className)} data-testid="self-destruct-banner">
      <Flame size={13} />
      Self-destructs in {formatRemaining(expiresAt)}
    </div>
  );
}
