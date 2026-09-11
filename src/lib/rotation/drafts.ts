/**
 * Local-work readiness for the rotation wizard.
 *
 * `loadDrafts()` is deliberately forgiving: it swallows a broken storage API
 * and skips a malformed entry, because a recovery toast that throws is worse
 * than one that misses a draft. The wizard needs the opposite. "No drafts
 * found" and "the drafts could not be read" look identical through that
 * function, and only one of them means it is safe to continue — so this module
 * inspects the same keys and reports what it could not read, rather than
 * counting an unreadable store as empty.
 *
 * The cross-tab freeze that keeps a fresh scan true lives in
 * `lib/draftFreeze.ts` — its own module so `lib/draft.ts` can consult it
 * without a cycle — and is re-exported at the bottom of this file.
 */

import { DRAFT_RECOVERY_EVENT, type StoredDraft } from '@/lib/draft';

const DRAFT_KEY = 'sn_draft';

export type DraftScan = {
  /** Drafts this device can name. Encrypted ones may still need a key to read. */
  drafts: StoredDraft[];
  /** Storage keys that look like drafts but could not be parsed. */
  unreadableKeys: string[];
  /** True when the storage API itself is unavailable, so nothing is known. */
  storageUnavailable: boolean;
};

export type DraftReadiness =
  /** Nothing local is outstanding: safe to freeze. */
  | { ready: true; scan: DraftScan }
  /** Something is outstanding, or cannot be established. */
  | { ready: false; reason: 'drafts' | 'unreadable' | 'storage'; scan: DraftScan };

const isDraftKey = (key: string) => key === DRAFT_KEY || key.startsWith(`${DRAFT_KEY}:`);

const looksLikeDraft = (value: unknown): value is StoredDraft => {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<StoredDraft> & { enc?: unknown };
  const body =
    typeof draft.content === 'string' ||
    (!!draft.enc &&
      typeof draft.enc === 'object' &&
      typeof (draft.enc as { ciphertext?: unknown }).ciphertext === 'string');
  return (
    body &&
    typeof draft.title === 'string' &&
    typeof draft.savedAt === 'number' &&
    ['note', 'secret', 'seal'].includes(draft.type as string)
  );
};

/** Read every draft key, separating "none" from "could not tell". */
export function scanDrafts(): DraftScan {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter(isDraftKey);
  } catch {
    return { drafts: [], unreadableKeys: [], storageUnavailable: true };
  }

  const drafts: StoredDraft[] = [];
  const unreadableKeys: string[] = [];
  for (const key of keys) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? '');
      if (looksLikeDraft(value)) drafts.push(value);
      else unreadableKeys.push(key);
    } catch {
      // Present but unparseable. Never silently deleted: the user is shown the
      // key and asked, because this could be another feature's data or a draft
      // whose encoding broke, and guessing wrong discards their writing.
      unreadableKeys.push(key);
    }
  }
  drafts.sort((a, b) => b.savedAt - a.savedAt);
  return { drafts, unreadableKeys, storageUnavailable: false };
}

export function draftReadiness(scan: DraftScan = scanDrafts()): DraftReadiness {
  if (scan.storageUnavailable) return { ready: false, reason: 'storage', scan };
  if (scan.unreadableKeys.length > 0) return { ready: false, reason: 'unreadable', scan };
  if (scan.drafts.length > 0) return { ready: false, reason: 'drafts', scan };
  return { ready: true, scan };
}

/** Deliberate removal of entries the user was shown and chose to discard. */
export function discardDraftKeys(keys: string[]): void {
  for (const key of keys) {
    if (!isDraftKey(key)) continue;
    try {
      localStorage.removeItem(key);
    } catch {
      // Reported by the next scan, which still lists what remains.
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(DRAFT_RECOVERY_EVENT));
  } catch {
    // No window (worker/SSR): the scan is still authoritative.
  }
}

export {
  collectFreezeAcknowledgements,
  freezeDraftWriting,
  isDraftWritingFrozen,
  observeDraftFreeze,
  resetDraftFreeze,
  thawDraftWriting,
  type FreezeMessage,
} from '@/lib/draftFreeze';
