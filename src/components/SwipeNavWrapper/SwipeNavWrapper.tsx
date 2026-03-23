'use client';

import { useRef, useLayoutEffect, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const PAGES = ['/', '/secrets', '/seals'];
const THRESHOLD_RATIO = 0.3; // fraction of screen width to commit navigation
const ANGLE_RATIO = 2.0; // deltaX must be 2× greater than deltaY to count as horizontal (~26°)
const ANIM_MS = 220;

// Gesture is 'pending' until direction is determined, then locked to 'swiping' or 'scrolling'
type GestureState = 'idle' | 'pending' | 'swiping' | 'scrolling';

export function SwipeNavWrapper({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Ref copy of pathname so touch handlers (closed over once) always read current value
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const gestureRef = useRef<GestureState>('idle');
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentDeltaRef = useRef(0);
  const animatingRef = useRef(false);
  const navDirectionRef = useRef<'left' | 'right' | null>(null);
  const prevPathnameRef = useRef(pathname);

  // Runs before paint — cancels slide-out and starts slide-in with no visible flash
  useLayoutEffect(() => {
    if (pathname === prevPathnameRef.current) return;

    const el = mainRef.current;
    const dir = navDirectionRef.current;
    prevPathnameRef.current = pathname;
    navDirectionRef.current = null;

    if (!dir || !el) {
      animatingRef.current = false;
      return;
    }

    el.getAnimations().forEach(a => a.cancel());
    el.style.transform = '';

    const startX = dir === 'left' ? '100%' : '-100%';
    const anim = el.animate(
      [{ transform: `translateX(${startX})` }, { transform: 'translateX(0)' }],
      { duration: ANIM_MS, easing: 'ease-out' },
    );

    anim.addEventListener('finish', () => {
      animatingRef.current = false;
    });

    return () => anim.cancel();
  }, [pathname]);

  // Non-passive touch listeners so we can preventDefault on confirmed horizontal swipes
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // Safety: animatingRef can get stuck if the slide-in animation is cancelled before
      // its finish event fires (e.g. rapid navigation, React strict-mode double-invoke).
      // If no Web Animation is actually running on the element, reset the flag.
      if (animatingRef.current && !mainRef.current?.getAnimations().length) {
        animatingRef.current = false;
      }
      if (animatingRef.current) return;

      const idx = PAGES.indexOf(pathnameRef.current);
      if (idx === -1) return; // archive or other non-main page

      if (document.querySelector('[data-backdrop]')) return;
      if (document.querySelector('[data-drawer-open]')) return;

      gestureRef.current = 'pending';
      startXRef.current = e.touches[0].clientX;
      startYRef.current = e.touches[0].clientY;
      currentDeltaRef.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const state = gestureRef.current;
      if (state === 'idle' || state === 'scrolling') return;

      const deltaX = e.touches[0].clientX - startXRef.current;
      const deltaY = e.touches[0].clientY - startYRef.current;

      // dnd-kit drag is active (200ms hold completed) — let it own this gesture
      if (document.body.dataset.dragging === 'true') {
        gestureRef.current = 'scrolling';
        return;
      }

      if (state === 'pending') {
        if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return; // wait for enough movement

        if (Math.abs(deltaX) >= Math.abs(deltaY) * ANGLE_RATIO) {
          // Confirmed horizontal — check if there's a page to go to
          const idx = PAGES.indexOf(pathnameRef.current);
          if (deltaX > 0 && idx === 0) { gestureRef.current = 'scrolling'; return; }
          if (deltaX < 0 && idx === PAGES.length - 1) { gestureRef.current = 'scrolling'; return; }
          gestureRef.current = 'swiping';
        } else {
          gestureRef.current = 'scrolling';
          return;
        }
      }

      // Confirmed horizontal swipe — block scroll and track position
      e.preventDefault();
      currentDeltaRef.current = deltaX;
      el.style.transition = '';
      el.style.transform = `translateX(${deltaX}px)`;
    };

    const onTouchEnd = () => {
      if (gestureRef.current !== 'swiping') {
        gestureRef.current = 'idle';
        return;
      }

      gestureRef.current = 'idle';
      const delta = currentDeltaRef.current;
      currentDeltaRef.current = 0;

      const pathname = pathnameRef.current;
      const idx = PAGES.indexOf(pathname);

      if (Math.abs(delta) >= window.innerWidth * THRESHOLD_RATIO) {
        const direction: 'left' | 'right' = delta < 0 ? 'left' : 'right';
        const target = PAGES[direction === 'left' ? idx + 1 : idx - 1];

        animatingRef.current = true;
        navDirectionRef.current = direction;
        prevPathnameRef.current = pathname;

        const finalX = direction === 'left' ? '-100%' : '100%';
        const anim = el.animate(
          [{ transform: `translateX(${delta}px)` }, { transform: `translateX(${finalX})` }],
          { duration: ANIM_MS, easing: 'ease-in', fill: 'forwards' },
        );

        anim.addEventListener('finish', () => router.push(target));
      } else {
        // Snap back to original position
        el.animate(
          [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
          { duration: 200, easing: 'ease-out' },
        );
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [router]);

  return (
    <main ref={mainRef} className={className}>
      {children}
    </main>
  );
}
