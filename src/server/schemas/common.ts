import { z } from 'zod';

import { MAX_CIPHER, MAX_SEARCH, MAX_TAGS_PER_NOTE } from '@/config/constants';
import { NOTE_COLORS, NOTE_PATTERNS } from '@/config/noteStyles';

/** An opaque entity id — either a 24-char hex id (older rows) or a UUIDv7.
 *  Ids are TEXT columns, so an unknown format simply matches nothing: there is
 *  no cast to fail, and nothing to validate beyond an anti-abuse length cap.
 *  This is why an unrecognised id 404s rather than 400s. */
export const objectId = z.string().min(1).max(64);

/** Pagination + filter params shared by the notes/secrets/seals list queries.
 *  search/limit/offset clamp (rather than reject) to match the old route's
 *  lenient `.trim().slice(0, MAX_SEARCH)` / `Math.min(100, Math.max(1, …))`
 *  behaviour — an over-long search truncates instead of failing the list. */
export const listParams = z.object({
  archived: z.boolean().optional(),
  search: z
    .string()
    .optional()
    .transform((s) => s?.trim().slice(0, MAX_SEARCH)),
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

/** Incoming tag-id list for create/setTags. Strings (not strict ids): the
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
