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

/** A receipt whose bytes `verify` has already read end to end, carrying the
 * provider's entity tag for the object it accepted. Later checks re-identify
 * the object by that tag rather than re-hashing it. */
export type VerifiedRotationObject = RotationObject & { etag: string };

/** Compare entity tags by value, not by quoting or weakness. Providers differ
 * on both, and a tag that survives a round trip unchanged is all we need. */
const normalizeEtag = (etag: string | undefined): string =>
  (etag ?? '').trim().replace(/^W\//i, '').replaceAll('"', '');

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

/** S3 adapter with conditional create and length-bound signed PUTs, whose
 * checksum is enforced by reading the accepted bytes back rather than by the
 * provider (see `uploadGrant` and `verify`).
 * The provider must pass the integration suite before this strategy is enabled.
 * A fresh key by itself does NOT prevent a still-valid PUT from overwriting it.
 */
export function createRotationObjectStore(client: S3Client, bucket: string) {
  /** Re-identify an object `verify` already hashed: exact length, plus the
   * entity tag the provider reported for the bytes it accepted. One round trip.
   *
   * This is an identity check, not an integrity check — it establishes that the
   * object at this key is still the one whose bytes were read end to end, which
   * is all that is left to prove once conditional create has made those bytes
   * immutable. A full-object SHA-256 would be a stronger claim, but S3's
   * `x-amz-checksum-sha256` is not portable enough to require: Cloudflare R2
   * records SHA-256 only as a composite (multipart) checksum and returns none
   * for a single `PutObject`, so demanding it here would fail every rotation of
   * a vault that has attachments.
   */
  const verifyMetadata = async (object: VerifiedRotationObject): Promise<void> => {
    validateObject(object);
    if (!object.etag) throw new RotationStorageError('OBJECT_MISMATCH');
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
    if (head.ContentLength !== object.bytes || normalizeEtag(head.ETag) !== object.etag)
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
          IfNoneMatch: '*',
          ContentType: 'application/octet-stream',
        }),
        { expiresIn, signableHeaders: new Set(['content-length', 'if-none-match']) },
      );
      // The grant binds the key, the exact length and create-only semantics, but
      // not the SHA-256: `x-amz-checksum-sha256` is not portable (see
      // `verifyMetadata`), and a provider that rejects the header outright fails
      // the upload rather than the verification. The checksum is still enforced,
      // by `verify` reading the accepted bytes back in full — one round trip
      // later, and by us rather than by the provider.
      // Browsers set Content-Length from the body; JavaScript must not set it.
      return { url, headers: { 'if-none-match': '*', 'content-type': 'application/octet-stream' } };
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
    /** Read the accepted bytes back in full and hash them. Streams server-side
     * so verification does not buffer a whole object in a function.
     *
     * This is the only place the stored SHA-256 is actually proven, and it is
     * ours rather than the provider's: the grant no longer asks the provider to
     * validate a checksum, so nothing before this point has looked at the bytes.
     * It belongs at `finalizeFile`, once per object. It returns the entity tag
     * the provider reported for those bytes, which the caller must persist —
     * `verifyMetadata` re-identifies the object by it later, and cannot run
     * without it.
     *
     * A failure means an object exists at this key holding bytes we will not
     * accept. Conditional create makes that key unusable for a retry, so the
     * caller must retire it and allocate a fresh one.
     */
    async verify(object: RotationObject): Promise<{ etag: string }> {
      validateObject(object);
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
      if (!result.Body) throw new RotationStorageError('OBJECT_MISMATCH');
      const etag = normalizeEtag(result.ETag);
      if (!etag || result.ContentLength !== object.bytes) throw new RotationStorageError('OBJECT_MISMATCH');
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
      return { etag };
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
