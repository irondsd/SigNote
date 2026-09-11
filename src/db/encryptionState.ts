import { eq } from 'drizzle-orm';
import { getDb, type Db } from './client';
import { encryptionStates } from './schema';
import { accountTransaction, requestGeneration } from './transactionContext';

export type EncryptionState = typeof encryptionStates.$inferSelect;
export class VaultConflictError extends Error {
  constructor(readonly code: 'ROTATION_IN_PROGRESS' | 'GENERATION_MISMATCH' | 'INVALID_GENERATION' | 'LOCK_ORDER') {
    super(code);
    this.name = 'VaultConflictError';
  }
}
const initial = (userId: string): EncryptionState => ({
  userId,
  generation: 0,
  sessionEpoch: 0,
  survivingSid: null,
  rotationSessionSid: null,
  activeRotationId: null,
});

export async function getEncryptionState(userId: string): Promise<EncryptionState> {
  const [row] = await getDb().select().from(encryptionStates).where(eq(encryptionStates.userId, userId));
  return row ?? initial(userId);
}

/** Account-wide transaction lock, including first creation. No session-level lock
 * or held connection survives a request. Nested helpers reuse the same tx.
 */
export async function withAccountLock<T>(
  userId: string,
  fn: (db: Db, state: EncryptionState) => Promise<T>,
): Promise<T> {
  const current = accountTransaction.getStore();
  const run = async (db: Db) => {
    await db.insert(encryptionStates).values(initial(userId)).onConflictDoNothing();
    const [state] = await db.select().from(encryptionStates).where(eq(encryptionStates.userId, userId)).for('update');
    const users = new Set(current?.users ?? []);
    users.add(userId);
    return accountTransaction.run({ db, users }, () => fn(db, state));
  };
  if (current) {
    // Multi-account operations must acquire IDs in ascending order to prevent
    // deadlocks. Re-entering an already-held account is always safe.
    if (!current.users.has(userId) && [...current.users].some((id) => id > userId))
      throw new VaultConflictError('LOCK_ORDER');
    return run(current.db);
  }
  return getDb().transaction((tx) => run(tx as Db));
}

export function withRequestGeneration<T>(header: string | null, fn: () => Promise<T>): Promise<T> {
  if (header !== null && (!/^(0|[1-9][0-9]*)$/.test(header) || !Number.isSafeInteger(Number(header)))) {
    throw new VaultConflictError('INVALID_GENERATION');
  }
  return requestGeneration.run(header === null ? undefined : Number(header), fn);
}

/** The generation carried by the current request, defaulting to the only
 * legacy value that is valid before the first rotation. */
export const currentRequestGeneration = (): number => requestGeneration.getStore() ?? 0;

export function withVaultWrite<T>(userId: string, fn: () => Promise<T>, expectedGeneration?: number): Promise<T> {
  return withAccountLock(userId, async (_db, state) => {
    if (state.activeRotationId) throw new VaultConflictError('ROTATION_IN_PROGRESS');
    const expected = expectedGeneration ?? requestGeneration.getStore();
    // Legacy clients work before first rotation, but cannot silently send old
    // ciphertext once an account has activated a replacement generation.
    if (
      (expected === undefined && state.generation !== 0) ||
      (expected !== undefined && expected !== state.generation)
    ) {
      throw new VaultConflictError('GENERATION_MISMATCH');
    }
    return fn();
  });
}

/**
 * Run an ordinary vault read while holding the same account row lock used by
 * writers.  Reads are allowed while a rotation is preparing/migrating (the
 * active generation is still authoritative), but a request carrying a stale
 * or malformed generation must never receive a snapshot from either side of
 * activation.  The callback receives the generation that was locked with the
 * snapshot so callers can put it on the wire.
 */
export function withVaultRead<T>(userId: string, fn: (state: EncryptionState) => Promise<T>): Promise<T> {
  return withAccountLock(userId, async (_db, state) => {
    const expected = requestGeneration.getStore();
    if (
      (expected === undefined && state.generation !== 0) ||
      (expected !== undefined && expected !== state.generation)
    ) {
      throw new VaultConflictError('GENERATION_MISMATCH');
    }
    return fn(state);
  });
}

export function withVaultMaintenance<T>(userId: string, fn: () => Promise<T>): Promise<T | null> {
  return withAccountLock(userId, async (_db, state) => (state.activeRotationId ? null : fn()));
}
