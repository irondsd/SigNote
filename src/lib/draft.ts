export type DraftData = {
  type: 'note' | 'secret' | 'seal';
  title: string;
  content: string; // plaintext for notes; JSON.stringify(EncryptedPayload) for secrets/seals
  encrypted: boolean;
  savedAt: number;
};

const DRAFT_KEY = 'sn_draft';

export function saveDraft(data: DraftData): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

export function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore storage errors
  }
}

// ─── Draft restore signaling ─────────────────────────────────────────────────
// Module-level flag so DraftToast can signal modals that they're being opened
// for a draft restore (vs. opened normally by the user).

let _pendingRestore = false;

export function startDraftRestore(): void {
  _pendingRestore = true;
}

export function isDraftRestorePending(): boolean {
  return _pendingRestore;
}

export function consumeDraftRestore(): DraftData | null {
  if (!_pendingRestore) return null;
  _pendingRestore = false;
  return loadDraft();
}
