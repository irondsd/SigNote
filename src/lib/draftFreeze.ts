/**
 * The cross-tab freeze that stops encrypted local checkpoints during a
 * rotation.
 *
 * Its own module, and importing nothing, so `lib/draft.ts` can consult it from
 * inside `saveDraft` without a cycle through the rotation code that drives it.
 * `lib/rotation/drafts.ts` re-exports it for the wizard.
 *
 * Not a security boundary: the server fence is what refuses a write once an
 * operation begins. This closes a narrower gap — a sibling tab writing an
 * encrypted checkpoint in the seconds between the wizard's last scan and the
 * server's snapshot, which after activation could never be opened again.
 */

const FREEZE_CHANNEL = 'signote-rotation-freeze';

export type FreezeMessage = { type: 'freeze' | 'thaw' } | { type: 'ready'; tabId: string };

let frozen = false;
let channel: BroadcastChannel | null = null;
const channelFor = (): BroadcastChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null;
  return (channel ??= new BroadcastChannel(FREEZE_CHANNEL));
};

/**
 * Whether this tab has been told to stop writing encrypted local checkpoints.
 *
 * Read by the editors before they write. A tab that never hears the broadcast —
 * no `BroadcastChannel`, a different browser profile, another device — simply
 * keeps working, which is why the user is also asked to confirm they checked
 * their other devices. This reduces the window; it does not close it.
 */
export const isDraftWritingFrozen = (): boolean => frozen;

/** The wizard's side: tell every other tab to stop, and stop locally. */
export function freezeDraftWriting(): void {
  frozen = true;
  channelFor()?.postMessage({ type: 'freeze' } satisfies FreezeMessage);
}

/** Cancellation, or completion. Editors resume ordinary checkpointing. */
export function thawDraftWriting(): void {
  frozen = false;
  channelFor()?.postMessage({ type: 'thaw' } satisfies FreezeMessage);
}

/**
 * The other tabs' side. Call once per tab; returns an unsubscribe.
 *
 * Acknowledgement is best effort and observational: the wizard uses it to say
 * "3 other tabs have stopped", not to decide that it is safe to proceed.
 */
export function observeDraftFreeze(onChange?: (isFrozen: boolean) => void): () => void {
  const active = channelFor();
  if (!active) return () => undefined;
  const tabId = Math.random().toString(36).slice(2);
  const handler = (event: MessageEvent<FreezeMessage>) => {
    const message = event.data;
    if (message?.type === 'freeze') {
      frozen = true;
      onChange?.(true);
      active.postMessage({ type: 'ready', tabId } satisfies FreezeMessage);
    } else if (message?.type === 'thaw') {
      frozen = false;
      onChange?.(false);
    }
  };
  active.addEventListener('message', handler);
  return () => active.removeEventListener('message', handler);
}

/** Count the tabs that answered a freeze, for the wizard's readiness display. */
export function collectFreezeAcknowledgements(
  timeoutMs = 750,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<number> {
  const active = channelFor();
  const seen = new Set<string>();
  const handler = (event: MessageEvent<FreezeMessage>) => {
    const message = event.data;
    if (message?.type === 'ready') seen.add(message.tabId);
  };
  // Listen before announcing, and freeze this tab whether or not anything can
  // hear it: a browser with no cross-tab messaging still has to stop writing.
  active?.addEventListener('message', handler);
  freezeDraftWriting();
  if (!active) return Promise.resolve(0);
  return sleep(timeoutMs).then(() => {
    active.removeEventListener('message', handler);
    return seen.size;
  });
}

/** Test seam: drops the shared channel and the local freeze flag. */
export function resetDraftFreeze(): void {
  channel?.close();
  channel = null;
  frozen = false;
}
