import { NextResponse } from 'next/server';

import {
  archiveSecret,
  deleteSecret,
  getSecretById,
  unarchiveSecret,
  undeleteSecret,
  updateSecret,
  updateSecretColor,
  updateSecretPosition,
} from '@/controllers/secrets';
import { assertOwner, withSession } from '@/lib/routeAuth';
import { type EncryptedPayload } from '@/types/crypto';

export const runtime = 'nodejs';

export const DELETE = withSession(async (_req, { address, params: { id } }) => {
  assertOwner(await getSecretById(id), address);

  await deleteSecret(id);

  return NextResponse.json({ success: true });
});

export const PATCH = withSession(async (req, { address, params: { id } }) => {
  const secret = assertOwner(await getSecretById(id), address);

  const body = await req.json();
  const { title, encryptedBody, archived, deleted, color, position } = body as {
    title?: string;
    encryptedBody?: EncryptedPayload | null;
    archived?: boolean;
    deleted?: boolean;
    color?: string | null;
    position?: number;
  };

  let updated;
  if (typeof deleted === 'boolean') {
    updated = deleted ? await deleteSecret(id) : await undeleteSecret(id);
  } else if (typeof archived === 'boolean') {
    updated = archived ? await archiveSecret(id) : await unarchiveSecret(id);
  } else if ('color' in body) {
    updated = await updateSecretColor(id, color ?? null);
  } else if (typeof position === 'number') {
    updated = await updateSecretPosition(id, position);
  } else {
    updated = await updateSecret(
      id,
      title ?? secret.title,
      encryptedBody !== undefined ? encryptedBody : secret.encryptedBody,
    );
  }

  return NextResponse.json(updated);
});
