'use client';

import { Info, Loader2 } from 'lucide-react';
import { TooltipOrPopover } from '@/components/TooltipOrPopover/TooltipOrPopover';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="w-full bg-muted/30 text-muted-foreground text-sm flex items-center justify-center gap-2 px-4 py-2">
      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
      <span>You&apos;re offline</span>
      <TooltipOrPopover trigger={<Info className="h-3.5 w-3.5 shrink-0 cursor-help" />}>
        <p className="max-w-xs">
          You&apos;re viewing cached data from your last session. Changes won&apos;t be saved until your connection is
          restored.
        </p>
      </TooltipOrPopover>
    </div>
  );
}
