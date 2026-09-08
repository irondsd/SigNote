export type DraftData = {
  type: 'note' | 'secret' | 'seal';
  title: string;
  content: string; // always plaintext, matching the existing draft recovery policy
  savedAt: number;
  sourceId?: string;
  draftId?: string;
  color?: string | null;
  pattern?: string | null;
  tags?: string[];
};

export type DraftContent = Pick<DraftData, 'title' | 'content'> &
  Partial<Pick<DraftData, 'draftId' | 'sourceId' | 'color' | 'pattern' | 'tags'>>;

const DRAFT_KEY = 'sn_draft';
const keyFor = (id?: string) => (id ? `${DRAFT_KEY}:${id}` : DRAFT_KEY);
export const DRAFT_RECOVERY_EVENT = 'signote-draft-recovery';
const pending = new Map<string, number>();
const active = new Set<string>();

export function saveDraft(data: DraftData): void {
  try {
    localStorage.setItem(keyFor(data.draftId), JSON.stringify(data));
  } catch {
    // Storage can be unavailable; never prevent the server save.
  }
}

export function loadDrafts(): DraftData[] {
  try {
    return Object.keys(localStorage)
      .filter((key) => key === DRAFT_KEY || key.startsWith(`${DRAFT_KEY}:`))
      .flatMap((key) => {
        try {
          const value = JSON.parse(localStorage.getItem(key)!);
          return value &&
            ['note', 'secret', 'seal'].includes(value.type) &&
            typeof value.title === 'string' &&
            typeof value.content === 'string' &&
            typeof value.savedAt === 'number'
            ? [value as DraftData]
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

export function loadDraft(): DraftData | null {
  return loadDrafts()[0] ?? null;
}

/** No argument is reserved for explicit sign-out/account cleanup. */
export function clearDraft(draft?: DraftData | string): void {
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

export function recoverableDrafts(): DraftData[] {
  return loadDrafts().filter((draft) => !pending.has(keyFor(draft.draftId)) && !active.has(draft.draftId ?? ''));
}

/** Promise handlers survive React unmount, unlike mutate's per-call callbacks. */
export function saveWithRecovery<T>(draft: DraftData, save: () => Promise<T>): Promise<T> {
  saveDraft(draft);
  const key = keyFor(draft.draftId);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  const settle = () => {
    const count = (pending.get(key) ?? 1) - 1;
    if (count) pending.set(key, count);
    else pending.delete(key);
  };
  let request: Promise<T>;
  try {
    request = save();
  } catch (error) {
    request = Promise.reject(error);
  }
  return request.then(
    (value) => {
      settle();
      clearDraft(draft);
      window.dispatchEvent(new CustomEvent(DRAFT_RECOVERY_EVENT));
      return value;
    },
    (error) => {
      settle();
      window.dispatchEvent(new CustomEvent(DRAFT_RECOVERY_EVENT, { detail: draft }));
      throw error;
    },
  );
}
