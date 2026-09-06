/**
 * Local storage for the authenticator, in its own IndexedDB database.
 *
 * Deliberately NOT a new object store inside `signote-offline`: idb-keyval opens
 * that database at version 1 with a single `query-cache` store, and adding a
 * second store needs a version upgrade the existing code does not perform.
 *
 * Just as deliberately not the TanStack Query persister. That cache is busted on
 * every app version bump and deleted whenever the session goes unauthenticated,
 * and neither event may cost the user their codes. Ordinary sign-out, a JWT
 * expiring, a 401 on sync and losing the network never delete anything here —
 * only an explicit removal, the user accepting removal of another account's
 * vault, or a profile-generation mismatch reported by an authenticated sync.
 */

const DB_NAME = 'signote-otp';
const DB_VERSION = 1;
const VAULTS = 'vaults';
const RECORDS = 'records';

/** Which account this browser last showed, so an offline visit with no session
 *  knows whose vault to open. Not sensitive: it is a user id, not a key. */
const LAST_ACTIVE_KEY = 'signote-otp-last-active';

export type OtpVaultEntry = {
  userId: string;
  /** Non-extractable AES-GCM key. Stored as a CryptoKey via structured clone —
   *  never as raw bytes, so ordinary script on the origin cannot export it. */
  key: CryptoKey;
  /** The encryption-profile generation this key belongs to. A mismatch reported
   *  by an authenticated sync means the profile was reset and this key is dead. */
  profileId: string;
  /** Random per-device id, kept so a future `otp_devices` table can add remote
   *  revocation without re-enrolling anyone. Unused in v1. */
  deviceId: string;
  enrolledAt: number;
  /** Clock correction from the last successful sync; see `otp.time`. */
  serverTimeOffsetMs: number;
};

export type OtpCachedRecord = {
  userId: string;
  id: string;
  payload: { alg: 'A256GCM'; iv: string; ciphertext: string } | null;
  payloadVersion: number;
  position: number;
  revision: number;
  archived: boolean;
  color: string | null;
  pattern: string | null;
  updatedAt: string;
  deletedAt: string | null;
};

// ─── Plumbing ────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VAULTS)) db.createObjectStore(VAULTS, { keyPath: 'userId' });
      if (!db.objectStoreNames.contains(RECORDS)) {
        db.createObjectStore(RECORDS, { keyPath: ['userId', 'id'] }).createIndex('byUser', 'userId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open the authenticator database'));
  });

  // A rejected promise must not be cached, or one transient failure disables
  // local storage for the rest of the session.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Authenticator storage failed'));
        tx.onabort = () => reject(tx.error ?? req.error ?? new Error('Authenticator storage was interrupted'));
      }),
  );
}

// ─── Vault key ───────────────────────────────────────────────────────────────

export async function loadVault(userId: string): Promise<OtpVaultEntry | null> {
  try {
    return (await run<OtpVaultEntry | undefined>(VAULTS, 'readonly', (s) => s.get(userId))) ?? null;
  } catch {
    // A browser that blocks site data is "not enrolled", not an error state.
    return null;
  }
}

/**
 * Persisting a `CryptoKey` by structured clone works in current Chromium,
 * Firefox and WebKit, but WebKit has had bugs here. There is no fallback that
 * keeps the security property — storing raw bytes would defeat the point — so a
 * failure surfaces to the caller as "quick access unavailable on this browser".
 */
export async function saveVault(entry: OtpVaultEntry): Promise<void> {
  await run(VAULTS, 'readwrite', (s) => s.put(entry));
}

export async function updateVault(userId: string, patch: Partial<OtpVaultEntry>): Promise<void> {
  const existing = await loadVault(userId);
  if (!existing) return;
  await saveVault({ ...existing, ...patch });
}

export async function listVaultUserIds(): Promise<string[]> {
  try {
    const keys = await run<IDBValidKey[]>(VAULTS, 'readonly', (s) => s.getAllKeys());
    return keys.map(String);
  } catch {
    return [];
  }
}

// ─── Encrypted record cache ──────────────────────────────────────────────────

export async function loadRecords(userId: string): Promise<OtpCachedRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<OtpCachedRecord[]>((resolve, reject) => {
      const req = db.transaction(RECORDS, 'readonly').objectStore(RECORDS).index('byUser').getAll(userId);
      req.onsuccess = () => resolve(req.result as OtpCachedRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Replaces the cache with a whole snapshot. The protocol is deliberately not
 * incremental — a record absent from the snapshot was purged server-side, so
 * "replace" is the reconciliation rule, not an optimisation.
 */
export async function replaceRecords(userId: string, records: OtpCachedRecord[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RECORDS, 'readwrite');
    const store = tx.objectStore(RECORDS);
    const cursorReq = store.index('byUser').openKeyCursor(userId);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
        return;
      }
      for (const record of records) store.put({ ...record, userId });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putRecord(record: OtpCachedRecord): Promise<void> {
  await run(RECORDS, 'readwrite', (s) => s.put(record));
}

// ─── Removal ─────────────────────────────────────────────────────────────────

/** Explicit device removal, or a profile-generation mismatch. Nothing else. */
export async function removeVault(userId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    // Key and cache disappear in one commit. Most importantly, a failed
    // transaction is reported instead of telling the user the device was
    // forgotten while a usable key remains on disk.
    const tx = db.transaction([VAULTS, RECORDS], 'readwrite');
    const vaults = tx.objectStore(VAULTS);
    const records = tx.objectStore(RECORDS);
    const cursorReq = records.index('byUser').openKeyCursor(userId);

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        records.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    vaults.delete(userId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not forget this authenticator device'));
    tx.onabort = () => reject(tx.error ?? new Error('Authenticator removal was interrupted'));
  });
  if (getLastActiveUserId() === userId) clearLastActiveUserId();
}

/** Disarms tabs that may already hold the removed key in memory. */
export function announceVaultRemoval(userId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('signote-otp');
  channel.postMessage({ type: 'vault-removed', userId });
  channel.close();
}

// ─── Last active account ─────────────────────────────────────────────────────

export function getLastActiveUserId(): string | null {
  try {
    return localStorage.getItem(LAST_ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setLastActiveUserId(userId: string): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, userId);
  } catch {
    // Private windows and blocked storage: the chooser falls back to "the only
    // vault present", which is right in every single-account case.
  }
}

export function clearLastActiveUserId(): void {
  try {
    localStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Ask the browser not to evict this origin. Safari drops script-writable
 *  storage after seven days without interaction unless the PWA is installed. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
