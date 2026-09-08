import type { EncryptedPayload } from '@/types/crypto';

export type DraftData = {
  type: 'note' | 'secret' | 'seal';
  title: string;
  /** Always plaintext in memory; on disk it is ciphertext for the encrypted tiers. */
  content: string;
  savedAt: number;
  sourceId?: string;
  draftId?: string;
  color?: string | null;
  pattern?: string | null;
  tags?: string[];
};

/**
 * What actually lands in `localStorage`.
 *
 * Only `content` is encrypted, and only for Secrets and Seals. That is not a
 * half-measure: `secret_notes.title` and `seal_notes.title` are plaintext
 * columns feeding a tsvector index, so the body is the only part the server
 * itself protects. A draft is guarded exactly as well as the row it becomes —
 * which also means the recovery toast can still name the draft without a key.
 *
 * `content` and `enc` are mutually exclusive; a draft carrying `content` for an
 * encrypted tier is a leftover from before draft encryption shipped, readable
 * for one release and re-encrypted the moment its editor next checkpoints.
 */
export type StoredDraft = Omit<DraftData, 'content'> & {
  content?: string;
  enc?: EncryptedPayload;
};

export type DraftContent = Pick<DraftData, 'title' | 'content'> &
  Partial<Pick<DraftData, 'draftId' | 'sourceId' | 'color' | 'pattern' | 'tags'>>;

const DRAFT_KEY = 'sn_draft';
const keyFor = (id?: string) => (id ? `${DRAFT_KEY}:${id}` : DRAFT_KEY);
export const DRAFT_RECOVERY_EVENT = 'signote-draft-recovery';
const pending = new Map<string, number>();
const active = new Set<string>();

export function saveDraft(data: StoredDraft): void {
  try {
    localStorage.setItem(keyFor(data.draftId), JSON.stringify(data));
  } catch {
    // Storage can be unavailable; never prevent the server save.
  }
}

const isEncryptedPayload = (value: unknown): value is EncryptedPayload =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as EncryptedPayload).iv === 'string' &&
  typeof (value as EncryptedPayload).ciphertext === 'string';

/** Every draft on disk, newest first. */
export function loadDrafts(): StoredDraft[] {
  try {
    return Object.keys(localStorage)
      .filter((key) => key === DRAFT_KEY || key.startsWith(`${DRAFT_KEY}:`))
      .flatMap((key) => {
        try {
          const value = JSON.parse(localStorage.getItem(key)!);
          const readable = typeof value?.content === 'string' || isEncryptedPayload(value?.enc);
          return readable &&
            ['note', 'secret', 'seal'].includes(value.type) &&
            typeof value.title === 'string' &&
            typeof value.savedAt === 'number'
            ? [value as StoredDraft]
            : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function loadDraft(): StoredDraft | null {
  return loadDrafts()[0] ?? null;
}

/** The plaintext of a draft that needs no key, or null when one is required. */
export function plaintextOf(draft: StoredDraft): DraftContent | null {
  return draft.content === undefined ? null : { ...draft, content: draft.content };
}

/** No argument is reserved for explicit sign-out/account cleanup. */
export function clearDraft(draft?: StoredDraft | string): void {
  try {
    if (draft === undefined) {
      for (const key of Object.keys(localStorage)) {
        if (key === DRAFT_KEY || key.startsWith(`${DRAFT_KEY}:`)) localStorage.removeItem(key);
      }
    } else if (typeof draft === 'string') {
      localStorage.removeItem(keyFor(draft));
    } else {
      const key = keyFor(draft.draftId);
      // An old request must never erase newer typing in the same form.
      if (localStorage.getItem(key) === JSON.stringify(draft)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore storage errors */
  }
}

export function setDraftActive(id: string, editing: boolean): void {
  if (editing) active.add(id);
  else active.delete(id);
}

export function recoverableDrafts(): StoredDraft[] {
  return loadDrafts().filter((draft) => !pending.has(keyFor(draft.draftId)) && !active.has(draft.draftId ?? ''));
}

/**
 * Promise handlers survive React unmount, unlike mutate's per-call callbacks.
 *
 * `checkpoint` is what goes on disk before the request runs. Notes hand over a
 * value and keep the whole path synchronous, as it has always been; the
 * encrypted tiers hand over a promise, which settles a microtask later — well
 * inside the debounce window, so it still cannot overtake a later flush. A
 * checkpoint that cannot be produced (no key yet) is skipped rather than
 * written in the clear.
 *
 * The pending marker is what suppresses the recovery toast for an in-flight
 * save, so it is set synchronously either way.
 */
export function saveWithRecovery<T>(
  draft: DraftData,
  checkpoint: StoredDraft | null | Promise<StoredDraft | null>,
  save: () => Promise<T>,
): Promise<T> {
  const key = keyFor(draft.draftId);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  const settle = () => {
    const count = (pending.get(key) ?? 1) - 1;
    if (count) pending.set(key, count);
    else pending.delete(key);
  };
  const run = (stored: StoredDraft | null): Promise<T> => {
    if (stored) saveDraft(stored);
    let request: Promise<T>;
    try {
      request = save();
    } catch (error) {
      request = Promise.reject(error);
    }
    return request.then(
      (value) => {
        settle();
        if (stored) clearDraft(stored);
        window.dispatchEvent(new CustomEvent(DRAFT_RECOVERY_EVENT));
        return value;
      },
      (error) => {
        settle();
        // The plaintext draft, not the envelope: this tab still holds the
        // content in memory, so the toast it raises can offer it straight back
        // without a key.
        window.dispatchEvent(new CustomEvent(DRAFT_RECOVERY_EVENT, { detail: draft }));
        throw error;
      },
    );
  };
  return checkpoint instanceof Promise ? checkpoint.catch(() => null).then(run) : run(checkpoint);
}
