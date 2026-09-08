'use client';

import { useState, type CSSProperties } from 'react';

import { useStepClock } from '@/hooks/useAuthCodes';
import s from './AuthClock.module.scss';

type AuthClockProps = {
  period: number;
  offsetMs: number;
};

type ClockStyle = CSSProperties & { '--clock-elapsed': string };

export function AuthClock({ period, offsetMs }: AuthClockProps) {
  const clock = useStepClock(period, offsetMs);
  const [initialStep] = useState(clock.step);
  const hasReset = clock.step !== initialStep;
  const style: ClockStyle = {
    '--clock-elapsed': `${Math.max(0, Math.min(1, 1 - clock.fraction))}turn`,
  };

  return (
    <span
      key={clock.step}
      className={`${s.clock} ${hasReset ? s.clockReset : ''}`}
      style={style}
      data-testid="auth-clock"
      role="timer"
    >
      <span className={s.clockLabel}>refresh in {clock.seconds}s</span>
      {hasReset && <span className={s.clockShine} aria-hidden="true" />}
    </span>
  );
}
