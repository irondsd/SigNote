'use client';

import { useRef, useLayoutEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const PAGES = ['/', '/secrets', '/seals'];
const EDGE_ZONE = 25;
const THRESHOLD_RATIO = 0.3;
const ANIM_MS = 220;

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

  const startXRef = useRef<number | null>(null);
  const currentDeltaRef = useRef(0);
  const activeRef = useRef(false);
  const animatingRef = useRef(false);
  const navDirectionRef = useRef<'left' | 'right' | null>(null);
  const prevPathnameRef = useRef(pathname);

  // Runs before paint — cancels slide-out animation and starts slide-in with no visible flash
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

    // Cancel slide-out (including fill:forwards) so inline style takes effect
    el.getAnimations().forEach(a => a.cancel());
    el.style.transform = '';

    // Slide new content in from the opposite edge
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

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (animatingRef.current) return;

      const idx = PAGES.indexOf(pathname);
      if (idx === -1) return;

      const touch = e.touches[0];
      const x = touch.clientX;
      const w = window.innerWidth;
      const fromLeft = x <= EDGE_ZONE;
      const fromRight = x >= w - EDGE_ZONE;

      if (!fromLeft && !fromRight) return;
      if (fromLeft && idx === 0) return;
      if (fromRight && idx === PAGES.length - 1) return;

      if (document.querySelector('[data-backdrop]')) return;
      if (document.querySelector('[data-drawer-open]')) return;

      startXRef.current = x;
      currentDeltaRef.current = 0;
      activeRef.current = true;
    },
    [pathname],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!activeRef.current || startXRef.current === null || !mainRef.current) return;

      const idx = PAGES.indexOf(pathname);
      const delta = e.touches[0].clientX - startXRef.current;

      if (idx === 0 && delta > 0) return;
      if (idx === PAGES.length - 1 && delta < 0) return;

      currentDeltaRef.current = delta;
      mainRef.current.style.transition = '';
      mainRef.current.style.transform = `translateX(${delta}px)`;
    },
    [pathname],
  );

  const handleTouchEnd = useCallback(() => {
    if (!activeRef.current || startXRef.current === null || !mainRef.current) return;

    activeRef.current = false;
    const el = mainRef.current;
    const delta = currentDeltaRef.current;
    currentDeltaRef.current = 0;
    startXRef.current = null;

    const idx = PAGES.indexOf(pathname);

    if (Math.abs(delta) >= window.innerWidth * THRESHOLD_RATIO) {
      const direction: 'left' | 'right' = delta < 0 ? 'left' : 'right';
      const target = PAGES[direction === 'left' ? idx + 1 : idx - 1];

      animatingRef.current = true;
      navDirectionRef.current = direction;
      prevPathnameRef.current = pathname;

      // Animate from drag position to off-screen, then navigate
      // fill:forwards keeps element off-screen until useLayoutEffect cancels it
      const finalX = direction === 'left' ? '-100%' : '100%';
      const anim = el.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: `translateX(${finalX})` }],
        { duration: ANIM_MS, easing: 'ease-in', fill: 'forwards' },
      );

      anim.addEventListener('finish', () => {
        router.push(target);
      });
    } else {
      // Snap back to original position
      const anim = el.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
        { duration: 200, easing: 'ease-out' },
      );

      anim.addEventListener('finish', () => {
        el.style.transform = '';
      });
    }
  }, [pathname, router]);

  return (
    <main
      ref={mainRef}
      className={className}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </main>
  );
}
