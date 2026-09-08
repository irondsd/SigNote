'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { codeForRecord } from '@/lib/otp/record';
import { msUntilNextStep, secondsRemaining, totpCounter } from '@/lib/otp/totp';
import type { AuthRecord } from '@/contexts/OtpVaultContext';

const TICK_MS = 250;

export type AuthCodeState = {
  /** Padded to the record's digit count. Absent until the first async compute. */
  code?: string;
  /** Whole seconds left in the step — what the "refresh in Ns" pill shows. */
  seconds: number;
  /** 1 → 0 across the step. Drives the ring's stroke-dashoffset. */
  fraction: number;
};

export type AuthStepClockState = Pick<AuthCodeState, 'seconds' | 'fraction'> & {
  /** Current RFC 6238 step. Changes once at the instant the codes refresh. */
  step: number;
};

/**
 * One timer for the whole page rather than one per card: at thirty accounts
 * that is the difference between one wakeup every 250ms and thirty.
 *
 * Codes are recomputed only when a record's *step* changes, not on every tick.
 * The ring is driven from the tick, since it moves continuously.
 */
export function useAuthCodes(records: AuthRecord[], offsetMs: number) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  const [codes, setCodes] = useState<Record<string, string>>({});
  // Guards against an out-of-order async result overwriting a newer code.
  const computedRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [offsetMs]);

  // Recompute whenever any record crosses into a new step.
  const stepKey = useMemo(
    () =>
      records
        .filter((r) => r.secrets)
        .map((r) => `${r.id}:${totpCounter(now, r.secrets!.period)}`)
        .join('|'),
    [records, now],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        records.map(async (record) => {
          if (!record.secrets) return;
          const step = totpCounter(Date.now() + offsetMs, record.secrets.period);
          if (computedRef.current.get(record.id) === step && codes[record.id]) {
            next[record.id] = codes[record.id];
            return;
          }
          try {
            next[record.id] = await codeForRecord(record.secrets, Date.now() + offsetMs);
            computedRef.current.set(record.id, step);
          } catch {
            // A seed that will not decode is a broken record, not a broken page.
          }
        }),
      );
      if (!cancelled) setCodes(next);
    })();

    return () => {
      cancelled = true;
    };
    // `stepKey` is the real dependency: it changes exactly when a code expires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, offsetMs]);

  const byId = useMemo(() => {
    const out: Record<string, AuthCodeState> = {};
    for (const record of records) {
      const period = record.secrets?.period ?? 30;
      out[record.id] = {
        code: codes[record.id],
        seconds: secondsRemaining(now, period),
        fraction: msUntilNextStep(now, period) / (period * 1000),
      };
    }
    return out;
  }, [records, codes, now]);

  return { byId };
}

/**
 * Just the shared countdown state for the page header.
 *
 * Kept separate from `useAuthCodes` on purpose: the header needs timing, not
 * codes, and calling the full hook for it would run the whole HMAC derivation a
 * second time on every step.
 */
export function useStepClock(period = 30, offsetMs = 0): AuthStepClockState {
  const [now, setNow] = useState(() => Date.now() + offsetMs);

  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [offsetMs]);

  return {
    seconds: secondsRemaining(now, period),
    fraction: msUntilNextStep(now, period) / (period * 1000),
    step: totpCounter(now, period),
  };
}
