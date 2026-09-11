import { S3Client } from '@aws-sdk/client-s3';
import { createRotationObjectStore } from './objectStore';
import { createRotationService } from './service';

let service: ReturnType<typeof createRotationService> | undefined;
/** No test faults are accepted from environment or RPC. */
export function getRotationService() {
  if (!service) {
    const client = new S3Client({
      region: process.env.AWS_S3_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
      ...(process.env.AWS_S3_ENDPOINT ? { endpoint: process.env.AWS_S3_ENDPOINT, forcePathStyle: true } : {}),
    });
    service = createRotationService({
      storage: createRotationObjectStore(client, process.env.AWS_S3_BUCKET ?? ''),
    });
  }
  return service;
}
