import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

import type { EncryptedPayload, KdfParams } from '@/types/crypto';

/**
 * All primary keys are TEXT, not UUID columns, on purpose:
 *  - live data contains both shapes. Rows predating the Postgres move kept
 *    their original 24-char hex ids verbatim, so caches and JWT `sid` claims
 *    stayed valid; everything created since gets a UUIDv7. Neither is going
 *    away, so the column type has to accept both.
 *  - a malformed id from user input (a stale cache, an id parsed out of note
 *    content) can never raise a cast error — it simply matches nothing, which
 *    is the behaviour the API contract is built around: unknown ids 404.
 */
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date());

/**
 * `updated_at` that also refreshes itself on every UPDATE. Only the auth tables
 * want this. The note tiers and tags deliberately keep the plain version: there
 * `updatedAt` means
 * "when the content was last saved", so a color or position change must not
 * bump it (it drives both the search sort order and the "edited" label).
 */
const updatedAtAuto = () => updatedAt().$onUpdate(() => new Date());

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Postgres `tsvector`. Drizzle has no built-in, and we only ever read/write
 *  these through generated columns and `@@`, so an opaque string is enough. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// History is ordered by insertion, NOT by createdAt: a restore snapshot carries
// the displaced head's original save time, so timestamps can go backwards.
// `seq` is the only correct ordering key — sorting history by createdAt breaks
// restore.
const versionSeq = () => bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity();

