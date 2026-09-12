import { timingSafeEqual } from 'node:crypto';

/** Constant-time `Authorization: Bearer <CRON_SECRET>` check shared by the
 *  scheduled service routes. A missing header or secret never matches. */
export function safeBearerMatch(authHeader: string | null, secret: string | undefined): boolean {
  if (!authHeader || !secret) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
