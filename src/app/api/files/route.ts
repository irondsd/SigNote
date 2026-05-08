import { NextResponse } from 'next/server';

import { createFileAttachment, ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '@/controllers/files';
import { withSession } from '@/lib/routeAuth';

export const runtime = 'nodejs';

export const POST = withSession(async (req, { userId }) => {
  const formData = await req.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const doc = await createFileAttachment(userId, {
      filename: file.name,
      size: file.size,
      mimeType: file.type,
      buffer,
    });

    return NextResponse.json(
      {
        fileId: doc._id.toString(),
        filename: doc.filename,
        size: doc.size,
        mimeType: doc.mimeType,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[files upload]', err);
    const message = err instanceof Error ? err.message : 'Upload failed';
    if (message === 'Storage quota exceeded') {
      return NextResponse.json({ error: message }, { status: 413 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
