/**
 * The client's view of the account's encryption generation.
 *
 * Every ordinary read and write is gated server-side by `withVaultRead` /
 * `withVaultWrite` (`src/db/encryptionState.ts`): a request carrying no
 * generation is only valid while the account has never rotated, and once one
 * has, a request carrying the wrong number is refused rather than served a
 * snapshot from the other side of activation. So the number has to travel on
 * the wire, and this module is where the browser keeps it.
 *
 * The marker is persisted because a crash halfway through post-commit cache
 * cleanup must not leave a device reading old-generation rows with a new key.
 * `reconciled: false` says "the server has moved and this device has not
 * finished catching up" — it survives a reload and makes the next launch redo
 * the purge instead of rendering mixed-key data.
 *
 * Nothing here is a security boundary. The server fence is. This exists so the
 * browser stops sending requests it already knows will be refused, and so an
 * advancement is noticed at the moment it happens rather than at the next
 * failed decryption.
 */

export const ENCRYPTION_GENERATION_HEADER = 'x-signote-encryption-generation';

/** Generation zero is the only value valid for an account that never rotated. */
export const INITIAL_GENERATION = 0;

const MARKER_PREFIX = 'sn_enc_gen';
const CHANNEL = 'signote-encryption-generation';

export type GenerationMarker = {
  generation: number;
  /** False while this device still owes itself a post-commit cache purge. */
  reconciled: boolean;
};

export type GenerationObservation =
  /** The server agrees with what this device already recorded. */
  | 'unchanged'
  /** First contact: nothing local to invalidate, so the value is simply taken. */
  | 'adopted'
  /** A rotation committed. Local caches and keys belong to the old generation. */
  | 'advanced'
  /** The account's generation went backwards, which no supported flow produces. */
  | 'diverged';

const isValidGeneration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const keyFor = (userId: string) => `${MARKER_PREFIX}:${userId}`;

// ─── Persistence ─────────────────────────────────────────────────────────────

export function readMarker(userId: string): GenerationMarker | null {
  if (typeof localStorage === 'undefined' || !userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { generation, reconciled } = parsed as Partial<GenerationMarker>;
    if (!isValidGeneration(generation) || typeof reconciled !== 'boolean') return null;
    return { generation, reconciled };
  } catch {
    // Unreadable storage is treated as "unknown", never as generation zero:
    // the caller resolves it from the server before sending guarded requests.
    return null;
  }
}

export function writeMarker(userId: string, marker: GenerationMarker): void {
  if (typeof localStorage === 'undefined' || !userId || !isValidGeneration(marker.generation)) return;
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(marker));
  } catch {
    // A device that cannot persist the marker still works; it just redoes the
    // server round trip after every reload.
  }
}

export function clearMarker(userId: string): void {
  if (typeof localStorage === 'undefined' || !userId) return;
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    // Nothing to do: the value is advisory and the server fence is not.
  }
}

// ─── Active binding ──────────────────────────────────────────────────────────

/**
 * The transports are plain modules with no access to React context, so the
 * signed-in account is bound here once and read by every header call. Binding
 * `null` (sign-out, account switch) stops the header from being attached at
 * all, which is the correct request for "I do not know this account's state".
 */
let boundUserId: string | null = null;
let boundGeneration: number | null = null;

export function bindGenerationUser(userId: string | null): void {
  if (userId === boundUserId) return;
  boundUserId = userId;
  boundGeneration = userId ? (readMarker(userId)?.generation ?? null) : null;
}

export function boundGenerationUser(): string | null {
  return boundUserId;
}

/** The generation this device will claim, or null while it is still unknown. */
export function currentGeneration(): number | null {
  return boundGeneration;
}

/**
 * Headers for an ordinary same-origin API call. An unknown generation sends
 * nothing: the server then applies its legacy rule (valid only at generation
 * zero) and refuses anything else, which is exactly the signal that makes the
 * caller resolve the real value instead of guessing one.
 */
export function generationHeaders(): Record<string, string> {
  return boundGeneration === null ? {} : { [ENCRYPTION_GENERATION_HEADER]: String(boundGeneration) };
}

// ─── Observation ─────────────────────────────────────────────────────────────

