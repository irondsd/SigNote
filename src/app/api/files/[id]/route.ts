import { isValidObjectId } from 'mongoose';
import { NextResponse } from 'next/server';

import { deleteFileAttachment, getFileAttachment } from '@/controllers/files';
import { RouteAuthError, withSession } from '@/lib/routeAuth';
import { streamFromS3 } from '@/lib/s3';

export const runtime = 'nodejs';

export const GET = withSession(async (req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');

  const doc = await getFileAttachment(id, userId);
  if (!doc) throw new RouteAuthError(404, 'Not found');

  const { body, contentType, contentLength } = await streamFromS3(doc.s3Key);

  const headers: HeadersInit = {
    'Content-Type': doc.encrypted ? 'application/octet-stream' : contentType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename)}"`,
    'Cache-Control': 'private, max-age=3600',
  };
  if (contentLength != null) {
    headers['Content-Length'] = String(contentLength);
  }
  if (doc.encrypted) {
    headers['X-File-Encrypted'] = 'true';
    if (doc.encryptionIv) headers['X-Encryption-IV'] = doc.encryptionIv;
    headers['X-Original-MimeType'] = doc.mimeType;
  }

  // @ts-expect-error -- Node Readable is accepted by the Response constructor at runtime
  return new NextResponse(body, { headers });
});

export const DELETE = withSession(async (_req, { userId, params: { id } }) => {
  if (!isValidObjectId(id)) throw new RouteAuthError(404, 'Not found');

  const doc = await deleteFileAttachment(id, userId);
  if (!doc) throw new RouteAuthError(404, 'Not found');

  return NextResponse.json({ success: true });
});
