'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { useStepClock } from '@/hooks/useAuthCodes';
import s from './AuthClock.module.scss';

/**
 * The ring is a stroked path, not a conic gradient on the border.
 *
 * A conic sweep is parameterised by *angle* from the centre of the box, so on a
 * pill this wide it crawls along the long top and bottom edges and races around
 * the corners. A dashed path is parameterised by arc length, which is the only
 * way the head keeps one speed the whole way round.
 */
const RING_WIDTH = 1.5;
const HEAD_WIDTH = 2.5;
const CORNER = 9;

/** How long the rewind takes to lap the pill, and how long its bright head is. */
const TRACE_MS = 620;
const HEAD_LENGTH = 0.055;

const outCubic = (x: number) => 1 - (1 - x) ** 3;

/** Read at the reset rather than subscribed to — that instant is all it gates. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Ring = { d: string; length: number };

/**
 * A rounded rect that starts *and* ends at the middle of the top edge, so the
 * ring's origin is the top centre with no offset constant in the dash maths.
 * The path is the stroke's centre line, hence the half-width inset.
 */
function ringPath(width: number, height: number): Ring | null {
  const inset = RING_WIDTH / 2;
  const w = width - RING_WIDTH;
  const h = height - RING_WIDTH;
  if (w <= 0 || h <= 0) return null;

  const r = Math.max(0, Math.min(CORNER - inset, w / 2, h / 2));
  const left = inset;
  const top = inset;
  const right = inset + w;
  const bottom = inset + h;
  const middle = inset + w / 2;
  const arc = (x: number, y: number) => `A ${r} ${r} 0 0 1 ${x} ${y}`;

  return {
    d: [
      `M ${middle} ${top}`,
      `H ${right - r}`,
      arc(right, top + r),
      `V ${bottom - r}`,
      arc(right - r, bottom),
      `H ${left + r}`,
      arc(left, bottom - r),
      `V ${top + r}`,
      arc(left + r, top),
      'Z',
    ].join(' '),
    length: 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r,
  };
}

/** The pill's own size — the label's width changes with the digit count. */
function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () =>
      setSize((prev) =>
        prev.width === el.offsetWidth && prev.height === el.offsetHeight
          ? prev
          : { width: el.offsetWidth, height: el.offsetHeight },
      );

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

/** 0 → 1 across the rewind, restarted by each step; 1 means "not tracing". */
function useTrace(step: number, active: boolean) {
  const [trace, setTrace] = useState({ step, progress: 1 });

  // Reset on the step change rather than in the effect below: an effect runs a
  // frame late, and that frame would show the full ring the rewind is about to
  // draw in.
  if (trace.step !== step) {
    setTrace({ step, progress: active && !prefersReducedMotion() ? 0 : 1 });
  }

  useEffect(() => {
    if (!active || prefersReducedMotion()) return;

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - start) / TRACE_MS);
      setTrace({ step, progress });
      if (progress < 1) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [step, active]);

  return trace.progress;
}

type AuthClockProps = {
  period: number;
  offsetMs: number;
};

export function AuthClock({ period, offsetMs }: AuthClockProps) {
  const clock = useStepClock(period, offsetMs);
  const [initialStep] = useState(clock.step);
  const hasReset = clock.step !== initialStep;

  const shellRef = useRef<HTMLSpanElement>(null);
  const { width, height } = useBoxSize(shellRef);
  const ring = useMemo(() => ringPath(width, height), [width, height]);
  const trace = useTrace(clock.step, hasReset);

  const drawing = trace < 1;
  // Rewinding, the arc grows clockwise out of the top centre; counting down, its
  // far end stays pinned there and the near edge advances clockwise into it.
  const drawn = drawing ? outCubic(trace) : clock.fraction;
  const dash = ring ? ring.length * drawn : 0;

  return (
    <span ref={shellRef} className={s.clock} data-testid="auth-clock" role="timer">
      {ring && (
        <svg
          className={s.clockRing}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          fill="none"
          aria-hidden="true"
        >
          <path className={s.clockTrack} d={ring.d} strokeWidth={RING_WIDTH} />
          {dash > 0.01 && (
            <path
              className={s.clockArc}
              d={ring.d}
              strokeWidth={RING_WIDTH}
              strokeDasharray={`${dash} ${ring.length}`}
              strokeDashoffset={drawing ? 0 : dash - ring.length}
            />
          )}
          {drawing && (
            <path
              className={s.clockHead}
              d={ring.d}
              strokeWidth={HEAD_WIDTH}
              strokeDasharray={`${ring.length * HEAD_LENGTH} ${ring.length}`}
              strokeDashoffset={-dash}
              opacity={1 - trace * trace}
            />
          )}
        </svg>
      )}
      <span key={clock.step} className={`${s.clockLabel} ${hasReset ? s.clockLabelReset : ''}`}>
        refresh in {clock.seconds}s
      </span>
    </span>
  );
}
