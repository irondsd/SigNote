'use client';

import * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function usePrefersHover() {
  const [canHover, setCanHover] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');

    const update = () => setCanHover(media.matches);

    update();
    media.addEventListener('change', update);

    return () => media.removeEventListener('change', update);
  }, []);

  return canHover;
}

type TooltipOrPopoverProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
};

export function TooltipOrPopover({ trigger, children, side = 'top', align = 'center' }: TooltipOrPopoverProps) {
  const canHover = usePrefersHover();

  const [open, setOpen] = React.useState(false);

  // Radix Popover's built-in outside-click detection uses pointerdown, which iOS Safari
  // doesn't fire when tapping non-interactive elements. Add a touchstart listener instead.
  React.useEffect(() => {
    if (!open) return;
    const handleOutsideTap = (e: TouchEvent) => {
      const target = e.target as Node;
      const contentEl = document.querySelector('[data-slot="popover-content"]');
      if (contentEl && !contentEl.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('touchstart', handleOutsideTap, { passive: true });
    return () => document.removeEventListener('touchstart', handleOutsideTap);
  }, [open]);

  if (canHover) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side={side} align={align}>
            {children}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} align={align} className="z-200">
        {children}
      </PopoverContent>
    </Popover>
  );
}
