/**
 * Real signed-transfer integration tests against the isolated Docker MinIO —
 * or, with `ROTATION_TEST_S3_*` set, against a throwaway bucket on a real
 * provider, which is the only way to learn whether that provider honours the
 * conditional create and signed-length binding the adapter depends on.
 *
 * It does NOT require a provider checksum. The adapter deliberately asks for
 * none, because R2 has no full-object SHA-256 for a single `PutObject`; the
 * checksum is proven by `verify` reading the accepted bytes back instead.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createRotationObjectStore, type RotationObject } from '../../src/server/rotation/objectStore';
import {
  ensureRotationBucket,
  localRotationS3,
  remoteRotationStore,
  rotationStoreEndpoint,
  rotationTestBucket,
} from './localResources';

/** The browser origin the bucket's CORS policy must admit. */
const appOrigin = process.env.ROTATION_TEST_APP_ORIGIN ?? 'http://localhost:5000';

const client = localRotationS3();
const store = createRotationObjectStore(client, rotationTestBucket);
const objects: RotationObject[] = [];
const observations: Record<string, unknown>[] = [];
await ensureRotationBucket(client);
try {
  for (const bytes of [16, 1024, 5 * 1024 * 1024]) {
    const body = randomBytes(bytes);
    const checksum = createHash('sha256').update(body).digest('base64');
    const object = store.allocate(randomUUID(), bytes, checksum);
    objects.push(object);
    const grant = await store.uploadGrant(object, 2);
    const signedHeaders = new URL(grant.url).searchParams.get('X-Amz-SignedHeaders')!.split(';');
    for (const header of ['content-length', 'if-none-match']) assert(signedHeaders.includes(header));
    // Not signed and not sent: no provider is asked to validate a full-object
    // SHA-256, because R2 has none for a single `PutObject`.
    assert(!signedHeaders.includes('x-amz-checksum-sha256'), 'grant must not bind a provider checksum');
    assert(!('x-amz-checksum-sha256' in grant.headers));
    const start = performance.now();
    const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(body) });
    assert.equal(put.status, 200, 'signed PUT');
    const repeat = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(body) });
    assert.equal(repeat.status, 412, 'old grant cannot overwrite accepted bytes');
    const { etag } = await store.verify(object);
    assert(etag.length > 0 && !etag.includes('"'), 'verify must report a normalized entity tag');
    const read = await fetch(await store.readGrant(object, 30), { cache: 'no-store' });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), body);
    const altered = await fetch(grant.url, {
      method: 'PUT',
      headers: { ...grant.headers, 'if-none-match': '' },
      body: new Uint8Array(body),
    });
    assert.notEqual(altered.status, 200, 'cannot remove signed conditional header');
    await assert.rejects(store.verify({ ...object, bytes: bytes + 1 }));
    // Commit re-identifies the object by length and the entity tag `verify`
    // recorded, rather than paying for a second streamed re-hash. It is an
    // identity check on bytes that conditional create has already frozen.
    await store.verifyMetadata({ ...object, etag });
    await assert.rejects(store.verifyMetadata({ ...object, etag, bytes: bytes + 1 }));
    await assert.rejects(store.verifyMetadata({ ...object, etag: 'not-the-stored-tag' }));
    await assert.rejects(
      store.verifyMetadata({ ...object, etag: '' }),
      'a receipt with no tag cannot be re-identified',
    );
    observations.push({
      bytes,
      uploadAndReadbackMs: performance.now() - start,
      overwriteStatus: repeat.status,
      tamperedHeaderStatus: altered.status,
      etagReported: true,
    });
  }
  // Each of the three negative cases gets its own key, because a corrupt body
  // is now *accepted* by the provider and would poison a shared one.
  const body = randomBytes(32);
  const digestOf = (value: Uint8Array) => createHash('sha256').update(value).digest('base64');

  // 1. Same length, wrong bytes. Nothing at the provider is in a position to
  // notice, so the read-back in `verify` is what has to — and the key is then
  // unusable, which is exactly why the service retires it and reserves a new one.
  const corruptTarget = store.allocate(randomUUID(), body.length, digestOf(body));
  objects.push(corruptTarget);
  const corruptGrant = await store.uploadGrant(corruptTarget, 60);
  const corrupt = new Uint8Array(body);
  corrupt[0] ^= 1;
  const corruptPut = await fetch(corruptGrant.url, { method: 'PUT', headers: corruptGrant.headers, body: corrupt });
  assert.equal(corruptPut.status, 200, 'provider accepts a body it was never given a checksum for');
  await assert.rejects(store.verify(corruptTarget), 'read-back must reject bytes the client did not declare');
  assert.equal(
    (await fetch(corruptGrant.url, { method: 'PUT', headers: corruptGrant.headers, body: new Uint8Array(body) }))
      .status,
    412,
    'a poisoned key cannot be repaired by re-uploading, so it must be retired',
  );

  // 2. A body whose length is not the one the grant was signed for.
  const lengthTarget = store.allocate(randomUUID(), body.length, digestOf(body));
  objects.push(lengthTarget);
  const lengthGrant = await store.uploadGrant(lengthTarget, 60);
  const changedSize = await fetch(lengthGrant.url, {
    method: 'PUT',
    headers: lengthGrant.headers,
    body: new Uint8Array(33),
  });
  assert.equal(changedSize.status, 403, 'signed length must match body');

  // 3. An expired grant creates nothing.
  const expiringTarget = store.allocate(randomUUID(), body.length, digestOf(body));
  objects.push(expiringTarget);
  const expiringGrant = await store.uploadGrant(expiringTarget, 1);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const expired = await fetch(expiringGrant.url, {
    method: 'PUT',
    headers: expiringGrant.headers,
    body: new Uint8Array(body),
  });
  assert.equal(expired.status, 403, 'expired grants cannot create data');
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: rotationTestBucket, Key: expiringTarget.key })));
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: rotationTestBucket, Key: lengthTarget.key })));
  const cors = await fetch(`${rotationStoreEndpoint}/${rotationTestBucket}/cors-probe`, {
    method: 'OPTIONS',
    headers: {
      Origin: appOrigin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'if-none-match,content-type',
    },
  });
  assert.equal(cors.headers.get('access-control-allow-origin'), appOrigin, `bucket CORS must admit ${appOrigin}`);
  observations.push({
    corruptBodyAcceptedByProvider: corruptPut.status,
    corruptBodyRejectedByReadBack: true,
    poisonedKeyReuseStatus: 412,
    wrongLengthStatus: changedSize.status,
    expiredGrantStatus: expired.status,
    browserOriginCors: true,
  });
  if (process.argv.includes('--restart') && !remoteRotationStore) {
    // These accepted objects must survive loss of the MinIO process. The
    // store is shared with local development; only the test bucket is isolated.
    await promisify(execFile)('docker', ['compose', 'restart', 'minio']);
    const deadline = Date.now() + 30_000;
    while (true) {
      const ready = await fetch('http://127.0.0.1:9100/minio/health/live').catch(() => null);
      if (ready?.ok) break;
      assert(Date.now() < deadline, 'MinIO failed to become ready after restart');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const accepted of objects.slice(0, 3)) await store.verify(accepted);
    observations.push({ processRestartPreservedAcceptedObjects: true });
  }
} finally {
  // Test-only cleanup follows grant expiry, so a delayed PUT cannot resurrect data.
  await new Promise((resolve) => setTimeout(resolve, 2200));
  try {
    for (const object of objects) await store.remove(object);
  } finally {
    client.destroy();
  }
}
const verifyClient = localRotationS3();
try {
  const listed = await verifyClient.send(new ListObjectsV2Command({ Bucket: rotationTestBucket, Prefix: 'rotation/' }));
  assert(!listed.Contents?.some((item) => objects.some((object) => object.key === item.Key)), 'owned objects cleaned');
} finally {
  verifyClient.destroy();
}
process.stdout.write(
  JSON.stringify(
    {
      scope: remoteRotationStore
        ? `signed transfers against ${rotationStoreEndpoint} bucket ${rotationTestBucket}`
        : 'isolated local MinIO, not production-provider qualification',
      generatedAt: new Date().toISOString(),
      observations,
    },
    null,
    2,
  ) + '\n',
);
