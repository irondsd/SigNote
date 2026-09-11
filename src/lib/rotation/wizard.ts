/**
 * The rotation wizard's state machine, with no React in it.
 *
 * The UI is a rendering of this object and nothing more, which is what lets the
 * prerequisite rules be tested directly rather than through a DOM: "the
 * acknowledgement cannot be skipped" is an assertion about `canAdvance`, not
 * about whether a button happened to be disabled.
 *
 * Two rules run through every step.
 *
 * **Prerequisites are re-checked, never remembered.** Revoking other sessions
 * and scanning for local drafts both describe a moment, and both can stop being
 * true while the user reads the next screen — a new sign-in invalidates the
 * session prerequisite server-side, and another tab can write a draft. So the
 * checks run again immediately before the freeze, and the server re-checks them
 * once more inside `begin`.
 *
 * **Nothing destructive happens before commit.** Every step up to activation
 * leaves the old vault whole and the old passphrase working. The exceptions are
 * deliberate and called out to the user: revoking other sessions is irreversible
 * even if the rotation is cancelled, and a discarded draft is gone.
 */

import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import type { KdfParams, EncryptedPayload } from '@/types/crypto';
import { createKeyCheck, deriveDeviceShare, importMEK, verifyKeyCheck, xor32 } from '@/lib/crypto';
import { buildRotationBackup, backupFilename, type RecoveryBackupV2 } from '@/lib/recoveryBackup';
import { createRotationMaterial, reopenRotationMaterial, type RotationMaterial } from './crypto';
import { parseAndValidatePendingRecovery, RecoveryValidationError } from './recovery';
import { draftReadiness, freezeDraftWriting, thawDraftWriting, type DraftReadiness } from './drafts';
import { asRotationError, RotationTransportError } from './client';
import { createRotationEngine, type RotationApi, type RotationProgress, type RotationStatus } from './engine';

export type WizardStep =
  /** Scope, cost estimate and the honest description of residual risk. */
  | 'intro'
  /** Revoke every other session, then verify the server agrees. */
  | 'sessions'
  /** Resolve local drafts and acknowledge what other devices may still hold. */
  | 'drafts'
  /** Verify the current passphrase; choose and confirm the new one. */
  | 'credentials'
  /** Final summary. `begin` re-checks everything and freezes the inventory. */
  | 'confirm'
  /** Staging and verification, with progress. */
  | 'running'
  /** Save the new recovery file and prove it reconstructs the pending key. */
  | 'recovery'
  /** Activation. */
  | 'commit'
  | 'done';

export type WizardMaterial = {
  version: number;
  serverShare: string;
  salt: string;
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
};

export type WizardDeps = {
  userId: string;
  rotation: RotationApi & {
    status(input?: { operationId?: string }): Promise<{ generation: number; operation: RotationStatus | null }>;
    begin(input: {
      operationId: string;
      sourceGeneration: number;
      profileId: string;
      material: RotationMaterial;
      protocolVersion: 1;
      acknowledgements: { localDraftsResolved: true; otherDeviceDraftLoss: true };
    }): Promise<RotationStatus>;
    cancel(input: { operationId: string; generation: number; workerFence: number }): Promise<RotationStatus>;
    /** Takes ownership after a browser loss, fencing out the previous worker. */
    claim(input: { operationId: string; expectedWorkerFence: number }): Promise<RotationStatus>;
  };
  sessions: {
    list(): Promise<{ sessions: { _id: string; current: boolean }[] }>;
    revokeOthers(): Promise<{ revoked: number }>;
  };
  /** Always the online material: an offline copy cannot be trusted here. */
  material(): Promise<WizardMaterial>;
  profile(): Promise<{ exists: boolean; profileId?: string; generation?: number }>;
  newOperationId(): string;
  scanDrafts?: () => DraftReadiness;
};

export type SessionsState = { checked: boolean; otherSessions: number; revoked: number | null };

export type WizardState = {
  step: WizardStep;
  busy: boolean;
  error: string | null;
  sessions: SessionsState;
  drafts: DraftReadiness | null;
  /** Set once the user checked the other-devices acknowledgement. */
  acknowledgedOtherDevices: boolean;
  passphraseVerified: boolean;
  /** True when the chosen new passphrase equals the current one. Allowed. */
  reusingPassphrase: boolean;
  operation: RotationStatus | null;
  progress: RotationProgress | null;
  recoverySaved: boolean;
  recoveryVerified: boolean;
  generation: number | null;
  /** True when this is a continuation of an operation that already exists. */
  resuming: boolean;
};

