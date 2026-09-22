import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type ImportObject = { key: string; bytes: number; checksum: string };
export type VerifiedImportObject = ImportObject & { etag: string };

const normalizeEtag = (etag: string | undefined) => (etag ?? '').trim().replace(/^W\//i, '').replaceAll('"', '');
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const keyPattern = new RegExp(`^vault-import/${uuid}/${uuid}$`);

export class VaultImportStorageError extends Error {
  constructor(readonly code: 'INVALID_OBJECT' | 'OBJECT_MISMATCH') {
    super(code);
    this.name = 'VaultImportStorageError';
  }
}

function validate(object: ImportObject) {
  if (
    !keyPattern.test(object.key) ||
    !Number.isSafeInteger(object.bytes) ||
    object.bytes < 0 ||
    !/^[a-f0-9]{64}$/.test(object.checksum)
  )
    throw new VaultImportStorageError('INVALID_OBJECT');
}

export function createVaultImportObjectStore(client: S3Client, bucket: string) {
  return {
    allocate(operationId: string, bytes: number, checksum: string): ImportObject {
      const value = { key: `vault-import/${operationId}/${randomUUID()}`, bytes, checksum };
      validate(value);
      return value;
    },
    /** `contentType` is what the object is later served as: the attachment's
     * own type for a plaintext file, opaque bytes for ciphertext. */
    async uploadGrant(object: ImportObject & { contentType?: string }, expiresIn: number) {
      validate(object);
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 300)
        throw new VaultImportStorageError('INVALID_OBJECT');
      const contentType = object.contentType ?? 'application/octet-stream';
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.key,
          ContentLength: object.bytes,
          IfNoneMatch: '*',
          ContentType: contentType,
        }),
        { expiresIn, signableHeaders: new Set(['content-length', 'if-none-match']) },
      );
      return { url, headers: { 'if-none-match': '*', 'content-type': contentType } };
    },
    async verify(object: ImportObject) {
      validate(object);
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
      if (!result.Body || result.ContentLength !== object.bytes) throw new VaultImportStorageError('OBJECT_MISMATCH');
      const etag = normalizeEtag(result.ETag);
      if (!etag) throw new VaultImportStorageError('OBJECT_MISMATCH');
      const hash = createHash('sha256');
      let bytes = 0;
      const body = result.Body as AsyncIterable<Uint8Array> & { destroy(): void };
      try {
        for await (const chunk of body) {
          bytes += chunk.byteLength;
          if (bytes > object.bytes) throw new VaultImportStorageError('OBJECT_MISMATCH');
          hash.update(chunk);
        }
      } finally {
        body.destroy();
      }
      if (bytes !== object.bytes || hash.digest('hex') !== object.checksum)
        throw new VaultImportStorageError('OBJECT_MISMATCH');
      return { etag };
    },
    async verifyMetadata(object: VerifiedImportObject) {
      validate(object);
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
      if (head.ContentLength !== object.bytes || normalizeEtag(head.ETag) !== object.etag)
        throw new VaultImportStorageError('OBJECT_MISMATCH');
    },
    async remove(object: ImportObject) {
      validate(object);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key }));
    },
  };
}

export type VaultImportObjectStore = ReturnType<typeof createVaultImportObjectStore>;