/**
 * Record what the server just said about this account's generation.
 *
 * `adopted` and `advanced` are deliberately different outcomes. A device with
 * no marker has no old-generation cache to throw away, so it takes the number
 * and continues. A device that recorded generation N and is told N+1 has
 * caches, a MEK, an Auth key and decrypted blobs that all belong to a vault
 * that no longer exists — it must purge before it renders anything.
 */
export function observeGeneration(userId: string, generation: number): GenerationObservation {
  if (!userId || !isValidGeneration(generation)) return 'unchanged';
  const marker = readMarker(userId);
  if (userId === boundUserId) boundGeneration = generation;

  if (!marker) {
    writeMarker(userId, { generation, reconciled: true });
    return 'adopted';
  }
  if (marker.generation === generation) {
    return marker.reconciled ? 'unchanged' : 'advanced';
  }
  if (marker.generation > generation) {
    // Never seen in a supported flow: activation only ever moves forwards and
    // erasure clears the marker. Treat it as a full invalidation rather than
    // trusting either side.
    writeMarker(userId, { generation, reconciled: false });
    return 'diverged';
  }
  writeMarker(userId, { generation, reconciled: false });
  return 'advanced';
}

/** Called once the device has finished purging everything the old key touched. */
export function completeReconciliation(userId: string, generation: number): void {
  if (!userId || !isValidGeneration(generation)) return;
  const marker = readMarker(userId);
  if (marker && marker.generation !== generation) return;
  writeMarker(userId, { generation, reconciled: true });
  if (userId === boundUserId) boundGeneration = generation;
}

/** True when this device recorded an advancement it has not yet acted on. */
export function needsReconciliation(userId: string): boolean {
  const marker = readMarker(userId);
  return marker !== null && !marker.reconciled;
}

// ─── Error classification ────────────────────────────────────────────────────

export type GenerationConflict = 'GENERATION_MISMATCH' | 'ROTATION_IN_PROGRESS' | 'INVALID_GENERATION';

type WireError = { message?: string; data?: { code?: string } };

/**
 * `VaultConflictError` codes reach the client as the tRPC error message, with
 * `CONFLICT` (or `BAD_REQUEST` for a malformed header) as the code. Matching
 * the message is what distinguishes a vault fence from an ordinary optimistic
 * write conflict, which shares the `CONFLICT` code.
 */
export function generationConflictOf(error: unknown): GenerationConflict | null {
  const wire = error as WireError | undefined;
  const message = wire?.message;
  if (message === 'GENERATION_MISMATCH' || message === 'ROTATION_IN_PROGRESS' || message === 'INVALID_GENERATION') {
    return message;
  }
  return null;
}

// ─── Cross-tab notification ──────────────────────────────────────────────────

export type GenerationMessage = { userId: string; generation: number };

let channel: BroadcastChannel | null = null;
const channelFor = (): BroadcastChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null;
  return (channel ??= new BroadcastChannel(CHANNEL));
};

const listeners = new Set<(message: GenerationMessage) => void>();

/**
 * Tell every other tab — and this one — that the account's vault moved on.
 *
 * `BroadcastChannel` deliberately does not deliver to the context that posted,
 * but the tab that *noticed* the advancement is usually the tab holding the
 * stale caches, so the local set is notified explicitly rather than leaving the
 * discovering tab as the only one that never reacts.
 */
export function announceGeneration(userId: string, generation: number): void {
  if (!userId || !isValidGeneration(generation)) return;
  const message: GenerationMessage = { userId, generation };
  channelFor()?.postMessage(message);
  for (const listener of [...listeners]) listener(message);
}

export function subscribeGeneration(listener: (message: GenerationMessage) => void): () => void {
  listeners.add(listener);
  const active = channelFor();
  const handler = (event: MessageEvent<GenerationMessage>) => {
    const { userId, generation } = event.data ?? {};
    if (typeof userId === 'string' && userId.length > 0 && isValidGeneration(generation)) {
      listener({ userId, generation });
    }
  };
  active?.addEventListener('message', handler);
  return () => {
    listeners.delete(listener);
    active?.removeEventListener('message', handler);
  };
}

/** Test seam: drops the shared channel, listeners and the bound account. */
export function resetGenerationState(): void {
  channel?.close();
  channel = null;
  listeners.clear();
  boundUserId = null;
  boundGeneration = null;
}
