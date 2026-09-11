/**
 * @jest-environment jsdom
 */

import '@/test/idb';

import {
  createKeyCheck,
  decryptSecretBody,
  deriveDeviceShare,
  encryptSecretBody,
  generateSalt,
  getDefaultKdfParams,
  getEncVersion,
  importMEK,
  toBase64,
  xor32,
} from '@/lib/crypto';
import { parseBackupText } from '@/lib/recoveryBackup';
import { saveDraft } from '@/lib/draft';
import { isDraftWritingFrozen, resetDraftFreeze } from '@/lib/rotation/drafts';
import type { RotationStatus } from '@/lib/rotation/engine';
import { createRotationWizard, passphraseProblem, type WizardDeps } from '@/lib/rotation/wizard';
import { createFakeRotationServer, type SeedItem } from '@/test/rotationServer';

const USER = 'user-alice';
const PROFILE = 'profile-1';
const CURRENT = 'correct-horse-battery-staple-42';
const NEXT = 'a-different-and-long-enough-passphrase';
const OPERATION = '00000000-0000-7000-8000-000000000001';

const encrypted = { alg: 'A256GCM' as const, iv: 'aXY=', ciphertext: 'Y3Q=' };

/**
 * A real profile, built exactly as the app builds one: production KDF policy,
 * a random MEK, and a server share that is the XOR of it with the device share.
 * Nothing here is faked, so a wrong passphrase really does fail to reconstruct.
 */
