'use client';

import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type DropdownProps = Omit<ComponentProps<typeof PopoverContent>, 'children'> & {
  /** The element that toggles the dropdown. Rendered as the trigger via `asChild`, so it must accept a ref. */
  trigger: ReactElement;
  /** The panel's content, or a render function handed `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Controlled open state. Leave both this and `onOpenChange` out to let the dropdown manage itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The one dropdown in the app: a trigger plus a floating panel with swappable
 * content, closed by Escape, by focus leaving it, and by any press outside it.
 *
 * Radix already dismisses on an outside press, but it waits for the `click`
 * and gives up if anything stopped that click from propagating — which the
 * note modal does, so the tag palette and the actions menu stayed open. It also
 * never fires on iOS Safari, which doesn't send `click` for taps on
 * non-interactive elements. So this listens for `pointerdown` in the capture
 * phase instead, where nothing downstream can swallow it.
 */
export function Dropdown({
  trigger,
  children,
  open: openProp,
  onOpenChange,
  onPointerDownCapture,
  ...contentProps
}: DropdownProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;

  const setOpen = (next: boolean) => {
    // Radix may report the same close again after the outside press already handled it.
    if (next === open) return;
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const close = () => setOpen(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const pressedInsideRef = useRef(false);
  const dismissIfOutside = useEffectEvent(() => {
    if (!pressedInsideRef.current) setOpen(false);
  });

  useEffect(() => {
    if (!open) return;
    let timer: number | undefined;
    const onPointerDown = (e: PointerEvent) => {
      // The trigger toggles the dropdown by itself.
      if (triggerRef.current?.contains(e.target as Node)) return;
      pressedInsideRef.current = false;
      // Decide once the event has finished dispatching: by then the content's
      // React capture handler, which also sees anything portaled out of the
      // content, has had its chance to mark the press as inside.
      timer = window.setTimeout(dismissIfOutside);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.clearTimeout(timer);
    };
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild ref={triggerRef}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        {...contentProps}
        onPointerDownCapture={(e) => {
          pressedInsideRef.current = true;
          onPointerDownCapture?.(e);
        }}
      >
        {typeof children === 'function' ? children(close) : children}
      </PopoverContent>
    </Popover>
  );
}
