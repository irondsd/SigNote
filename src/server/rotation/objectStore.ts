import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Internal storage receipt. Never accept this directly from a public caller.
 * The rotation controller must persist it, enforce ownership/fence/quota, and
 * retain cancelled keys until the last issued grant expires before cleanup.
 */
export type RotationObject = { key: string; bytes: number; checksum: string };

export class RotationStorageError extends Error {
  constructor(readonly code: 'INVALID_OBJECT' | 'OBJECT_MISMATCH') {
    super(code);
    this.name = 'RotationStorageError';
  }
}

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const keyPattern = new RegExp(`^rotation/${uuid}/${uuid}$`);

function validateObject(object: RotationObject) {
  const checksum = Buffer.from(object.checksum, 'base64');
  if (
    !keyPattern.test(object.key) ||
    !Number.isSafeInteger(object.bytes) ||
    object.bytes < 16 ||
    checksum.length !== 32 ||
    checksum.toString('base64') !== object.checksum
  ) {
    throw new RotationStorageError('INVALID_OBJECT');
  }
}

/** S3 adapter with conditional create and checksum-bound signed PUTs.
 * The provider must pass the integration suite before this strategy is enabled.
 * A fresh key by itself does NOT prevent a still-valid PUT from overwriting it.
 */
export function createRotationObjectStore(client: S3Client, bucket: string) {
  /** The provider's own statement about the stored bytes: exact length and the
   * SHA-256 it computed over what it accepted, never an ETag. One round trip. */
  const verifyMetadata = async (object: RotationObject): Promise<void> => {
    validateObject(object);
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key, ChecksumMode: 'ENABLED' }));
    if (head.ContentLength !== object.bytes || head.ChecksumSHA256 !== object.checksum)
      throw new RotationStorageError('OBJECT_MISMATCH');
  };
  return {
    /** Internal frozen inventory keys only, never a caller-supplied bucket key. */
    async sourceReadGrant(key: string, expiresIn: number) {
      if (!key || expiresIn < 1 || expiresIn > 300) throw new RotationStorageError('INVALID_OBJECT');
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key, ResponseCacheControl: 'private, no-store' }),
        { expiresIn },
      );
    },
    async inspectSource(key: string) {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { bytes: result.ContentLength };
    },
    /** Cleanup queue keys include superseded legacy uploads as well as staging. */
    async removeKey(key: string) {
      if (!key) throw new RotationStorageError('INVALID_OBJECT');
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    allocate(operationId: string, bytes: number, checksum: string): RotationObject {
      const object = { key: `rotation/${operationId}/${randomUUID()}`, bytes, checksum };
      validateObject(object);
      return object;
    },
    async uploadGrant(object: RotationObject, expiresIn: number) {
      validateObject(object);
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 300)
        throw new RotationStorageError('INVALID_OBJECT');
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.key,
          ContentLength: object.bytes,
          ChecksumSHA256: object.checksum,
          IfNoneMatch: '*',
          ContentType: 'application/octet-stream',
        }),
        {
          expiresIn,
          signableHeaders: new Set(['content-length', 'if-none-match', 'x-amz-checksum-sha256']),
          unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
        },
      );
      // Browsers set Content-Length from the body; JavaScript must not set it.
      return {
        url,
        headers: {
          'if-none-match': '*',
          'x-amz-checksum-sha256': object.checksum,
          'content-type': 'application/octet-stream',
        },
      };
    },
    async readGrant(object: RotationObject, expiresIn: number) {
      validateObject(object);
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 300)
        throw new RotationStorageError('INVALID_OBJECT');
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: object.key,
          ResponseCacheControl: 'private, no-store',
        }),
        { expiresIn },
      );
    },
    /** Re-verification after the object was accepted. A conditional create
     * (`If-None-Match: '*'`) means it cannot have changed since, so re-reading
     * it end to end proves nothing `verify` did not already prove — and at the
     * documented 100 MiB bound, doing that inside the activation request is the
     * most likely place for a commit to time out.
     */
    verifyMetadata,
    /** Verify origin bytes as well as provider metadata, never an ETag. Streams
     * server-side so verification does not buffer a whole object in a function.
     *
     * This is what establishes that a freshly uploaded object is real, and it
     * belongs at `finalizeFile`, once per object. Later checks use
     * `verifyMetadata`.
     */
    async verify(object: RotationObject): Promise<void> {
      await verifyMetadata(object);
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
      if (!result.Body) throw new RotationStorageError('OBJECT_MISMATCH');
      const hash = createHash('sha256');
      let bytes = 0;
      // S3Client in the Node runtime returns an async iterable readable stream.
      const body = result.Body as AsyncIterable<Uint8Array> & { destroy(): void };
      try {
        for await (const chunk of body) {
          bytes += chunk.byteLength;
          if (bytes > object.bytes) throw new RotationStorageError('OBJECT_MISMATCH');
          hash.update(chunk);
        }
        if (bytes !== object.bytes || hash.digest('base64') !== object.checksum)
          throw new RotationStorageError('OBJECT_MISMATCH');
      } finally {
        body.destroy();
      }
    },
    /** Only call after a transaction has confirmed no active pointer references
     * this receipt AND all issued upload grants have expired. No in-TX S3 calls.
     */
    async remove(object: RotationObject) {
      validateObject(object);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key }));
    },
  };
}