async function realMaterial(passphrase: string) {
  const kdf = getDefaultKdfParams();
  const salt = generateSalt();
  const rawMek = crypto.getRandomValues(new Uint8Array(32));
  const deviceShare = await deriveDeviceShare(passphrase, salt, kdf);
  const mek = await importMEK(rawMek);
  return {
    mek,
    material: {
      version: getEncVersion(),
      salt,
      kdf,
      serverShare: toBase64(xor32(rawMek, deviceShare)),
      keyCheck: await createKeyCheck(mek),
    },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(options: { otherSessions?: number; seed?: SeedItem[]; faults?: Map<string, Error> } = {}) {
  const { mek, material } = await realMaterial(CURRENT);
  const seed: SeedItem[] = options.seed ?? [
    { kind: 'secret', resourceId: 'secret-1', source: await encryptSecretBody(mek, 'kept exactly') },
  ];
  const server = createFakeRotationServer(seed, { operationId: OPERATION, faults: options.faults });

  let others = options.otherSessions ?? 1;
  const sessionList = () => ({
    sessions: [
      { _id: 'current', current: true },
      ...Array.from({ length: others }, (_, index) => ({ _id: `other-${index}`, current: false })),
    ],
  });

  const serverStatus = (phase: string): RotationStatus =>
    ({
      operationId: OPERATION,
      phase,
      paused: false,
      ownerSid: 'current',
      workerFence: 1,
      profileId: PROFILE,
      sourceGeneration: 0,
      targetGeneration: 1,
      itemCount: server.rows.size,
      sourceBytes: 0,
      fileBytes: 0,
      stagedBytes: 0,
      inventoryDigest: 'digest',
      recoveryReady: false,
      expiresAt: new Date(Date.now() + 86_400_000),
      committedAt: null,
      limits: {},
      pendingMaterial: null,
    }) as unknown as RotationStatus;

  const rotation = {
    ...server.api,
    status: async () => ({ generation: 0, operation: null }),
    begin: async () => serverStatus('migrating'),
    cancel: async () => serverStatus('aborted'),
    commit: async () => {
      await server.api.commit({ operationId: OPERATION, generation: 0, workerFence: 1 });
      return serverStatus('committed');
    },
  };

  const deps: WizardDeps = {
    userId: USER,
    rotation: rotation as unknown as WizardDeps['rotation'],
    sessions: {
      list: async () => sessionList(),
      revokeOthers: async () => {
        others = 0;
        return { revoked: 1 };
      },
    },
    material: async () => material,
    profile: async () => ({ exists: true, profileId: PROFILE, generation: 0 }),
    newOperationId: () => OPERATION,
  };

  return {
    server,
    material,
    sourceMek: mek,
    wizard: createRotationWizard(deps),
    signInElsewhere: () => {
      others = 1;
    },
    transfer: server.transfer,
  };
}

/** Drives the wizard up to (but not including) the named step. */
async function advanceTo(h: Harness, step: 'drafts' | 'credentials' | 'confirm' | 'running' | 'recovery' | 'commit') {
  await h.wizard.load();
  h.wizard.goTo('sessions');
  await h.wizard.revokeOtherSessions();
  if (step === 'drafts') return;

  h.wizard.goTo('drafts');
  h.wizard.rescanDrafts();
  h.wizard.acknowledgeOtherDevices(true);
  if (step === 'credentials') return;

  h.wizard.goTo('credentials');
  await h.wizard.setCredentials(CURRENT, NEXT, NEXT);
  if (step === 'confirm') return;

  h.wizard.goTo('confirm');
  await h.wizard.begin();
  if (step === 'running') return;

  await h.wizard.process();
  if (step === 'recovery') return;

  const file = h.wizard.buildRecoveryFile();
  await h.wizard.confirmRecoveryFile(file.contents);
}

beforeEach(() => {
  localStorage.clear();
  resetDraftFreeze();
});

describe('passphrase rules', () => {
  it('applies the same length rules as the rest of the app', () => {
    expect(passphraseProblem('short', 'short')).toMatch(/at least/);
    expect(passphraseProblem('x'.repeat(10_000), 'x'.repeat(10_000))).toMatch(/at most/);
    expect(passphraseProblem(NEXT, 'something else')).toBe('Passphrases do not match.');
    expect(passphraseProblem(NEXT, NEXT)).toBeNull();
  });

  it('permits reusing the current passphrase, and says so', async () => {
    const h = await harness();
    await advanceTo(h, 'credentials');
    h.wizard.goTo('credentials');

    await h.wizard.setCredentials(CURRENT, CURRENT, CURRENT);

    expect(h.wizard.getState().passphraseVerified).toBe(true);
    expect(h.wizard.getState().reusingPassphrase).toBe(true);
    expect(h.wizard.canAdvance('credentials')).toBe(true);
  });

  it('refuses to continue on a wrong current passphrase', async () => {
    const h = await harness();
    await advanceTo(h, 'credentials');
    h.wizard.goTo('credentials');

    await h.wizard.setCredentials('not the passphrase', NEXT, NEXT);

    expect(h.wizard.getState().passphraseVerified).toBe(false);
    expect(h.wizard.getState().error).toBe('Incorrect passphrase.');
    expect(h.wizard.canAdvance('credentials')).toBe(false);
  });
});

describe('prerequisites cannot be skipped', () => {
  it('holds the sessions step until the server reports only this session', async () => {
    const h = await harness({ otherSessions: 2 });
    await h.wizard.load();
    h.wizard.goTo('sessions');

    await h.wizard.refreshSessions();
    expect(h.wizard.canAdvance('sessions')).toBe(false);

    await h.wizard.revokeOtherSessions();
    expect(h.wizard.getState().sessions.otherSessions).toBe(0);
    expect(h.wizard.canAdvance('sessions')).toBe(true);
  });

  it('holds the drafts step on an outstanding draft', async () => {
    const h = await harness();
    saveDraft({ type: 'secret', title: 'Unsaved', enc: encrypted, savedAt: 1, draftId: 'd1' });
    await advanceTo(h, 'credentials');

    h.wizard.rescanDrafts();
    expect(h.wizard.canAdvance('drafts')).toBe(false);
  });

  it('holds the drafts step on storage it could not read', async () => {
    const h = await harness();
    localStorage.setItem('sn_draft:broken', '{');
    await advanceTo(h, 'credentials');

    h.wizard.rescanDrafts();
    expect(h.wizard.getState().drafts).toMatchObject({ ready: false, reason: 'unreadable' });
    expect(h.wizard.canAdvance('drafts')).toBe(false);
  });

  it('holds the drafts step until the other-devices acknowledgement is given', async () => {
    const h = await harness();
    await advanceTo(h, 'credentials');

    h.wizard.rescanDrafts();
    h.wizard.acknowledgeOtherDevices(false);
    expect(h.wizard.canAdvance('drafts')).toBe(false);

    h.wizard.acknowledgeOtherDevices(true);
    expect(h.wizard.canAdvance('drafts')).toBe(true);
  });

  it('refuses to commit before the recovery file is confirmed', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');

    expect(h.wizard.getState().recoveryVerified).toBe(false);
    expect(h.wizard.canAdvance('recovery')).toBe(false);
  });
});

describe('begin re-checks what the earlier steps established', () => {
  it('refuses when a session signed in after the sessions step', async () => {
    const h = await harness();
    await advanceTo(h, 'confirm');
    h.wizard.goTo('confirm');
    h.signInElsewhere();

    await h.wizard.begin();

    expect(h.wizard.getState().operation).toBeNull();
    expect(h.wizard.getState().error).toMatch(/Revoke other sessions again/);
    // The freeze is lifted again: nothing started, so nothing stays frozen.
    expect(isDraftWritingFrozen()).toBe(false);
  });

  it('refuses when another tab wrote a draft after the drafts step', async () => {
    const h = await harness();
    await advanceTo(h, 'confirm');
    h.wizard.goTo('confirm');
    saveDraft({ type: 'seal', title: 'Late', enc: encrypted, savedAt: 9, draftId: 'late' });

    await h.wizard.begin();

    expect(h.wizard.getState().operation).toBeNull();
    expect(h.wizard.getState().error).toMatch(/New local drafts/);
    expect(isDraftWritingFrozen()).toBe(false);
  });

  it('freezes encrypted checkpoints once the operation exists', async () => {
    const h = await harness();
    await advanceTo(h, 'running');

    expect(h.wizard.getState().operation).not.toBeNull();
    expect(isDraftWritingFrozen()).toBe(true);
  });
});

describe('the recovery file', () => {
  it('is bound to this operation and marked pending', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');

    const file = h.wizard.buildRecoveryFile();
    const parsed = parseBackupText(file.contents);

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.backup).toMatchObject({
      version: 2,
      userId: USER,
      profileId: PROFILE,
      generation: 1,
      operationId: OPERATION,
      pending: true,
    });
    expect(file.filename).toMatch(/^signote-recovery-/);
  });

  it('is accepted only when it reconstructs the key the run actually used', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');
    const file = h.wizard.buildRecoveryFile();

    await h.wizard.confirmRecoveryFile(file.contents);

    expect(h.wizard.getState().error).toBeNull();
    expect(h.wizard.getState().recoveryVerified).toBe(true);
    expect(h.wizard.getState().step).toBe('commit');
  });

  it('rejects a file from another operation', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');
    const file = h.wizard.buildRecoveryFile();
    const foreign = JSON.stringify({
      ...JSON.parse(file.contents),
      operationId: '00000000-0000-7000-8000-00000000ffff',
    });

    await h.wizard.confirmRecoveryFile(foreign);

    expect(h.wizard.getState().recoveryVerified).toBe(false);
    expect(h.wizard.getState().error).toMatch(/not the recovery file for this rotation/);
  });

  it('rejects a legacy v1 file', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');
    const legacy = JSON.stringify({
      type: 'signote-recovery',
      version: 1,
      createdAt: new Date().toISOString(),
      userId: USER,
      deviceShare: toBase64(new Uint8Array(32)),
    });

    await h.wizard.confirmRecoveryFile(legacy);

    expect(h.wizard.getState().recoveryVerified).toBe(false);
  });

  it('rejects a file that is not a recovery file at all', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');

    await h.wizard.confirmRecoveryFile('not json at all');

    expect(h.wizard.getState().error).toMatch(/could not be read|not the recovery file/);
    expect(h.wizard.getState().recoveryVerified).toBe(false);
  });
});

