/** Real signed-transfer integration tests on the isolated Docker MinIO only. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createRotationObjectStore, type RotationObject } from '../src/server/rotation/objectStore';
import { ensureRotationBucket, localRotationS3, rotationTestBucket } from '../tests/rotation/localResources';

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
    for (const header of ['content-length', 'if-none-match', 'x-amz-checksum-sha256'])
      assert(signedHeaders.includes(header));
    const start = performance.now();
    const put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(body) });
    assert.equal(put.status, 200, 'signed PUT');
    const repeat = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(body) });
    assert.equal(repeat.status, 412, 'old grant cannot overwrite accepted bytes');
    await store.verify(object);
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
    observations.push({
      bytes,
      uploadAndReadbackMs: performance.now() - start,
      overwriteStatus: repeat.status,
      tamperedHeaderStatus: altered.status,
    });
  }
  const body = randomBytes(32);
  const object = store.allocate(randomUUID(), body.length, createHash('sha256').update(body).digest('base64'));
  objects.push(object);
  const grant = await store.uploadGrant(object, 1);
  const corrupt = new Uint8Array(body);
  corrupt[0] ^= 1;
  const mismatch = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: corrupt });
  assert.equal(mismatch.status, 400, 'provider must validate checksum');
  const changedSize = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(33) });
  assert.equal(changedSize.status, 403, 'signed length must match body');
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const expired = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(body) });
  assert.equal(expired.status, 403, 'expired grants cannot create data');
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: rotationTestBucket, Key: object.key })));
  const cors = await fetch(`http://127.0.0.1:9100/${rotationTestBucket}/cors-probe`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5000',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'if-none-match,x-amz-checksum-sha256,content-type',
    },
  });
  assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5000');
  observations.push({
    checksumMismatchStatus: mismatch.status,
    wrongLengthStatus: changedSize.status,
    expiredGrantStatus: expired.status,
    browserOriginCors: true,
  });
  if (process.argv.includes('--restart')) {
    // These accepted objects must survive loss of the MinIO process. The
    // service is dedicated to this suite, with data on its own Docker volume.
    await promisify(execFile)('docker', ['compose', '--profile', 'rotation', 'restart', 'rotation-minio']);
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
      scope: 'isolated local MinIO, not production-provider qualification',
      generatedAt: new Date().toISOString(),
      observations,
    },
    null,
    2,
  ) + '\n',
);
