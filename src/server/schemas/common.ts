import { isValidObjectId } from 'mongoose';
import { z } from 'zod';

import { MAX_CIPHER, MAX_SEARCH, MAX_TAGS_PER_NOTE } from '@/config/constants';
import { NOTE_COLORS, NOTE_PATTERNS } from '@/config/noteStyles';

/** A MongoDB ObjectId string. Mirrors the `isValidObjectId` guard in the routes. */
export const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

/** Pagination + filter params shared by the notes/secrets/seals list queries.
 *  limit/offset clamp (rather than reject) to match the old route's lenient
 *  `Math.min(100, Math.max(1, …))` behaviour. */
export const listParams = z.object({
  archived: z.boolean().optional(),
  search: z.string().max(MAX_SEARCH).optional(),
  tags: z.array(objectId).max(MAX_TAGS_PER_NOTE).optional(),
  tagMode: z.enum(['or', 'and']).optional().default('or'),
  limit: z
    .number()
    .int()
    .optional()
    .default(30)
    .transform((n) => Math.min(Math.max(n, 1), 100)),
  offset: z
    .number()
    .int()
    .optional()
    .default(0)
    .transform((n) => Math.max(n, 0)),
});

export const noteColor = z.enum(NOTE_COLORS).nullable();
export const notePattern = z.enum(NOTE_PATTERNS).nullable();

/** Incoming tag-id list for create/setTags. Strings (not strict ObjectIds): the
 *  per-note cap is enforced here, but foreign/malformed ids are dropped
 *  server-side by `getOwnedTagIds` — matching the old lenient route behaviour. */
export const tagIdList = z.array(z.string()).max(MAX_TAGS_PER_NOTE);

/** AES-GCM payload as stored on secrets/seals. Mirrors `EncryptedPayload`.
 *  Ciphertext is capped at MAX_CIPHER — the old routes' 413 guard. */
export const encryptedPayload = z.object({
  alg: z.literal('A256GCM'),
  iv: z.string(),
  ciphertext: z.string().max(MAX_CIPHER),
});
