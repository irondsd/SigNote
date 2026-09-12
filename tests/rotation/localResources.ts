/**
 * Explicit test resources. Never reads the app's `DATABASE_URL`/`AWS_*` env.
 *
 * The object store defaults to the loopback MinIO from `docker-compose.yml`.
 * To qualify a *real* provider — the one check MinIO cannot stand in for —
 * point the storage suite at a throwaway bucket there with the
 * `ROTATION_TEST_S3_*` variables below. They are deliberately not the `AWS_*`
 * names the app reads, so an exported production environment can never aim a
 * test at the bucket that holds real attachments; and a remote bucket must
 * already exist — the helper creates buckets only on the local store.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

const remoteEndpoint = process.env.ROTATION_TEST_S3_ENDPOINT;
/** True when the suite targets a provider other than the loopback MinIO. */
export const remoteRotationStore = Boolean(remoteEndpoint);
export const rotationStoreEndpoint = remoteEndpoint ?? 'http://127.0.0.1:9100';
export const rotationTestBucket = remoteRotationStore
  ? (process.env.ROTATION_TEST_S3_BUCKET ?? '')
  : 'signote-rotation-test';
if (remoteRotationStore) {
  for (const name of [
    'ROTATION_TEST_S3_BUCKET',
    'ROTATION_TEST_S3_ACCESS_KEY_ID',
    'ROTATION_TEST_S3_SECRET_ACCESS_KEY',
  ])
    if (!process.env[name]) throw new Error(`${name} is required when ROTATION_TEST_S3_ENDPOINT is set`);
}

export function localRotationS3() {
  return new S3Client({
    region: remoteRotationStore ? (process.env.ROTATION_TEST_S3_REGION ?? 'auto') : 'us-east-1',
    endpoint: rotationStoreEndpoint,
    forcePathStyle: true,
    credentials: remoteRotationStore
      ? {
          accessKeyId: process.env.ROTATION_TEST_S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.ROTATION_TEST_S3_SECRET_ACCESS_KEY!,
        }
      : { accessKeyId: 'signote-local', secretAccessKey: 'signote-local-only' },
  });
}
export async function ensureRotationBucket(client: S3Client) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: rotationTestBucket }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
    // A remote bucket is the operator's to create: it must be a throwaway one,
    // and creating it here would hide a typo that pointed at the wrong account.
    if (remoteRotationStore) throw new Error(`bucket ${rotationTestBucket} does not exist at ${rotationStoreEndpoint}`);
    await client.send(new CreateBucketCommand({ Bucket: rotationTestBucket }));
  }
}
export async function createLocalRotationDatabase() {
  const name = `signote_rotation_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres('postgres://signote:signote@127.0.0.1:5434/postgres', { max: 1, prepare: false });
  try {
    await admin`create database ${admin(name)}`;
  } catch (error) {
    await admin.end();
    throw error;
  }
  return {
    url: `postgres://signote:signote@127.0.0.1:5434/${name}`,
    async stop() {
      try {
        await admin`drop database ${admin(name)}`;
      } finally {
        await admin.end();
      }
    },
  };
}