const EMPTY: WizardState = {
  step: 'intro',
  busy: false,
  error: null,
  sessions: { checked: false, otherSessions: 0, revoked: null },
  drafts: null,
  acknowledgedOtherDevices: false,
  passphraseVerified: false,
  reusingPassphrase: false,
  operation: null,
  progress: null,
  recoverySaved: false,
  recoveryVerified: false,
  generation: null,
  resuming: false,
};

export const passphraseProblem = (value: string, confirmation: string): string | null => {
  if (value.length < MIN_PASSPHRASE_LENGTH) return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (value.length > MAX_PASSPHRASE_LENGTH) return `Passphrase must be at most ${MAX_PASSPHRASE_LENGTH} characters.`;
  if (value !== confirmation) return 'Passphrases do not match.';
  return null;
};

/**
 * A message the wizard wrote for the user, as opposed to anything a transport,
 * a provider or a crypto primitive threw. Only these are shown verbatim; every
 * other failure is translated, so a stack trace, a provider string or a raw
 * server code can never reach the screen.
 */
export class RotationWizardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RotationWizardError';
  }
}

/** Plain-language reason, for a wizard that must never show a raw error code. */
export function describeRotationError(error: unknown): string {
  if (error instanceof RotationWizardError) return error.message;
  const rotation = error instanceof RotationTransportError ? error : asRotationError(error);
  if (rotation.reason === 'SESSION_PREREQUISITE')
    return 'Another session signed in. Revoke other sessions again before continuing.';
  if (rotation.reason === 'DISABLED') return 'Key rotation is not available on this account yet.';
  if (rotation.reason === 'EXPIRED') return 'This rotation was abandoned for too long and has been discarded.';
  if (rotation.reason === 'SOURCE_CHANGED') return 'Your encrypted data changed during the rotation. Start again.';
  if (rotation.reason === 'SOURCE_CORRUPT') return 'Some encrypted data could not be read. Nothing has been changed.';
  if (rotation.reason === 'RECOVERY_REQUIRED') return 'Save and confirm the new recovery file first.';
  switch (rotation.code) {
    case 'UNAUTHORIZED':
      return 'Your session ended. Sign in again to resume this rotation.';
    case 'CONFLICT':
      return 'This rotation is being continued somewhere else. Reload to take it over.';
    case 'PAYLOAD_TOO_LARGE':
      return 'Some of your data is too large to rotate in one request.';
    case 'NOT_FOUND':
      return 'This rotation could not be found.';
    case 'PRECONDITION_FAILED':
      return 'A requirement for this step is no longer met.';
    default:
      return 'Something went wrong. Nothing has been changed — you can try again.';
  }
}

