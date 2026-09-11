/** Full backend against owned Docker PostgreSQL + MinIO. No ambient URLs. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { setDb, type Db } from '../src/db/client';
import * as schema from '../src/db/schema';
import { withVaultWrite, withRequestGeneration } from '../src/db/encryptionState';
import { jsonBytes, materialSchema } from '../src/server/rotation/contracts';
import { createRotationService } from '../src/server/rotation/service';
import { createRotationObjectStore } from '../src/server/rotation/objectStore';
import { createRotationMaterial, rotateBody, rotateFile } from '../src/lib/rotation/crypto';
import { encryptSecretBody, decryptSecretBody, encryptFileBytes, decryptFileBytes } from '../src/lib/crypto';
import {
  createLocalRotationDatabase,
  ensureRotationBucket,
  localRotationS3,
  rotationTestBucket,
} from '../tests/rotation/localResources';

const database = await createLocalRotationDatabase();
const client = postgres(database.url, { max: 5, prepare: false, onnotice: () => {} });
const db = drizzle(client, { schema });
const s3 = localRotationS3();
const ownedKeys = new Set<string>();
const results: Record<string, unknown> = {};
const started = performance.now();
try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  setDb(db as unknown as Db);
  await ensureRotationBucket(s3);
  const storage = createRotationObjectStore(s3, rotationTestBucket);
  const service = createRotationService({ storage, enabled: true, limits: { grantSeconds: 1 } });
  const old = await createRotationMaterial('local old passphrase');
  const target = await createRotationMaterial('local replacement passphrase');
  const userId = randomUUID();
  const sid = randomUUID();
  const profileId = randomUUID();
  const actor = { userId, sid };
  await db.insert(schema.users).values({ id: userId, displayName: 'Local fixture' });
  await db
    .insert(schema.authSessions)
    .values({ id: sid, userId, provider: 'siwe', client: 'web', expiresAt: new Date(Date.now() + 3600_000) });
  await db
    .insert(schema.encryptionStates)
    .values({ userId, sessionEpoch: 1, survivingSid: sid, rotationSessionSid: sid });
  await db.insert(schema.encryptionProfiles).values({ id: profileId, userId, ...old.material });
  const fileId = randomUUID();
  const sourceKey = `local-integration/${randomUUID()}`;
  ownedKeys.add(sourceKey);
  const filePlain = new Uint8Array(5 * 1024 * 1024 - 16).fill(37);
  const sourceFile = await encryptFileBytes(old.mek, filePlain);
  await s3.send(
    new PutObjectCommand({ Bucket: rotationTestBucket, Key: sourceKey, Body: new Uint8Array(sourceFile.cipherBytes) }),
  );
  await db.insert(schema.fileAttachments).values({
    id: fileId,
    userId,
    s3Key: sourceKey,
    filename: 'fixture.bin',
    size: sourceFile.cipherBytes.byteLength,
    mimeType: 'application/octet-stream',
    encrypted: true,
    encryptionIv: sourceFile.iv,
  });
  const extraFiles: string[] = [];
  for (let index = 1; index < 20; index++) {
    const id = randomUUID();
    const key = `local-integration/${randomUUID()}`;
    ownedKeys.add(key);
    await s3.send(
      new PutObjectCommand({ Bucket: rotationTestBucket, Key: key, Body: new Uint8Array(sourceFile.cipherBytes) }),
    );
    await db
      .insert(schema.fileAttachments)
      .values({
        id,
        userId,
        s3Key: key,
        filename: 'fixture.bin',
        size: sourceFile.cipherBytes.byteLength,
        mimeType: 'application/octet-stream',
        encrypted: true,
        encryptionIv: sourceFile.iv,
      });
    extraFiles.push(id);
  }
  // 480 bodies + twenty maximum files: exercise 500 items and 100 MiB files, ~32MB
  // serialized source budget, including incompressible encrypted text.
  const plain = 'native integration body '.padEnd(48_000, 'x');
  const rows: (typeof schema.secretNotes.$inferInsert)[] = [];
  for (let index = 0; index < 480; index++)
    rows.push({
      id: randomUUID(),
      userId,
      position: index,
      title: `fixture-${index}`,
      encryptedBody: await encryptSecretBody(old.mek, `${plain}${index}`),
    });
  for (let start = 0; start < rows.length; start += 20)
    await db.insert(schema.secretNotes).values(rows.slice(start, start + 20));

  // A real writer already holding the same account lock must finish before begin.
  let release!: () => void;
  let locked!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const writer = withVaultWrite(userId, async () => {
    locked();
    await barrier;
    const { getDb } = await import('../src/db/client');
    await getDb()
      .update(schema.secretNotes)
      .set({ title: 'writer-before-begin' })
      .where(eq(schema.secretNotes.id, rows[0].id!));
  });
  await Promise.race([acquired, writer]);
  const beginAt = performance.now();
  const beginning = service.begin(actor, {
    operationId: randomUUID(),
    sourceGeneration: 0,
    profileId,
    material: materialSchema.parse(target.material),
    protocolVersion: 1,
    acknowledgements: { localDraftsResolved: true, otherDeviceDraftLoss: true },
  });
  release();
  await writer;
  const operation = await beginning;
  results.beginMs = performance.now() - beginAt;
  results.sourceBytes = operation.sourceBytes;
  assert.equal(operation.itemCount, 500);
  const token = { operationId: operation.operationId, generation: 0, workerFence: operation.workerFence };
  await assert.rejects(
    withVaultWrite(userId, async () => {}),
    { code: 'ROTATION_IN_PROGRESS' },
  );
  results.realWriterSerializedBeforeBegin = true;
  const stageAt = performance.now();
  let cursor: { kind: schema.RotationKind; resourceId: string } | undefined;
  let pages = 0;
  do {
    const page = await service.inventory(actor, token, cursor);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 3_000_000);
    pages++;
    for (const item of page.items) {
      if (item.kind === 'file') continue;
      assert.ok(item.source && 'ciphertext' in item.source);
      const replacement = await rotateBody(old.mek, target.mek, { kind: 'secret' }, { kind: 'secret' }, item.source);
      const stage = await service.stage(actor, token, item, replacement, item.resourceId);
      await service.verify(actor, token, item, stage.replacementDigest!);
    }
    cursor = page.next ?? undefined;
  } while (cursor);
  results.stageMs = performance.now() - stageAt;
  results.pages = pages;
  const rotated = await rotateFile(old.mek, target.mek, sourceFile);
  const checksum = createHash('sha256').update(new Uint8Array(rotated.cipherBytes)).digest('base64');
  const reserved = await service.reserveFile(actor, token, fileId, {
    iv: rotated.iv,
    bytes: rotated.cipherBytes.byteLength,
    checksum,
  });
  ownedKeys.add(reserved.object.key);
  const put = await fetch(reserved.grant.url, {
    method: 'PUT',
    headers: reserved.grant.headers,
    body: rotated.cipherBytes,
  });
  assert.equal(put.status, 200);
  const finalized = await service.finalizeFile(actor, token, fileId, reserved.object.key, 'file-stage');
  const read = await service.stagedFile(actor, token, fileId);
  const response = await fetch(read.url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(await decryptFileBytes(target.mek, read.iv, await response.arrayBuffer()), filePlain);
  await service.verify(actor, token, { kind: 'file', resourceId: fileId }, finalized.replacementDigest!);
  for (const id of extraFiles) {
    const next = await rotateFile(old.mek, target.mek, sourceFile);
    const reservation = await service.reserveFile(actor, token, id, {
      iv: next.iv,
      bytes: next.cipherBytes.byteLength,
      checksum: createHash('sha256').update(new Uint8Array(next.cipherBytes)).digest('base64'),
    });
    ownedKeys.add(reservation.object.key);
    assert.equal(
      (
        await fetch(reservation.grant.url, {
          method: 'PUT',
          headers: reservation.grant.headers,
          body: next.cipherBytes,
        })
      ).status,
      200,
    );
    const item = await service.finalizeFile(actor, token, id, reservation.object.key, id);
    const readBack = await service.stagedFile(actor, token, id);
    const downloaded = await fetch(readBack.url);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(await decryptFileBytes(target.mek, readBack.iv, await downloaded.arrayBuffer()), filePlain);
    await service.verify(actor, token, { kind: 'file', resourceId: id }, item.replacementDigest!);
  }
  results.totalFileBytes = operation.fileBytes;
  await service.confirmRecovery(actor, token, {
    profileId,
    generation: 1,
    inventoryDigest: operation.inventoryDigest,
    acknowledged: true,
  });
  const commitAt = performance.now();
  const [receipt, retry] = await Promise.all([service.commit(actor, token), service.commit(actor, token)]);
  results.commitMs = performance.now() - commitAt;
  assert.equal(receipt.phase, 'committed');
  assert.equal(retry.targetGeneration, 1);
  const [head] = await db.select().from(schema.secretNotes).where(eq(schema.secretNotes.id, rows[0].id!));
  assert.equal(head.title, 'writer-before-begin');
  assert.equal(await decryptSecretBody(target.mek, head.encryptedBody!), `${plain}0`);
  await assert.rejects(decryptSecretBody(old.mek, head.encryptedBody!));
  await assert.rejects(
    withVaultWrite(userId, async () => {}),
    { code: 'GENERATION_MISMATCH' },
  );
  await withRequestGeneration('1', () => withVaultWrite(userId, async () => {}));
  assert.equal((await service.cleanup()).removed, 20);
  await assert.rejects(
    s3.send(new HeadObjectCommand({ Bucket: rotationTestBucket, Key: sourceKey })),
    (error) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404,
  );
  assert.equal((await service.commit(actor, token)).phase, 'cleaned');
  await s3.send(new HeadObjectCommand({ Bucket: rotationTestBucket, Key: reserved.object.key }));
  results.maxFileBytes = filePlain.length + 16;
  results.concurrentCommitDurableReceipt = true;
  results.oldGenerationRejected = true;
  results.cleanupPreservedActiveReplacement = true;
  // Real independent connections race bounded stages and terminal transitions.
  const raceUser = randomUUID();
  const raceSid = randomUUID();
  const raceProfile = randomUUID();
  const raceActor = { userId: raceUser, sid: raceSid };
  await db.insert(schema.users).values({ id: raceUser, displayName: 'Race fixture' });
  await db.insert(schema.authSessions).values({
    id: raceSid,
    userId: raceUser,
    provider: 'siwe',
    client: 'web',
    expiresAt: new Date(Date.now() + 3600_000),
  });
  await db
    .insert(schema.encryptionStates)
    .values({ userId: raceUser, sessionEpoch: 1, survivingSid: raceSid, rotationSessionSid: raceSid });
  await db.insert(schema.encryptionProfiles).values({ id: raceProfile, userId: raceUser, ...old.material });
  const tinySource = await encryptSecretBody(old.mek, 'race');
  const tinyTarget = await encryptSecretBody(target.mek, 'race');
  const tinyIds = [randomUUID(), randomUUID()];
  await db
    .insert(schema.secretNotes)
    .values(tinyIds.map((id, position) => ({ id, userId: raceUser, position, encryptedBody: tinySource })));
  const bounded = createRotationService({ storage, enabled: true, limits: { maxStagedBytes: jsonBytes(tinyTarget) } });
  const startRace = () =>
    bounded.begin(raceActor, {
      operationId: randomUUID(),
      sourceGeneration: 0,
      profileId: raceProfile,
      material: materialSchema.parse(target.material),
      protocolVersion: 1,
      acknowledgements: { localDraftsResolved: true, otherDeviceDraftLoss: true },
    });
  let racing = await startRace();
  let raceToken = { operationId: racing.operationId, generation: 0, workerFence: racing.workerFence };
  const concurrent = await Promise.allSettled(
    tinyIds.map((resourceId) =>
      bounded.stage(raceActor, raceToken, { kind: 'secret', resourceId }, tinyTarget, resourceId),
    ),
  );
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected' && result.reason.code === 'LIMIT').length, 1);
  results.concurrentStageBudgetSerialized = true;
  const claims = await Promise.all([
    bounded.claim(raceActor, racing.operationId, 1),
    bounded.claim(raceActor, racing.operationId, 1),
  ]);
  assert.equal(claims[0].workerFence, 2);
  assert.equal(claims[1].workerFence, 2);
  await assert.rejects(
    bounded.stage(raceActor, raceToken, { kind: 'secret', resourceId: tinyIds[0] }, tinyTarget, 'stale'),
    { code: 'CONFLICT' },
  );
  raceToken = { ...raceToken, workerFence: 2 };
  await bounded.cancel(raceActor, raceToken);
  results.concurrentClaimIsIdempotent = true;
  // Cancellation and commit start together: one complete generation wins.
  const raceService = createRotationService({ storage, enabled: true });
  racing = await startRace();
  raceToken = { operationId: racing.operationId, generation: 0, workerFence: racing.workerFence };
  for (const resourceId of tinyIds) {
    const item = await raceService.stage(raceActor, raceToken, { kind: 'secret', resourceId }, tinyTarget, resourceId);
    await raceService.verify(raceActor, raceToken, { kind: 'secret', resourceId }, item.replacementDigest!);
  }
  await raceService.confirmRecovery(raceActor, raceToken, {
    profileId: raceProfile,
    generation: 1,
    inventoryDigest: racing.inventoryDigest,
    acknowledged: true,
  });
  await Promise.allSettled([
    raceService.commit(raceActor, raceToken),
    raceService.cancel(raceActor, raceToken),
    raceService.cleanup(),
  ]);
  const raceState = await raceService.status(raceActor, racing.operationId);
  assert.ok(['committed', 'cleaned', 'aborted'].includes(raceState.operation!.phase));
  const expected = raceState.operation!.phase === 'aborted' ? old.mek : target.mek;
  for (const head of await db.select().from(schema.secretNotes).where(eq(schema.secretNotes.userId, raceUser)))
    assert.equal(await decryptSecretBody(expected, head.encryptedBody!), 'race');
  results.commitCancelCleanupRaceAtomic = true;
  const cancelledFileId = randomUUID();
  const cancelledSource = `local-integration/${randomUUID()}`;
  ownedKeys.add(cancelledSource);
  const tinyFile = await encryptFileBytes(expected, new Uint8Array([1, 2, 3]));
  await s3.send(
    new PutObjectCommand({
      Bucket: rotationTestBucket,
      Key: cancelledSource,
      Body: new Uint8Array(tinyFile.cipherBytes),
    }),
  );
  await db.insert(schema.fileAttachments).values({
    id: cancelledFileId,
    userId: raceUser,
    s3Key: cancelledSource,
    filename: 'cancel.bin',
    size: tinyFile.cipherBytes.byteLength,
    mimeType: 'application/octet-stream',
    encrypted: true,
    encryptionIv: tinyFile.iv,
  });
  let clock = new Date();
  const cancellation = createRotationService({ storage, enabled: true, now: () => clock, limits: { grantSeconds: 1 } });
  const pendingMaterial = raceState.generation === 0 ? target : old;
  const cancellable = await cancellation.begin(raceActor, {
    operationId: randomUUID(),
    sourceGeneration: raceState.generation,
    profileId: raceProfile,
    material: materialSchema.parse(pendingMaterial.material),
    protocolVersion: 1,
    acknowledgements: { localDraftsResolved: true, otherDeviceDraftLoss: true },
  });
  const cancellationToken = {
    operationId: cancellable.operationId,
    generation: raceState.generation,
    workerFence: cancellable.workerFence,
  };
  const pendingFile = await rotateFile(expected, pendingMaterial.mek, tinyFile);
  const cancelledGrant = await cancellation.reserveFile(raceActor, cancellationToken, cancelledFileId, {
    iv: pendingFile.iv,
    bytes: pendingFile.cipherBytes.byteLength,
    checksum: createHash('sha256').update(new Uint8Array(pendingFile.cipherBytes)).digest('base64'),
  });
  ownedKeys.add(cancelledGrant.object.key);
  await cancellation.cancel(raceActor, cancellationToken);
  assert.equal(
    (
      await fetch(cancelledGrant.grant.url, {
        method: 'PUT',
        headers: cancelledGrant.grant.headers,
        body: pendingFile.cipherBytes,
      })
    ).status,
    200,
  );
  await cancellation.cleanup();
  await s3.send(new HeadObjectCommand({ Bucket: rotationTestBucket, Key: cancelledGrant.object.key }));
  await assert.rejects(
    cancellation.finalizeFile(raceActor, cancellationToken, cancelledFileId, cancelledGrant.object.key, 'late'),
    { code: 'CONFLICT' },
  );
  await new Promise((resolve) => setTimeout(resolve, 2100));
  clock = new Date(clock.getTime() + 120_000);
  await cancellation.cleanup();
  await assert.rejects(
    s3.send(new HeadObjectCommand({ Bucket: rotationTestBucket, Key: cancelledGrant.object.key })),
    (error) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404,
  );
  assert.equal(
    (
      await fetch(cancelledGrant.grant.url, {
        method: 'PUT',
        headers: cancelledGrant.grant.headers,
        body: pendingFile.cipherBytes,
      })
    ).status,
    403,
  );
  await s3.send(new HeadObjectCommand({ Bucket: rotationTestBucket, Key: cancelledSource }));
  results.cancelledDelayedPutReclaimedAfterGrantExpiry = true;
  results.elapsedMs = performance.now() - started;
  results.rssBytes = process.memoryUsage().rss;
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scope: 'Full backend; owned local PostgreSQL + MinIO; no production-provider qualification',
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  // One-second test-only PUT grants are expired before removing their keys.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  for (const key of ownedKeys) await s3.send(new DeleteObjectCommand({ Bucket: rotationTestBucket, Key: key }));
  s3.destroy();
  setDb(undefined);
  await client.end();
  await database.stop();
}