describe('a complete run', () => {
  it('reaches done and leaves the data readable with the new passphrase only', async () => {
    const h = await harness();
    await advanceTo(h, 'commit');

    await h.wizard.commit();

    expect(h.wizard.getState().step).toBe('done');
    // The freeze is lifted: the new keys are active and drafts are safe again.
    expect(isDraftWritingFrozen()).toBe(false);

    const replacement = h.server.row('secret', 'secret-1').replacement as never;
    // Both halves of the key were replaced, so neither the old MEK nor the new
    // device share paired with the *old* server share opens the replacement.
    const file = JSON.parse(h.wizard.buildRecoveryFile().contents) as { deviceShare: string };
    const deviceShare = Uint8Array.from(atob(file.deviceShare), (c) => c.charCodeAt(0));
    const oldServerShare = Uint8Array.from(atob(h.material.serverShare), (c) => c.charCodeAt(0));
    const mismatched = await importMEK(xor32(deviceShare, oldServerShare));

    await expect(decryptSecretBody(h.sourceMek, replacement)).rejects.toThrow();
    await expect(decryptSecretBody(mismatched, replacement)).rejects.toThrow();
    // And the source row is still readable with the old key until activation
    // replaces it, which is what makes a cancelled run lossless.
    await expect(decryptSecretBody(h.sourceMek, h.server.row('secret', 'secret-1').source as never)).resolves.toBe(
      'kept exactly',
    );
  });

  it('cancelling before activation leaves the old vault and passphrase intact', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');

    await h.wizard.cancel();

    expect(h.wizard.getState().step).toBe('intro');
    expect(h.wizard.getState().operation).toBeNull();
    expect(isDraftWritingFrozen()).toBe(false);
    // The source rows were never touched; only staging held replacements.
    await expect(decryptSecretBody(h.sourceMek, h.server.row('secret', 'secret-1').source as never)).resolves.toBe(
      'kept exactly',
    );
  });

  it('reports progress that ends at the full item count', async () => {
    const h = await harness();
    await advanceTo(h, 'recovery');

    const progress = h.wizard.getState().progress;
    expect(progress?.processed).toBe(h.server.rows.size);
    expect(progress?.total).toBe(h.server.rows.size);
  });
});