export function createRotationWizard(deps: WizardDeps) {
  let state: WizardState = { ...EMPTY };
  const listeners = new Set<() => void>();

  // Keys and passphrase-derived values live only here, never in the published
  // state object, so no consumer can render or serialise them by accident.
  let sourceMek: CryptoKey | null = null;
  let target: { material: RotationMaterial; mek: CryptoKey; deviceShare: Uint8Array } | null = null;
  let currentMaterial: WizardMaterial | null = null;
  let profileId: string | null = null;
  let abort: AbortController | null = null;

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const set = (patch: Partial<WizardState>) => {
    state = { ...state, ...patch };
    emit();
  };

  const token = () => {
    const operation = state.operation;
    if (!operation) throw new Error('No rotation operation');
    return {
      operationId: operation.operationId,
      generation: operation.sourceGeneration,
      workerFence: operation.workerFence,
    };
  };

  /** Runs an async step with a single place for the busy flag and the message. */
  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    set({ busy: true, error: null });
    try {
      const result = await work();
      set({ busy: false });
      return result;
    } catch (error) {
      // Pausing aborts the worker mid-call, which surfaces as an abort error.
      // That is the user getting what they asked for, not a failure — and
      // labelling it one would imply something went wrong with their data.
      if (abort?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        set({ busy: false });
        return null;
      }
      set({ busy: false, error: describeRotationError(error) });
      return null;
    }
  }

  const scan = deps.scanDrafts ?? draftReadiness;

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,

    /**
     * Whether the wizard may leave a step. Deliberately a pure function of
     * state: a disabled button is a rendering of this, not the rule itself.
     */
    canAdvance(from: WizardStep = state.step): boolean {
      switch (from) {
        case 'intro':
          return true;
        case 'sessions':
          // Checked *and* confirmed by the server to be the only one left.
          return state.sessions.checked && state.sessions.otherSessions === 0;
        case 'drafts':
          return (state.drafts?.ready ?? false) && state.acknowledgedOtherDevices;
        case 'credentials':
          return state.passphraseVerified && target !== null;
        case 'confirm':
          return state.operation !== null;
        case 'running':
          return state.progress !== null && state.progress.processed === state.progress.total;
        case 'recovery':
          return state.recoveryVerified;
        default:
          return false;
      }
    },

    goTo(step: WizardStep) {
      set({ step, error: null });
    },

    /** Step 1 → 2. Also the resume entry point: an existing operation wins. */
    async load() {
      return run(async () => {
        const [{ generation, operation }, profile] = await Promise.all([deps.rotation.status(), deps.profile()]);
        profileId = profile.profileId ?? null;
        set({ generation, operation });
        // A durable operation outranks whatever the user was about to start —
        // but resuming still goes through the prerequisites, because a fresh
        // sign-in is exactly what clears the server's session marker, and the
        // fence will refuse every worker call until it is re-established.
        if (operation && !['committed', 'cleaned', 'aborted'].includes(operation.phase)) {
          set({ step: 'sessions', resuming: true });
        }
        return operation;
      });
    },

    async revokeOtherSessions() {
      return run(async () => {
        await deps.sessions.revokeOthers();
        // Trust the server's list, not the revoke count: a session created
        // between the two calls is exactly what must invalidate this step.
        const { sessions } = await deps.sessions.list();
        const others = sessions.filter((session) => !session.current).length;
        set({ sessions: { checked: true, otherSessions: others, revoked: sessions.length } });
        return others;
      });
    },

    async refreshSessions() {
      return run(async () => {
        const { sessions } = await deps.sessions.list();
        const others = sessions.filter((session) => !session.current).length;
        set({ sessions: { ...state.sessions, checked: true, otherSessions: others } });
        return others;
      });
    },

    rescanDrafts() {
      const drafts = scan();
      set({ drafts });
      return drafts;
    },

    acknowledgeOtherDevices(value: boolean) {
      set({ acknowledgedOtherDevices: value });
    },

    /**
     * Verify the current passphrase locally and mint the target material.
     *
     * The current passphrase never leaves the browser; it is checked against
     * `keyCheck` from freshly fetched online material. The new passphrase may
     * equal the old one — a fresh salt makes the device share different
     * regardless — and the UI recommends changing it rather than forbidding it.
     */
    async setCredentials(current: string, next: string, confirmation: string) {
      return run(async () => {
        const problem = passphraseProblem(next, confirmation);
        if (problem) throw new RotationWizardError(problem);

        const material = await deps.material();
        const deviceShare = await deriveDeviceShare(current, material.salt, material.kdf);
        const mek = await importMEK(xor32(deviceShare, decodeShare(material.serverShare)));
        deviceShare.fill(0);
        if (!(await verifyKeyCheck(mek, material.keyCheck))) throw new RotationWizardError('Incorrect passphrase.');

        currentMaterial = material;
        sourceMek = mek;

        // Resuming: the target material already exists on the server and every
        // staged item is bound to it. Minting a second one here would produce a
        // key that opens nothing already done, so the chosen passphrase is
        // checked *against* the pending material instead.
        const pending = state.operation?.pendingMaterial ?? null;
        if (pending) {
          try {
            target = { material: pending as RotationMaterial, ...(await reopenRotationMaterial(next, pending)) };
          } catch {
            throw new RotationWizardError(
              'That is not the new passphrase you chose for this rotation. If you have forgotten it, cancel and start again — your current data is untouched.',
            );
          }
        } else {
          target = await createRotationMaterial(next);
        }
        set({ passphraseVerified: true, reusingPassphrase: current === next });
        return true;
      });
    },

    /**
     * Freeze local work, re-check both prerequisites, and create the durable
     * operation. `begin` is the last point at which nothing exists server-side.
     */
    async begin() {
      return run(async () => {
        if (!target || !profileId || state.generation === null)
          throw new RotationWizardError('Finish the earlier steps first.');

        freezeDraftWriting();
        const drafts = scan();
        set({ drafts });
        if (!drafts.ready) {
          thawDraftWriting();
          throw new RotationWizardError('New local drafts appeared. Resolve them before continuing.');
        }
        const { sessions } = await deps.sessions.list();
        const others = sessions.filter((session) => !session.current).length;
        set({ sessions: { ...state.sessions, checked: true, otherSessions: others } });
        if (others > 0) {
          thawDraftWriting();
          throw new RotationWizardError('Another session signed in. Revoke other sessions again before continuing.');
        }

        // Resuming takes over the operation rather than creating one: the fence
        // advances, so the tab or device that was working on it before cannot
        // keep writing, and its own token stops being accepted.
        const existing = state.operation;
        if (existing && !['committed', 'cleaned', 'aborted'].includes(existing.phase)) {
          const claimed = await deps.rotation.claim({
            operationId: existing.operationId,
            expectedWorkerFence: existing.workerFence,
          });
          set({ operation: claimed, step: 'running' });
          return claimed;
        }

        const operation = await deps.rotation.begin({
          operationId: deps.newOperationId(),
          sourceGeneration: state.generation,
          profileId,
          material: target.material,
          protocolVersion: 1,
          acknowledgements: { localDraftsResolved: true, otherDeviceDraftLoss: true },
        });
        set({ operation, step: 'running' });
        return operation;
      });
    },

    /** Stage and verify everything. Safe to call again after a fault. */
    async process() {
      return run(async () => {
        const operation = state.operation;
        if (!operation || !sourceMek || !target)
          throw new RotationWizardError('This rotation cannot continue on this device.');
        abort = new AbortController();
        const engine = createRotationEngine({
          api: deps.rotation,
          token: token(),
          sourceMek,
          targetMek: target.mek,
          itemCount: operation.itemCount,
          fileBytes: operation.fileBytes,
          signal: abort.signal,
          onProgress: (progress) => set({ progress }),
        });
        await engine.process();
        set({ step: 'recovery' });
        return true;
      });
    },

    /** The user asked to stop. Staged work survives; the old vault is intact. */
    pauseProcessing() {
      abort?.abort();
      abort = null;
    },

    /**
     * The recovery file for the *pending* generation. Marked `pending: true` so
     * a cancelled rotation's file can never be mistaken for a backup of the
     * vault that is still active.
     */
    buildRecoveryFile(): { filename: string; contents: string } {
      const operation = state.operation;
      if (!operation || !target || !profileId) throw new RotationWizardError('There is nothing to back up yet.');
      const backup = buildRotationBackup({
        userId: deps.userId,
        profileId,
        generation: operation.targetGeneration,
        operationId: operation.operationId,
        deviceShare: target.deviceShare,
      });
      set({ recoverySaved: true });
      return { filename: backupFilename(deps.userId), contents: JSON.stringify(backup, null, 2) };
    },

    /**
     * Re-import the saved file and prove it reconstructs the pending key.
     *
     * Parsing and binding are checked first, then the reconstructed key is used
     * to open something only the real target MEK can open. Comparing the two
     * `CryptoKey` objects is not possible — they are non-extractable — and
     * checking `keyCheck` alone would only prove the file matches the material,
     * not that it matches the key this device has been staging with.
     */
    async confirmRecoveryFile(contents: string) {
      return run(async () => {
        const operation = state.operation;
        if (!operation || !target || !profileId) throw new RotationWizardError('There is nothing to confirm yet.');
        let restored: { backup: RecoveryBackupV2; mek: CryptoKey };
        try {
          restored = await parseAndValidatePendingRecovery(contents, {
            userId: deps.userId,
            profileId,
            generation: operation.targetGeneration,
            operationId: operation.operationId,
            material: target.material,
          });
        } catch (error) {
          throw new RotationWizardError(
            error instanceof RecoveryValidationError
              ? 'That file is not the recovery file for this rotation.'
              : 'That file could not be read as a recovery file.',
          );
        }
        // A *fresh* challenge, minted here from the key this device has been
        // staging with and answered by the key the file reconstructs. Re-checking
        // the stored `keyCheck` would only prove the file matches the material
        // the server was handed, which the parser already established — not that
        // it matches the key every replacement was encrypted under.
        const challenge = await createKeyCheck(target.mek);
        if (!(await verifyKeyCheck(restored.mek, challenge))) {
          throw new RotationWizardError('That file does not unlock the new keys.');
        }

        await deps.rotation.confirmRecovery({
          ...token(),
          recovery: {
            profileId,
            generation: operation.targetGeneration,
            inventoryDigest: operation.inventoryDigest,
            acknowledged: true,
          },
        });
        set({ recoveryVerified: true, step: 'commit' });
        return true;
      });
    },

    /** Activation. After this the new passphrase is the only one that works. */
    async commit() {
      return run(async () => {
        const operation = await deps.rotation.commit(token());
        set({ operation, step: 'done' });
        thawDraftWriting();
        return operation;
      });
    },

    /** Before activation only. The old vault and old passphrase are untouched. */
    async cancel() {
      return run(async () => {
        if (state.operation) await deps.rotation.cancel(token());
        thawDraftWriting();
        set({ ...EMPTY, generation: state.generation, step: 'intro' });
        sourceMek = null;
        target = null;
        return true;
      });
    },

    /** Drops every key this wizard held. Called on unmount and on a real 401. */
    dispose() {
      abort?.abort();
      abort = null;
      sourceMek = null;
      target = null;
      currentMaterial = null;
      listeners.clear();
    },

    /** Test and resume seam: what the committed device must reconcile to. */
    get targetGeneration() {
      return state.operation?.targetGeneration ?? null;
    },
    get currentMaterialRef() {
      return currentMaterial;
    },
  };
}

function decodeShare(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}
