'use client';

import { useEffect, useReducer } from 'react';
import { getRelativeTime } from '@/utils/getRelativeTime';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

type RelativeDateProps = {
  updatedAt: string | Date;
  createdAt?: string | Date;
  className?: string;
  'data-testid'?: string;
};

function formatExact(date: string | Date): string {
  return new Date(date).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getRefreshInterval(date: string | Date) {
  const ageSeconds = Math.abs(Date.now() - new Date(date).getTime()) / 1000;
  if (ageSeconds < 3600) return 60_000;
  return;
}

export function RelativeDate({ updatedAt, createdAt, className, 'data-testid': testId }: RelativeDateProps) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const interval = getRefreshInterval(updatedAt);
    if (!interval) return;
    const id = setInterval(rerender, interval);
    return () => clearInterval(id);
  }, [updatedAt]);

  useEffect(() => {
    window.addEventListener('focus', rerender);
    return () => window.removeEventListener('focus', rerender);
  }, []);

  const label = (
    <span data-testid={testId} className={className}>
      Updated {getRelativeTime(updatedAt)}
    </span>
  );

  if (!createdAt) return label;

  return (
    <Tooltip>
      <TooltipTrigger asChild className="cursor-pointer">
        {label}
      </TooltipTrigger>
      <TooltipContent>
        <p>Updated: {formatExact(updatedAt)}</p>
        <p>Created: {formatExact(createdAt)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