describe('pausing', () => {
  it('stops the worker without reporting a failure', async () => {
    const h = await harness();
    await advanceTo(h, 'running');

    const processing = h.wizard.process();
    h.wizard.pauseProcessing();
    await processing;

    // The user asked for this. Calling it an error would imply something went
    // wrong with their data, and nothing did.
    expect(h.wizard.getState().error).toBeNull();
    expect(h.wizard.getState().busy).toBe(false);
  });

  it('keeps whatever the server already accepted, so resuming picks up', async () => {
    const h = await harness();
    await advanceTo(h, 'running');

    const processing = h.wizard.process();
    h.wizard.pauseProcessing();
    await processing;
    await h.wizard.process();

    expect(h.wizard.getState().step).toBe('recovery');
    for (const row of h.server.rows.values()) expect(row.verifiedDigest).toBe(row.replacementDigest);
  });
});

describe('errors', () => {
  it('turns a fence conflict into an instruction, not a code', async () => {
    const conflict = Object.assign(new Error('CONFLICT'), {
      data: { code: 'CONFLICT', httpStatus: 409 },
      message: 'CONFLICT',
    });
    const h = await harness({ faults: new Map([['stage:secret:secret-1', conflict]]) });
    await advanceTo(h, 'running');

    await h.wizard.process();

    const error = h.wizard.getState().error;
    expect(error).toMatch(/continued somewhere else/);
    // Never a raw server code: the wizard is the last place a user sees one.
    expect(error).not.toMatch(/[A-Z_]{6,}/);
  });

  it('translates the server refusing a stale session prerequisite', async () => {
    const refused = Object.assign(new Error('SESSION_PREREQUISITE'), {
      data: { code: 'PRECONDITION_FAILED', httpStatus: 412 },
      message: 'SESSION_PREREQUISITE',
    });
    const h = await harness({ faults: new Map([['stage:secret:secret-1', refused]]) });
    await advanceTo(h, 'running');

    await h.wizard.process();

    expect(h.wizard.getState().error).toMatch(/Revoke other sessions again/);
  });
});
