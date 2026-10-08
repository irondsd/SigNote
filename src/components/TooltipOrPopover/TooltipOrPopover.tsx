'use client';

import * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dropdown } from '@/components/Dropdown/Dropdown';

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
  trigger: React.ReactElement;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
};

export function TooltipOrPopover({ trigger, children, side = 'top', align = 'center' }: TooltipOrPopoverProps) {
  const canHover = usePrefersHover();

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
    <Dropdown trigger={trigger} side={side} align={align} className="z-200">
      {children}
    </Dropdown>
  );
}
