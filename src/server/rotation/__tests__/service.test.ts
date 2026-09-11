import { and, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { encryptionStates } from '@/db/schema';
import {
  authSessions,
  encryptionProfiles,
  encryptionRotations,
  fileAttachments,
  otpRecords,
  sealNoteVersions,
  sealNotes,
  secretNoteVersions,
  secretNotes,
  tags,
  secretNoteTags,
  sealNoteTags,
  users,
  rotationCleanup,
  rotationItems,
} from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import {
  decryptFileBytes,
  decryptSecretBody,
  deriveOtpVaultKey,
  decryptSealBody,
  encryptFileBytes,
  encryptSecretBody,
  encryptSealBody,
  encryptSealBodyWithExistingKey,
} from '@/lib/crypto';
import { encryptOtpRecord, toOtpSecrets, decryptOtpRecord } from '@/lib/otp/record';
import {
  createRotationMaterial,
  createRotationSealWrapper,
  rotateAuth,
  rotateBody,
  rotateFile,
} from '@/lib/rotation/crypto';
import { createRotationService } from '../service';
import type { BeginInput, RotationLimits, Worker } from '../contracts';

const USER_ID = 'rotation-service-user';
const PROFILE_ID = 'rotation-service-profile';
const SID = 'rotation-service-session';
const OTHER_USER_ID = 'rotation-service-other-user';
const OTHER_SID = 'rotation-service-other-session';
const SECRET_ID = 'rotation-secret';
const SECRET_VERSION_ID = 'rotation-secret-version';
const SEAL_ID = 'rotation-seal';
const SEAL_VERSION_ID = 'rotation-seal-version';
const AUTH_ID = 'rotation-auth';
const AUTH_TOMBSTONE_ID = 'rotation-auth-tombstone';
const ENCRYPTED_FILE_ID = 'rotation-encrypted-file';
const PLAIN_FILE_ID = 'rotation-plain-file';

type FakeObject = {
  bytes: number;
  checksum: string;
  body?: Uint8Array;
};
type FakeStoredObject = FakeObject & { key: string };

type FakeStorage = {
  sourceReadGrant: (key: string, expiresIn: number) => Promise<string>;
  inspectSource: (key: string) => Promise<{ bytes: number }>;
  allocate: (operationId: string, bytes: number, checksum: string) => FakeObject & { key: string };
  uploadGrant: (
    object: FakeObject & { key: string },
    expiresIn: number,
  ) => Promise<{
    url: string;
    headers: Record<string, string>;
  }>;
  verify: (object: FakeObject & { key: string }) => Promise<void>;
  readGrant: (object: FakeObject & { key: string }, expiresIn: number) => Promise<string>;
  removeKey: (key: string) => Promise<void>;
  sourceBytes: Map<string, number>;
  objects: Map<string, FakeStoredObject>;
  removed: string[];
};

function createFakeStorage(): FakeStorage {
  let sequence = 0;
  const sourceBytes = new Map<string, number>();
  const objects = new Map<string, FakeStoredObject>();
  const removed: string[] = [];
  return {
    sourceReadGrant: async (key) => {
      if (!sourceBytes.has(key)) throw new Error('missing source');
      return `source://${key}`;
    },
    inspectSource: async (key) => {
      const bytes = sourceBytes.get(key);
      if (bytes === undefined) throw new Error('missing source');
      return { bytes };
    },
    allocate: (operationId, bytes, checksum) => {
      const key = `rotation/${operationId}/${String(++sequence).padStart(12, '0')}`;
      const object = { key, bytes, checksum };
      objects.set(key, object);
      return object;
    },
    uploadGrant: async (object) => ({ url: `upload://${object.key}`, headers: {} }),
    verify: async (object) => {
      const stored = objects.get(object.key);
      if (!stored || stored.bytes !== object.bytes || stored.checksum !== object.checksum)
        throw new Error('object mismatch');
    },
    readGrant: async (object) => `read://${object.key}`,
    removeKey: async (key) => {
      removed.push(key);
      objects.delete(key);
    },
    sourceBytes,
    objects,
    removed,
  };
}

type Fixture = {
  db: Db;
  actor: { userId: string; sid: string };
  otherActor: { userId: string; sid: string };
  old: Awaited<ReturnType<typeof createRotationMaterial>>;
  target: Awaited<ReturnType<typeof createRotationMaterial>>;
  operationId: string;
  storage: FakeStorage;
  now: { value: Date };
  sourceFile: { iv: string; cipherBytes: ArrayBuffer; plain: Uint8Array };
  metadata: {
    secret: { title: string; position: number; archived: boolean; pinned: boolean };
    seal: { title: string; position: number; archived: boolean; pinned: boolean };
    secretVersionSeq: number;
    sealVersionSeq: number;
    authRevision: number;
    tombstoneRevision: number;
    plainFileKey: string;
  };
};

function nowAt(fixture: Fixture): Date {
  return new Date(fixture.now.value.getTime());
}

function serviceFor(
  fixture: Fixture,
  commitCheckpoint?: (step: string) => void | Promise<void>,
  limits?: Partial<RotationLimits>,
) {
  return createRotationService({
    storage: fixture.storage as never,
    now: () => nowAt(fixture),
    commitCheckpoint,
    limits,
  });
}

async function seedFixture(db: Db): Promise<Fixture> {
  const now = { value: new Date('2026-09-10T12:00:00.000Z') };
  const old = await createRotationMaterial('old rotation passphrase');
  const target = await createRotationMaterial('new rotation passphrase');
  const storage = createFakeStorage();
  const actor = { userId: USER_ID, sid: SID };
  const otherActor = { userId: OTHER_USER_ID, sid: OTHER_SID };
  const createdAt = now.value;

  await db.insert(users).values([
    { id: USER_ID, displayName: 'Rotation owner' },
    { id: OTHER_USER_ID, displayName: 'Other owner' },
  ]);
  await db.insert(encryptionProfiles).values({
    id: PROFILE_ID,
    userId: USER_ID,
    ...old.material,
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(authSessions).values([
    {
      id: SID,
      userId: USER_ID,
      provider: 'siwe',
      client: 'web',
      expiresAt: new Date('2026-09-11T12:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: OTHER_SID,
      userId: OTHER_USER_ID,
      provider: 'siwe',
      client: 'web',
      expiresAt: new Date('2026-09-11T12:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
    },
  ]);
  await db.insert(encryptionStates).values([
    {
      userId: USER_ID,
      generation: 0,
      sessionEpoch: 1,
      survivingSid: SID,
      rotationSessionSid: SID,
      activeRotationId: null,
    },
    {
      userId: OTHER_USER_ID,
      generation: 0,
      sessionEpoch: 1,
      survivingSid: OTHER_SID,
      rotationSessionSid: OTHER_SID,
      activeRotationId: null,
    },
  ]);

  const secretBody = await encryptSecretBody(old.mek, 'secret body');
  const secretVersion = await encryptSecretBody(old.mek, 'secret history');
  await db.insert(secretNotes).values({
    id: SECRET_ID,
    userId: USER_ID,
    title: 'Secret title',
    position: 12,
    encryptedBody: secretBody,
    archived: true,
    pinned: true,
    color: 'blue',
    pattern: 'dots',
    createdAt,
    updatedAt: new Date('2026-09-09T12:00:00.000Z'),
  });
  await db.insert(secretNoteVersions).values({
    id: SECRET_VERSION_ID,
    noteId: SECRET_ID,
    title: 'Secret old title',
    encryptedBody: secretVersion,
    createdAt: new Date('2026-09-08T12:00:00.000Z'),
  });

  const sealHead = await encryptSealBody(old.mek, 'seal body', SEAL_ID);
  const sealVersion = await encryptSealBodyWithExistingKey(old.mek, 'seal history', SEAL_ID, sealHead.wrappedNoteKey);
  await db.insert(sealNotes).values({
    id: SEAL_ID,
    userId: USER_ID,
    title: 'Seal title',
    position: 25,
    encryptedBody: sealHead.encryptedBody,
    wrappedNoteKey: sealHead.wrappedNoteKey,
    archived: false,
    pinned: true,
    color: 'red',
    pattern: 'stripes',
    createdAt,
    updatedAt: new Date('2026-09-08T12:00:00.000Z'),
  });
  await db.insert(sealNoteVersions).values({
    id: SEAL_VERSION_ID,
    noteId: SEAL_ID,
    title: 'Seal old title',
    encryptedBody: sealVersion.encryptedBody,
    createdAt: new Date('2026-09-07T12:00:00.000Z'),
  });

  const secretTag = 'rotation-secret-tag';
  const sealTag = 'rotation-seal-tag';
  await db.insert(tags).values([
    { id: secretTag, userId: USER_ID, name: 'secret-tag', color: 'blue', createdAt, updatedAt: createdAt },
    { id: sealTag, userId: USER_ID, name: 'seal-tag', color: 'red', createdAt, updatedAt: createdAt },
  ]);
  await db.insert(secretNoteTags).values({ noteId: SECRET_ID, tagId: secretTag, sortOrder: 4 });
  await db.insert(sealNoteTags).values({ noteId: SEAL_ID, tagId: sealTag, sortOrder: 2 });

  const otpKey = await deriveOtpVaultKey(old.mek);
  const otpSecrets = toOtpSecrets({
    issuer: 'Example',
    account: 'rotation@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    note: 'auth body',
  });
  const authPayload = await encryptOtpRecord(otpKey, AUTH_ID, otpSecrets);
  await db.insert(otpRecords).values([
    {
      id: AUTH_ID,
      userId: USER_ID,
      payload: authPayload,
      payloadVersion: 1,
      position: 1,
      revision: 4,
      archived: false,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    {
      id: AUTH_TOMBSTONE_ID,
      userId: USER_ID,
      payload: null,
      payloadVersion: 1,
      position: 2,
      revision: 7,
      archived: true,
      createdAt,
      updatedAt: createdAt,
      deletedAt: new Date('2026-09-09T12:00:00.000Z'),
    },
  ]);

  const plain = new TextEncoder().encode('encrypted attachment bytes');
  const sourceFile = await encryptFileBytes(old.mek, plain);
  const sourceKey = 'source/encrypted-file';
  storage.sourceBytes.set(sourceKey, sourceFile.cipherBytes.byteLength);
  await db.insert(fileAttachments).values([
    {
      id: ENCRYPTED_FILE_ID,
      userId: USER_ID,
      noteId: SECRET_ID,
      noteTier: 'secret',
      s3Key: sourceKey,
      filename: 'encrypted.bin',
      size: sourceFile.cipherBytes.byteLength,
      mimeType: 'application/octet-stream',
      encrypted: true,
      encryptionIv: sourceFile.iv,
      createdAt,
      deletedAt: null,
      storageDeletedAt: null,
    },
    {
      id: PLAIN_FILE_ID,
      userId: USER_ID,
      noteId: null,
      noteTier: null,
      s3Key: 'plain/file',
      filename: 'plain.txt',
      size: 11,
      mimeType: 'text/plain',
      encrypted: false,
      encryptionIv: null,
      createdAt,
      deletedAt: null,
      storageDeletedAt: null,
    },
  ]);

  const [secretVersionRow] = await db
    .select({ seq: secretNoteVersions.seq })
    .from(secretNoteVersions)
    .where(eq(secretNoteVersions.id, SECRET_VERSION_ID));
  const [sealVersionRow] = await db
    .select({ seq: sealNoteVersions.seq })
    .from(sealNoteVersions)
    .where(eq(sealNoteVersions.id, SEAL_VERSION_ID));
  return {
    db,
    actor,
    otherActor,
    old,
    target,
    operationId: crypto.randomUUID(),
    storage,
    now,
    sourceFile: { ...sourceFile, plain },
    metadata: {
      secret: { title: 'Secret title', position: 12, archived: true, pinned: true },
      seal: { title: 'Seal title', position: 25, archived: false, pinned: true },
      secretVersionSeq: Number(secretVersionRow.seq),
      sealVersionSeq: Number(sealVersionRow.seq),
      authRevision: 4,
      tombstoneRevision: 7,
      plainFileKey: 'plain/file',
    },
  };
}

async function begin(fixture: Fixture, service = serviceFor(fixture)) {
  const status = await service.begin(fixture.actor, {
    operationId: fixture.operationId,
    sourceGeneration: 0,
    profileId: PROFILE_ID,
    material: fixture.target.material as BeginInput['material'],
    protocolVersion: 1,
    acknowledgements: { localDraftsResolved: true, otherDeviceDraftLoss: true },
  });
  const token: Worker = {
    operationId: fixture.operationId,
    generation: 0,
    workerFence: status.workerFence,
  };
  return { service, status, token };
}

async function stageAndVerify(
  fixture: Fixture,
  prepared: Awaited<ReturnType<typeof begin>>,
  options: {
    skipVerify?: boolean;
    preStaged?: { kind: string; resourceId: string; replacementDigest: string }[];
  } = {},
) {
  const { service, token } = prepared;
  const page = await service.inventory(fixture.actor, token);
  expect(page.next).toBeNull();
  const items = page.items;
  const by = (kind: string, id: string) => {
    const item = items.find((candidate) => candidate.kind === kind && candidate.resourceId === id);
    if (!item) throw new Error(`missing ${kind}/${id}`);
    return item;
  };
  const payload = (value: (typeof items)[number]['source']) => {
    if (!value || !('alg' in value)) throw new Error('expected encrypted payload');
    return value;
  };
  const staged: { kind: string; resourceId: string; replacementDigest: string }[] = [];
  const preStaged = new Map((options.preStaged ?? []).map((item) => [`${item.kind}:${item.resourceId}`, item]));

  // The service deliberately requires every Seal body/version to follow its
  // newly staged wrapper. This also makes the resume path use the durable
  // wrapper rather than process-local NEK state.
  const sourceSeal = by('seal-wrapper', SEAL_ID).source;
  if (!sourceSeal || !('iv' in sourceSeal)) throw new Error('missing seal source wrapper');
  const targetWrapper = await createRotationSealWrapper(fixture.target.mek, SEAL_ID);
  const wrapper = await service.stage(
    fixture.actor,
    token,
    { kind: 'seal-wrapper', resourceId: SEAL_ID },
    targetWrapper,
    'wrapper-stage',
  );
  staged.push({ kind: 'seal-wrapper', resourceId: SEAL_ID, replacementDigest: wrapper.replacementDigest! });

  for (const item of items) {
    if (item.kind === 'seal-wrapper' || item.kind === 'file') continue;
    const existing = preStaged.get(`${item.kind}:${item.resourceId}`);
    if (existing) {
      staged.push(existing);
      continue;
    }
    let replacement = item.source;
    if (item.kind === 'secret') {
      replacement = await rotateBody(
        fixture.old.mek,
        fixture.target.mek,
        { kind: 'secret' },
        { kind: 'secret' },
        payload(item.source),
      );
    } else if (item.kind === 'secret-version') {
      replacement = await rotateBody(
        fixture.old.mek,
        fixture.target.mek,
        { kind: 'secret' },
        { kind: 'secret' },
        payload(item.source),
      );
    } else if (item.kind === 'seal' || item.kind === 'seal-version') {
      const sourceWrapper = by('seal-wrapper', SEAL_ID).source;
      if (!sourceWrapper || !('iv' in sourceWrapper)) throw new Error('missing source wrapper');
      replacement =
        item.source === null
          ? null
          : await rotateBody(
              fixture.old.mek,
              fixture.target.mek,
              {
                kind: 'seal',
                recordId: SEAL_ID,
                wrappedNoteKey: payload(sourceWrapper),
              },
              { kind: 'seal', recordId: SEAL_ID, wrappedNoteKey: targetWrapper },
              payload(item.source),
            );
    } else if (item.kind === 'auth') {
      replacement = await rotateAuth(
        fixture.old.mek,
        fixture.target.mek,
        item.resourceId,
        item.source === null ? null : payload(item.source),
      );
    }
    const result = await service.stage(
      fixture.actor,
      token,
      item,
      replacement,
      `stage-${item.kind}-${item.resourceId}`,
    );
    staged.push({ kind: item.kind, resourceId: item.resourceId, replacementDigest: result.replacementDigest! });
  }

  const rotatedFile = await rotateFile(fixture.old.mek, fixture.target.mek, fixture.sourceFile);
  const checksum = Buffer.from(new Uint8Array(32)).toString('base64');
  const reserved = await service.reserveFile(fixture.actor, token, ENCRYPTED_FILE_ID, {
    iv: rotatedFile.iv,
    bytes: rotatedFile.cipherBytes.byteLength,
    checksum,
  });
  fixture.storage.objects.get(reserved.object.key)!.body = new Uint8Array(rotatedFile.cipherBytes);
  const finalized = await service.finalizeFile(
    fixture.actor,
    token,
    ENCRYPTED_FILE_ID,
    reserved.object.key,
    'file-stage',
  );
  staged.push({ kind: 'file', resourceId: ENCRYPTED_FILE_ID, replacementDigest: finalized.replacementDigest! });

  if (!options.skipVerify) {
    for (const item of staged)
      await service.verify(
        fixture.actor,
        token,
        { kind: item.kind as never, resourceId: item.resourceId },
        item.replacementDigest,
      );
  }
  return { items, staged };
}

async function confirm(fixture: Fixture, prepared: Awaited<ReturnType<typeof begin>>) {
  const status = await prepared.service.status(fixture.actor, fixture.operationId);
  if (!status.operation?.inventoryDigest) throw new Error('missing inventory digest');
  return prepared.service.confirmRecovery(fixture.actor, prepared.token, {
    profileId: PROFILE_ID,
    generation: 1,
    inventoryDigest: status.operation.inventoryDigest,
    acknowledged: true,
  });
}

describe('rotation service against real PGlite migrations', () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb(db);
  });
  afterAll(teardownTestDb);

  it.each(['maxItems', 'maxSourceBytes'] as const)('rejects begin before materializing an over-%s inventory', async (bound) => {
    const fixture = await seedFixture(db);
    const limits = bound === 'maxItems' ? { maxItems: 7 } : { maxSourceBytes: 1 };
    await expect(begin(fixture, serviceFor(fixture, undefined, limits))).rejects.toMatchObject({ code: 'LIMIT' });
    await expect(
      db.select().from(encryptionRotations).where(eq(encryptionRotations.userId, USER_ID)),
    ).resolves.toHaveLength(0);
  });

  it('rotates a mixed vault atomically while preserving metadata, history order, tombstones, and files', async () => {
    const fixture = await seedFixture(db);
    const prepared = await begin(fixture);
    const before = await fixture.db
      .select({ secret: secretNotes, seal: sealNotes, auth: otpRecords, files: fileAttachments })
      .from(secretNotes)
      .leftJoin(sealNotes, eq(sealNotes.id, SEAL_ID))
      .leftJoin(otpRecords, eq(otpRecords.id, AUTH_ID))
      .leftJoin(fileAttachments, eq(fileAttachments.id, ENCRYPTED_FILE_ID));
    expect(before).toHaveLength(1);

    const staged = await stageAndVerify(fixture, prepared);
    expect(staged.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['secret', 'secret-version', 'seal-wrapper', 'seal', 'seal-version', 'auth', 'file']),
    );
    await confirm(fixture, prepared);
    const receipt = await prepared.service.commit(fixture.actor, prepared.token);
    expect(receipt.phase).toBe('committed');
    expect(receipt.targetGeneration).toBe(1);

    const [secret] = await db.select().from(secretNotes).where(eq(secretNotes.id, SECRET_ID));
    const [secretHistory] = await db
      .select()
      .from(secretNoteVersions)
      .where(eq(secretNoteVersions.id, SECRET_VERSION_ID));
    const [seal] = await db.select().from(sealNotes).where(eq(sealNotes.id, SEAL_ID));
    const [sealHistory] = await db.select().from(sealNoteVersions).where(eq(sealNoteVersions.id, SEAL_VERSION_ID));
    const authRows = await db.select().from(otpRecords).where(eq(otpRecords.userId, USER_ID));
    const files = await db.select().from(fileAttachments).where(eq(fileAttachments.userId, USER_ID));
    expect(secret).toMatchObject(fixture.metadata.secret);
    expect(seal).toMatchObject(fixture.metadata.seal);
    expect(secretHistory.seq).toBe(fixture.metadata.secretVersionSeq);
    expect(sealHistory.seq).toBe(fixture.metadata.sealVersionSeq);
    expect(authRows.find((row) => row.id === AUTH_TOMBSTONE_ID)).toMatchObject({
      payload: null,
      revision: fixture.metadata.tombstoneRevision + 1,
    });
    expect(files.find((row) => row.id === PLAIN_FILE_ID)?.s3Key).toBe(fixture.metadata.plainFileKey);
    expect(files.find((row) => row.id === ENCRYPTED_FILE_ID)?.s3Key).not.toBe('source/encrypted-file');

    await expect(decryptSecretBody(fixture.target.mek, secret.encryptedBody!)).resolves.toBe('secret body');
    await expect(decryptSecretBody(fixture.target.mek, secretHistory.encryptedBody!)).resolves.toBe('secret history');
    await expect(decryptSealBody(fixture.target.mek, seal.encryptedBody!, seal.wrappedNoteKey!, SEAL_ID)).resolves.toBe(
      'seal body',
    );
    await expect(
      decryptSealBody(fixture.target.mek, sealHistory.encryptedBody!, seal.wrappedNoteKey!, SEAL_ID),
    ).resolves.toBe('seal history');
    const auth = authRows.find((row) => row.id === AUTH_ID)!;
    await expect(
      decryptOtpRecord(await deriveOtpVaultKey(fixture.target.mek), AUTH_ID, auth.payload!),
    ).resolves.toEqual(expect.objectContaining({ issuer: 'Example', account: 'rotation@example.com' }));
    await expect(decryptSecretBody(fixture.old.mek, secret.encryptedBody!)).rejects.toThrow();
    const encryptedFile = files.find((row) => row.id === ENCRYPTED_FILE_ID)!;
    const replacement = [...fixture.storage.objects.values()].find((object) => object.key === encryptedFile.s3Key)!;
    const replacementBytes = replacement.body!.slice().buffer as ArrayBuffer;
    await expect(decryptFileBytes(fixture.target.mek, encryptedFile.encryptionIv!, replacementBytes)).resolves.toEqual(
      fixture.sourceFile.plain,
    );
    expect((await db.select().from(encryptionStates).where(eq(encryptionStates.userId, USER_ID)))[0]).toMatchObject({
      generation: 1,
      activeRotationId: null,
    });

    const [committed] = await db
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.id, fixture.operationId));
    expect(committed.reservedFileBytes).toBeGreaterThan(0);
    await prepared.service.cleanup();
    const [cleaned] = await db
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.id, fixture.operationId));
    expect(cleaned).toMatchObject({ phase: 'cleaned', reservedFileBytes: 0 });
    expect(fixture.storage.removed).toContain('source/encrypted-file');
  });

  it('requires wrapper-first staging, exact idempotency, complete verification, and recovery acknowledgement', async () => {
    const fixture = await seedFixture(db);
    const prepared = await begin(fixture);
    const page = await prepared.service.inventory(fixture.actor, prepared.token);
    const secretItem = page.items.find((item) => item.kind === 'secret')!;
    const replacement = await rotateBody(
      fixture.old.mek,
      fixture.target.mek,
      { kind: 'secret' },
      { kind: 'secret' },
      (() => {
        if (!secretItem.source || !('alg' in secretItem.source)) throw new Error('expected secret payload');
        return secretItem.source;
      })(),
    );
    await prepared.service.stage(fixture.actor, prepared.token, secretItem, replacement, 'same-stage-key');
    await expect(
      prepared.service.stage(
        fixture.actor,
        prepared.token,
        secretItem,
        await encryptSecretBody(fixture.target.mek, 'different'),
        'same-stage-key',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(prepared.service.commit(fixture.actor, prepared.token)).rejects.toMatchObject({
      code: 'RECOVERY_REQUIRED',
    });

    const sealItem = page.items.find((item) => item.kind === 'seal')!;
    await expect(
      prepared.service.stage(fixture.actor, prepared.token, sealItem, sealItem.source, 'seal-before-wrapper'),
    ).rejects.toMatchObject({ code: 'INCOMPLETE' });
    const [stagedSecret] = await db
      .select({ replacementDigest: rotationItems.replacementDigest })
      .from(rotationItems)
      .where(
        and(
          eq(rotationItems.operationId, fixture.operationId),
          eq(rotationItems.kind, 'secret'),
          eq(rotationItems.resourceId, SECRET_ID),
        ),
      );
    await stageAndVerify(fixture, prepared, {
      preStaged: [{ kind: 'secret', resourceId: SECRET_ID, replacementDigest: stagedSecret.replacementDigest! }],
    });
    await expect(prepared.service.commit(fixture.actor, prepared.token)).rejects.toMatchObject({
      code: 'RECOVERY_REQUIRED',
    });
    await confirm(fixture, prepared);
    await expect(prepared.service.commit(fixture.actor, prepared.token)).resolves.toMatchObject({ phase: 'committed' });
  });

  it('isolates operation ownership and rejects source changes before activation', async () => {
    const fixture = await seedFixture(db);
    const prepared = await begin(fixture);
    await expect(prepared.service.status(fixture.otherActor, fixture.operationId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(prepared.service.inventory(fixture.otherActor, prepared.token)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await stageAndVerify(fixture, prepared);
    await confirm(fixture, prepared);
    await db.update(secretNotes).set({ title: 'changed while staged' }).where(eq(secretNotes.id, SECRET_ID));
    await expect(prepared.service.commit(fixture.actor, prepared.token)).rejects.toMatchObject({
      code: 'SOURCE_CHANGED',
    });
    const [stillOld] = await db.select().from(encryptionProfiles).where(eq(encryptionProfiles.id, PROFILE_ID));
    expect(stillOld.serverShare).toBe(fixture.old.material.serverShare);
  });

  it.each([
    'secret',
    'secret-version',
    'seal',
    'seal-version',
    'seal-wrapper',
    'auth',
    'files',
    'profile',
    'cleanup',
    'receipt',
  ] as const)('rolls back the complete activation when checkpoint %s fails', async (failedStep) => {
    const fixture = await seedFixture(db);
    const prepared = await begin(fixture);
    await stageAndVerify(fixture, prepared);
    await confirm(fixture, prepared);
    const failing = serviceFor(fixture, (step) => {
      if (step === failedStep) throw new Error('injected checkpoint');
    });
    await expect(failing.commit(fixture.actor, prepared.token)).rejects.toThrow('injected checkpoint');
    const [state] = await db.select().from(encryptionStates).where(eq(encryptionStates.userId, USER_ID));
    const [profile] = await db.select().from(encryptionProfiles).where(eq(encryptionProfiles.id, PROFILE_ID));
    const [operation] = await db
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.id, fixture.operationId));
    expect(state).toMatchObject({ generation: 0, activeRotationId: fixture.operationId });
    expect(profile.serverShare).toBe(fixture.old.material.serverShare);
    expect(operation.phase).toBe('ready');
    await expect(serviceFor(fixture).commit(fixture.actor, prepared.token)).resolves.toMatchObject({
      phase: 'committed',
    });
  });

  it('returns the durable receipt on repeated commit and rejects a late cancel', async () => {
    const fixture = await seedFixture(db);
    const prepared = await begin(fixture);
    await stageAndVerify(fixture, prepared);
    await confirm(fixture, prepared);
    const first = await prepared.service.commit(fixture.actor, prepared.token);
    const second = await prepared.service.commit(fixture.actor, prepared.token);
    expect(second).toMatchObject({ operationId: first.operationId, phase: 'committed' });
    await expect(prepared.service.cancel(fixture.actor, prepared.token)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('holds a cancelled file reservation until cleanup before admitting another reservation', async () => {
    const fixture = await seedFixture(db);
    const rotated = await rotateFile(fixture.old.mek, fixture.target.mek, fixture.sourceFile);
    const input = {
      iv: rotated.iv,
      bytes: rotated.cipherBytes.byteLength,
      checksum: Buffer.from(new Uint8Array(32)).toString('base64'),
    };
    const service = serviceFor(fixture, undefined, { maxTemporaryFileBytes: input.bytes });
    const first = await begin(fixture, service);
    const firstGrant = await service.reserveFile(fixture.actor, first.token, ENCRYPTED_FILE_ID, input);
    await service.cancel(fixture.actor, first.token);
    const [cancelled] = await db
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.id, first.token.operationId));
    expect(cancelled.reservedFileBytes).toBe(input.bytes);

    fixture.operationId = crypto.randomUUID();
    const second = await begin(fixture, service);
    await expect(service.reserveFile(fixture.actor, second.token, ENCRYPTED_FILE_ID, input)).rejects.toMatchObject({
      code: 'LIMIT',
    });

    fixture.now.value = new Date(firstGrant.expiresAt.getTime() + 1);
    await service.cleanup();
    const [released] = await db
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.id, first.token.operationId));
    expect(released.reservedFileBytes).toBe(0);
    expect(fixture.storage.removed).toContain(firstGrant.object.key);

    const [firstTombstone] = await db
      .select()
      .from(rotationCleanup)
      .where(eq(rotationCleanup.objectKey, firstGrant.object.key));
    expect(firstTombstone.completedAt).not.toBeNull();
    const completedAt = firstTombstone.completedAt!.getTime();
    // A PUT that started before the grant expired can recreate the key after
    // the first delete. The completed cleanup row must remain a daily sweep.
    fixture.storage.objects.set(firstGrant.object.key, {
      ...firstGrant.object,
      body: new Uint8Array(input.bytes),
    });
    await db
      .update(authSessions)
      .set({ expiresAt: new Date('2026-10-01T12:00:00.000Z') })
      .where(eq(authSessions.id, SID));
    fixture.now.value = new Date(firstTombstone.notBefore.getTime() + 1);
    await service.cleanup();
    const [secondTombstone] = await db
      .select()
      .from(rotationCleanup)
      .where(eq(rotationCleanup.objectKey, firstGrant.object.key));
    expect(secondTombstone.completedAt!.getTime()).toBe(completedAt);
    expect(released.reservedFileBytes).toBe(0);
    expect(fixture.storage.removed.filter((key) => key === firstGrant.object.key)).toHaveLength(2);
    expect(fixture.storage.objects.has(firstGrant.object.key)).toBe(false);
    await expect(service.reserveFile(fixture.actor, second.token, ENCRYPTED_FILE_ID, input)).resolves.toBeDefined();
  });

  it('pauses stale workers, advances the fence on claim, and expires unfinished work', async () => {
    const fixture = await seedFixture(db);
    const prepared = await begin(fixture);
    await prepared.service.pause(fixture.actor, prepared.token, true);
    await expect(prepared.service.inventory(fixture.actor, prepared.token)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      prepared.service.stage(fixture.actor, prepared.token, { kind: 'secret', resourceId: SECRET_ID }, null, 'paused'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const claimed = await prepared.service.claim(fixture.actor, fixture.operationId, prepared.status.workerFence);
    const claimedToken: Worker = {
      operationId: fixture.operationId,
      generation: 0,
      workerFence: claimed.workerFence,
    };
    await expect(
      prepared.service.stage(fixture.actor, prepared.token, { kind: 'secret', resourceId: SECRET_ID }, null, 'stale'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    fixture.now.value = new Date('2026-09-18T12:00:01.000Z');
    await expect(prepared.service.status(fixture.actor, fixture.operationId)).resolves.toMatchObject({
      operation: { phase: 'aborted' },
    });
    await expect(
      prepared.service.stage(fixture.actor, claimedToken, { kind: 'secret', resourceId: SECRET_ID }, null, 'expired'),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('does not delete an object that is still an active file reference during cleanup', async () => {
    const fixture = await seedFixture(db);
    const prepared = await begin(fixture);
    await stageAndVerify(fixture, prepared);
    await confirm(fixture, prepared);
    await prepared.service.commit(fixture.actor, prepared.token);
    const [encryptedFile] = await db.select().from(fileAttachments).where(eq(fileAttachments.id, ENCRYPTED_FILE_ID));
    await db.insert(rotationCleanup).values({
      operationId: fixture.operationId,
      userId: USER_ID,
      objectKey: encryptedFile.s3Key,
      notBefore: fixture.now.value,
    });
    await serviceFor(fixture).cleanup();
    expect(fixture.storage.removed).not.toContain(encryptedFile.s3Key);
  });
});
