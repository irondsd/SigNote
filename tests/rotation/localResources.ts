/** Explicit loopback test resources. Never uses incoming DATABASE_URL/AWS env. */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

export const rotationTestBucket = 'signote-rotation-test';
export function localRotationS3() {
  return new S3Client({
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9100',
    forcePathStyle: true,
    credentials: { accessKeyId: 'signote-rotation-local', secretAccessKey: 'signote-rotation-local-only' },
  });
}
export async function ensureRotationBucket(client: S3Client) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: rotationTestBucket }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
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
