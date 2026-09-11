/**
 * Resolving the account's encryption generation from the server.
 *
 * Deliberately a bare `fetch` rather than one of the tRPC clients: every one of
 * those runs through the link that calls *this*, and a resolver that re-enters
 * its own caller's failure path is a loop. It is also the one request that must
 * never carry a generation header — that is the whole point of the procedure.
 */

import { getSessionClientHeaders } from './sessionClient';
import {
  announceGeneration,
  boundGenerationUser,
  observeGeneration,
  type GenerationObservation,
} from './encryptionGeneration';

export type ResolvedGeneration = { generation: number; rotationInProgress: boolean };

type WirePayload = { result?: { data?: unknown } };

const isResolved = (value: unknown): value is ResolvedGeneration => {
  if (!value || typeof value !== 'object') return false;
  const { generation, rotationInProgress } = value as Partial<ResolvedGeneration>;
  return (
    typeof generation === 'number' &&
    Number.isSafeInteger(generation) &&
    generation >= 0 &&
    typeof rotationInProgress === 'boolean'
  );
};

/** One in-flight request per burst: a batch of refused calls asks once. */
const inFlight = new Map<string | null, Promise<ResolvedGeneration | null>>();

export function fetchGeneration(): Promise<ResolvedGeneration | null> {
  const userId = boundGenerationUser();
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch('/api/trpc/encryption.generation', {
        method: 'GET',
        headers: { ...getSessionClientHeaders() },
        // Never a cached answer: this value decides which key decrypts what.
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as WirePayload;
      const data = payload?.result?.data;
      return isResolved(data) ? data : null;
    } catch {
      return null;
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, request);
  return request;
}

export type GenerationSyncResult = { outcome: GenerationObservation; resolved: ResolvedGeneration } | null;

/**
 * Ask the server where the account actually is, record it, and tell the other
 * tabs. The returned outcome is what decides the caller's next move: `adopted`
 * means this device had nothing stale and may simply retry, while `advanced`
 * means a rotation committed and everything derived from the old key has to go
 * before anything else happens.
 */
export async function syncGeneration(userId: string): Promise<GenerationSyncResult> {
  if (!userId || boundGenerationUser() !== userId) return null;
  const resolved = await fetchGeneration();
  if (!resolved || boundGenerationUser() !== userId) return null;
  const outcome = observeGeneration(userId, resolved.generation);
  if (outcome === 'advanced' || outcome === 'diverged') announceGeneration(userId, resolved.generation);
  return { outcome, resolved };
}