// Shared metadata columns of the three note tiers.
const tierColumns = () => ({
  id: id(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default(''),
  position: doublePrecision('position').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: ts('deleted_at'),
  archived: boolean('archived').notNull().default(false),
  color: text('color'),
  pattern: text('pattern'),
  pinned: boolean('pinned').notNull().default(false),
  expiresAt: ts('expires_at'),
  burnAfterReading: boolean('burn_after_reading').notNull().default(false),
});

/**
 * Weighted full-text vector. Postgres weight labels are relative, not numeric:
 * 'A' on the title and 'B' on the body means a title hit outranks a body hit
 * (~2.7x under the default ts_rank weighting).
 *
 * `to_tsvector` with an explicit regconfig is IMMUTABLE, which a generated
 * column requires. Its default parser also drops `tag` tokens, so the HTML
 * that tier-1 content is stored as never pollutes the index.
 */
const searchTsv = (columns: string[]): SQL =>
  sql.raw(
    columns
      .map((col, i) => `setweight(to_tsvector('english', coalesce(${col}, '')), '${'AB'[i] ?? 'B'}')`)
      .join(' || '),
  );

// ---------------------------------------------------------------------------
// Tier 1 — Notes (plaintext)

export const notes = pgTable(
  'notes',
  {
    ...tierColumns(),
    content: text('content').notNull().default(''),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(() => searchTsv(['title', 'content'])),
  },
  (t) => [
    index('notes_user_deleted_idx').on(t.userId, t.deletedAt),
    index('notes_list_idx').on(t.userId, t.archived, t.pinned, t.position),
    index('notes_search_sort_idx').on(t.userId, t.archived, t.pinned, t.updatedAt),
    index('notes_expires_idx').on(t.expiresAt),
    index('notes_deleted_idx').on(t.deletedAt),
    index('notes_search_tsv_idx').using('gin', t.searchTsv),
  ],
);

export const noteVersions = pgTable(
  'note_versions',
  {
    id: id(),
    seq: versionSeq(),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    content: text('content').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('note_versions_note_idx').on(t.noteId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Tier 2 — Secrets (AES-GCM, shared session key)

export const secretNotes = pgTable(
  'secret_notes',
  {
    ...tierColumns(),
    encryptedBody: jsonb('encrypted_body').$type<EncryptedPayload | null>(),
    // Body is ciphertext — only the plaintext title is searchable.
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(() => searchTsv(['title'])),
  },
  (t) => [
    index('secret_notes_user_deleted_idx').on(t.userId, t.deletedAt),
    index('secret_notes_list_idx').on(t.userId, t.archived, t.pinned, t.position),
    index('secret_notes_search_sort_idx').on(t.userId, t.archived, t.pinned, t.updatedAt),
    index('secret_notes_expires_idx').on(t.expiresAt),
    index('secret_notes_deleted_idx').on(t.deletedAt),
    index('secret_notes_search_tsv_idx').using('gin', t.searchTsv),
  ],
);

export const secretNoteVersions = pgTable(
  'secret_note_versions',
  {
    id: id(),
    seq: versionSeq(),
    noteId: text('note_id')
      .notNull()
      .references(() => secretNotes.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    encryptedBody: jsonb('encrypted_body').$type<EncryptedPayload | null>(),
    createdAt: createdAt(),
  },
  (t) => [index('secret_note_versions_note_idx').on(t.noteId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Tier 3 — Seals (AES-GCM, per-note wrapped key; NEK never rotates)

export const sealNotes = pgTable(
  'seal_notes',
  {
    ...tierColumns(),
    encryptedBody: jsonb('encrypted_body').$type<EncryptedPayload | null>(),
    wrappedNoteKey: jsonb('wrapped_note_key').$type<EncryptedPayload | null>(),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(() => searchTsv(['title'])),
  },
  (t) => [
    index('seal_notes_user_deleted_idx').on(t.userId, t.deletedAt),
    index('seal_notes_list_idx').on(t.userId, t.archived, t.pinned, t.position),
    index('seal_notes_search_sort_idx').on(t.userId, t.archived, t.pinned, t.updatedAt),
    index('seal_notes_expires_idx').on(t.expiresAt),
    index('seal_notes_deleted_idx').on(t.deletedAt),
    index('seal_notes_search_tsv_idx').using('gin', t.searchTsv),
  ],
);

export const sealNoteVersions = pgTable(
  'seal_note_versions',
  {
    id: id(),
    seq: versionSeq(),
    noteId: text('note_id')
      .notNull()
      .references(() => sealNotes.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    encryptedBody: jsonb('encrypted_body').$type<EncryptedPayload | null>(),
    createdAt: createdAt(),
  },
  (t) => [index('seal_note_versions_note_idx').on(t.noteId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Tags + per-tier join tables. `sort_order` preserves the picker's ordering.

export const tags = pgTable(
  'tags',
  {
    id: id(),
    userId: text('user_id').notNull(),
    // Stored lowercased/trimmed; uniqueness enforced per user below.
    name: text('name').notNull(),
    color: text('color').notNull(),
    // Bumped whenever the tag is applied to a note; drives the picker's default
    // "most recently used first" ordering. Null until the tag is first used.
    lastUsedAt: ts('last_used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tags_user_name_unique').on(t.userId, t.name)],
);

const joinColumns = (parent: typeof notes | typeof secretNotes | typeof sealNotes) => ({
  noteId: text('note_id')
    .notNull()
    .references(() => parent.id, { onDelete: 'cascade' }),
  tagId: text('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
  // Preserves the order of the incoming tag list (the picker's order).
  sortOrder: integer('sort_order').notNull().default(0),
});

export const noteTags = pgTable('note_tags', joinColumns(notes), (t) => [
  primaryKey({ columns: [t.noteId, t.tagId] }),
  index('note_tags_tag_idx').on(t.tagId),
]);

export const secretNoteTags = pgTable('secret_note_tags', joinColumns(secretNotes), (t) => [
  primaryKey({ columns: [t.noteId, t.tagId] }),
  index('secret_note_tags_tag_idx').on(t.tagId),
]);

export const sealNoteTags = pgTable('seal_note_tags', joinColumns(sealNotes), (t) => [
  primaryKey({ columns: [t.noteId, t.tagId] }),
  index('seal_note_tags_tag_idx').on(t.tagId),
]);

// ---------------------------------------------------------------------------
// Users / auth

/**
 * The email lives here rather than on an identity on purpose.
 *
 * "One address = one account" is a constraint *across* providers, and
 * `auth_identities` is keyed `(provider, subject)` — it cannot express it.
 * Hanging the address off the user gives it a real unique index, and lets a
 * Google sign-in and an emailed code resolve to the same account without any
 * merge logic. Identities keep their own `email` column, but only as
 * provider-reported audit data; this is the authoritative one.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    displayName: text('display_name').notNull(),
    /** Null for a wallet-only account, which has no address at all. */
    email: text('email'),
    /** Stamped the moment control was proven — an emailed code, or a verified OIDC claim. */
    emailVerifiedAt: ts('email_verified_at'),
    /**
     * The identity that proved the address, when one did. Null means nothing
     * owns it — proven by a code, or the owning identity has since been
     * unlinked — and only then may the user detach it by hand.
     *
     * Storing the owner rather than deriving it live matters: a provider can
     * flip `email_verified` under us, and the address must not change hands
     * (or become un-removable) because of something that happened elsewhere.
     */
    emailOwnerIdentityId: text('email_owner_identity_id'),
    createdAt: createdAt(),
    updatedAt: updatedAtAuto(),
  },
  // Case-insensitive: nobody treats the local part as case-sensitive in
  // practice, and two accounts differing only in case would be indistinguishable
  // to the person typing it. Deliberately *not* normalising Gmail dots or
  // plus-addressing — provider-specific canonicalisation ages badly.
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)],
);

export type AuthProvider = 'google' | 'siwe';
export type AuthClient = 'web' | 'pwa' | 'desktop';
export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: id(),
    userId: text('user_id').notNull(),
    provider: text('provider').$type<AuthProvider>().notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: text('email'),
    emailVerified: boolean('email_verified'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    rawProfileJson: jsonb('raw_profile_json').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAtAuto(),
  },
  (t) => [
    // Prevents two accounts from claiming the same provider identity
    uniqueIndex('auth_identities_provider_subject_unique').on(t.provider, t.providerSubject),
    index('auth_identities_user_idx').on(t.userId),
  ],
);

// PK is the `sid` claim NextAuth stamps into the JWT — an ObjectId hex string
// for sessions issued before the Postgres cutover, a UUIDv7 for new ones.
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').$type<AuthProvider>().notNull(),
    // Labels the session in the device list only. Never a trust boundary.
    client: text('client').$type<AuthClient>().notNull().default('web'),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    browser: text('browser').notNull().default(''),
    os: text('os').notNull().default(''),
    deviceType: text('device_type').$type<DeviceType>().notNull().default('unknown'),
    createdAt: createdAt(),
    updatedAt: updatedAtAuto(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    index('auth_sessions_user_updated_idx').on(t.userId, t.updatedAt),
    index('auth_sessions_expires_idx').on(t.expiresAt),
  ],
);

export const authNonces = pgTable(
  'auth_nonces',
  {
    nonce: text('nonce').primaryKey(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ip: text('ip'),
  },
  (t) => [index('auth_nonces_ip_created_idx').on(t.ip, t.createdAt), index('auth_nonces_expires_idx').on(t.expiresAt)],
);

export type DesktopAuthAttemptStatus = 'pending' | 'authorized' | 'consumed';

export const desktopAuthAttempts = pgTable(
  'desktop_auth_attempts',
  {
    // The opaque handle the desktop app polls with; also the primary key.
    attemptId: text('attempt_id').primaryKey(),
    stateHash: text('state_hash').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').$type<'S256'>().notNull(),
    authorizationCodeHash: text('authorization_code_hash'),
    userId: text('user_id'),
    status: text('status').$type<DesktopAuthAttemptStatus>().notNull().default('pending'),
    ip: text('ip').notNull().default(''),
    exchangeAttempts: integer('exchange_attempts').notNull().default(0),
    authorizedAt: ts('authorized_at'),
    consumedAt: ts('consumed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAtAuto(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('desktop_auth_attempts_ip_created_idx').on(t.ip, t.createdAt),
    index('desktop_auth_attempts_expires_idx').on(t.expiresAt),
    // An authorization code may only ever belong to one attempt. Partial, so
    // the many rows still awaiting authorization don't collide on NULL.
    uniqueIndex('desktop_auth_attempts_code_unique')
      .on(t.authorizationCodeHash)
      .where(sql`${t.authorizationCodeHash} is not null`),
  ],
);

export const encryptionProfiles = pgTable(
  'encryption_profiles',
  {
    id: id(),
    userId: text('user_id').notNull(),
    version: integer('version').notNull(),
    serverShare: text('server_share').notNull(), // base64, 32 bytes random
    salt: text('salt').notNull(), // base64
    kdf: jsonb('kdf').$type<KdfParams>().notNull(),
    keyCheck: jsonb('key_check').$type<EncryptedPayload>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('encryption_profiles_user_unique').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Notification preferences

/**
 * Opt-outs, not opt-ins: a user with no row here is subscribed to everything
 * that can be switched off, which is why every column defaults to true and the
 * read path falls back to the same defaults rather than creating a row on
 * sign-up. Transactional mail — sign-in codes above all — is deliberately
 * absent: there is no column to set, because turning it off would lock the
 * account out of its own sign-in.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: id(),
    userId: text('user_id').notNull(),
    /** Product announcements and release notes. */
    productNews: boolean('product_news').notNull().default(true),
    /** "New sign-in from …" alerts. */
    signInAlerts: boolean('sign_in_alerts').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAtAuto(),
  },
  (t) => [uniqueIndex('notification_preferences_user_unique').on(t.userId)],
);

// ---------------------------------------------------------------------------
// File attachments (S3-backed)

export type NoteTier = 'note' | 'secret' | 'seal';

export const fileAttachments = pgTable(
  'file_attachments',
  {
    id: id(),
    userId: text('user_id').notNull(),
    noteId: text('note_id'),
    noteTier: text('note_tier').$type<NoteTier>(),
    s3Key: text('s3_key').notNull(),
    filename: text('filename').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    encrypted: boolean('encrypted').notNull().default(false),
    encryptionIv: text('encryption_iv'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
    storageDeletedAt: ts('storage_deleted_at'),
    deleteAttempts: integer('delete_attempts').notNull().default(0),
    lastDeleteError: text('last_delete_error'),
  },
  (t) => [
    index('file_attachments_user_idx').on(t.userId),
    index('file_attachments_note_idx').on(t.noteId),
    index('file_attachments_storage_deleted_idx').on(t.storageDeletedAt),
  ],
);
