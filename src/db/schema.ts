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

import type { NoteColor, NotePattern } from '@/config/noteStyles';
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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
]).enableRLS();

export const secretNoteTags = pgTable('secret_note_tags', joinColumns(secretNotes), (t) => [
  primaryKey({ columns: [t.noteId, t.tagId] }),
  index('secret_note_tags_tag_idx').on(t.tagId),
]).enableRLS();

export const sealNoteTags = pgTable('seal_note_tags', joinColumns(sealNotes), (t) => [
  primaryKey({ columns: [t.noteId, t.tagId] }),
  index('seal_note_tags_tag_idx').on(t.tagId),
]).enableRLS();

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
).enableRLS();

export type IdentityProvider = 'google' | 'siwe';
export type AuthProvider = IdentityProvider | 'email' | 'passkey';
export type AuthClient = 'web' | 'pwa' | 'desktop';
export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: id(),
    userId: text('user_id').notNull(),
    provider: text('provider').$type<IdentityProvider>().notNull(),
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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
    // How the browser session that authorized this attempt was signed in. The
    // desktop session it mints inherits the label, so the device list shows
    // what actually happened rather than assuming Google.
    provider: text('provider').$type<AuthProvider>(),
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
).enableRLS();

/**
 * One-time codes for email sign-in, and for attaching an address to an existing
 * account. Both are the same question — "do you control this mailbox?" — so
 * there is one table and no `purpose` column: a code proves control, and what
 * the caller does with that proof is the caller's business.
 *
 * The code itself is never stored. Six digits is a million possibilities, which
 * a leaked table would give up instantly; the column holds an HMAC and the row
 * caps its own attempts.
 */
export const emailSignInCodes = pgTable(
  'email_sign_in_codes',
  {
    id: id(),
    /** Always normalised — lowercase, trimmed — so lookups match the users table. */
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: ts('consumed_at'),
    /** Recorded for rate limiting and for the audit trail, as with sign-in nonces. */
    ip: text('ip').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('email_sign_in_codes_email_idx').on(t.email),
    // Swept by the same cron that reaps nonces and expired sessions.
    index('email_sign_in_codes_expires_idx').on(t.expiresAt),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Passkeys (WebAuthn)

export type PasskeyDeviceType = 'singleDevice' | 'multiDevice';
export type PasskeyChallengeKind = 'register' | 'signup' | 'authenticate';

/**
 * A passkey is a sign-in method, not an auth identity: one account can have
 * several credentials, each with its own public key and lifecycle.
 */
export const passkeyCredentials = pgTable(
  'passkey_credentials',
  {
    id: id(),
    userId: text('user_id').notNull(),
    credentialId: text('credential_id').notNull(),
    /** Base64url-encoded COSE public key returned by SimpleWebAuthn. */
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: jsonb('transports').$type<string[]>().notNull().default([]),
    aaguid: text('aaguid').notNull(),
    deviceType: text('device_type').$type<PasskeyDeviceType>().notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    nickname: text('nickname').notNull(),
    lastUsedAt: ts('last_used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAtAuto(),
  },
  (t) => [
    uniqueIndex('passkey_credentials_credential_unique').on(t.credentialId),
    index('passkey_credentials_user_idx').on(t.userId),
  ],
).enableRLS();

/** Short-lived, single-use state for registration and authentication. */
export const passkeyChallenges = pgTable(
  'passkey_challenges',
  {
    challenge: text('challenge').primaryKey(),
    kind: text('kind').$type<PasskeyChallengeKind>().notNull(),
    userId: text('user_id'),
    ip: text('ip').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('passkey_challenges_ip_created_idx').on(t.ip, t.createdAt),
    index('passkey_challenges_expires_idx').on(t.expiresAt),
  ],
).enableRLS();

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
).enableRLS();

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
).enableRLS();

/**
 * Choices about what this account is willing to trade away for convenience.
 * Separate from `notification_preferences` because the two answer different
 * questions and neither should be read to answer the other's.
 *
 * The defaults are the safe end of each trade, so an account that never opens
 * this page is in the conservative state.
 */
export const securityPreferences = pgTable(
  'security_preferences',
  {
    id: id(),
    userId: text('user_id').notNull(),
    /**
     * Keep the `serverShare` half of the MEK on the device so the vault can be
     * unlocked with no network. Off by default: the whole point of splitting
     * the key is that one half never sits next to the other.
     */
    cacheServerShare: boolean('cache_server_share').notNull().default(false),
    /** Blur Authenticator codes until hovered, on pointer devices. */
    blurAuthCodes: boolean('blur_auth_codes').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAtAuto(),
  },
  (t) => [uniqueIndex('security_preferences_user_unique').on(t.userId)],
).enableRLS();

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
).enableRLS();

// ---------------------------------------------------------------------------
// Authenticator (TOTP)

/**
 * OTP credentials, opaque to the server.
 *
 * Deliberately not a note tier: `makeTierRepo` and `tierColumns` assume a
 * plaintext title, a search vector and note expiry, none of which may exist
 * here. Issuer and account name live inside `payload` because they reveal which
 * services the user has accounts with, so there is nothing indexable on the
 * row and search happens locally after decryption.
 *
 * `revision` — not `updatedAt` — is the concurrency token. Every write advances
 * it, reorders and soft-deletes included, so a tombstone always beats a stale
 * edit and a deleted credential cannot be resurrected. Note `updatedAt` means
 * "when the content was last saved" and intentionally ignores metadata changes,
 * which makes it useless as a cursor; here timestamps are informational only.
 *
 * A soft-deleted row keeps its id and drops its `payload` to NULL. It stays as
 * a tombstone for OTP_TOMBSTONE_RETENTION_MS so a device that has been offline
 * still learns the credential is gone.
 */
export const otpRecords = pgTable(
  'otp_records',
  {
    // Generated on the client (uuidv7) so the payload can be sealed with the id
    // as AAD before it is ever sent, and a create can be retried idempotently.
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    /** AES-GCM envelope; NULL once the row is a tombstone. */
    payload: jsonb('payload').$type<EncryptedPayload>(),
    /** Payload *format* version. Distinct from `revision`, which counts writes. */
    payloadVersion: integer('payload_version').notNull().default(1),
    position: doublePrecision('position').notNull(),
    revision: integer('revision').notNull().default(1),
    // Presentation only, and plaintext on purpose so the list can be filtered
    // and styled before anything is decrypted. Unlike issuer and account these
    // say nothing about *which* services the user holds accounts with, so they
    // do not belong inside the envelope. Same palette as the note tiers.
    archived: boolean('archived').notNull().default(false),
    // `$type` where the note tiers use a bare `text`: the client reads these
    // straight onto a card's data-color/data-pattern attributes, so a precise
    // type here saves a cast at every call site. The router's Zod enums are
    // still what actually validates a write.
    color: text('color').$type<NoteColor>(),
    pattern: text('pattern').$type<NotePattern>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('otp_records_user_idx').on(t.userId),
    // Drives the tombstone sweep in controllers/cleanup.ts.
    index('otp_records_deleted_idx').on(t.deletedAt),
  ],
).enableRLS();

// Stable account encryption/session state. Independent of profile format/id.
export const encryptionStates = pgTable('encryption_states', {
  userId: text('user_id').primaryKey(),
  generation: integer('generation').notNull().default(0),
  sessionEpoch: integer('session_epoch').notNull().default(0),
  survivingSid: text('surviving_sid'),
  rotationSessionSid: text('rotation_session_sid'),
  activeRotationId: text('active_rotation_id'),
}).enableRLS();

export type RotationPhase = 'preparing' | 'migrating' | 'ready' | 'committed' | 'aborted' | 'cleaned';
export type RotationKind = 'secret' | 'secret-version' | 'seal' | 'seal-version' | 'seal-wrapper' | 'auth' | 'file';
export type PendingEncryptionMaterial = {
  version: number;
  serverShare: string;
  salt: string;
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
};
export type RotationCipherValue =
  EncryptedPayload | { key: string; iv: string; bytes: number; checksum: string } | null;

export const encryptionRotations = pgTable(
  'encryption_rotations',
  {
    id: id(),
    userId: text('user_id').notNull(),
    ownerSid: text('owner_sid').notNull(),
    workerFence: integer('worker_fence').notNull().default(1),
    sourceGeneration: integer('source_generation').notNull(),
    targetGeneration: integer('target_generation').notNull(),
    profileId: text('profile_id').notNull(),
    profileDigest: text('profile_digest').notNull(),
    beginDigest: text('begin_digest').notNull(),
    phase: text('phase').$type<RotationPhase>().notNull().default('preparing'),
    paused: boolean('paused').notNull().default(false),
    pendingMaterial: jsonb('pending_material').$type<PendingEncryptionMaterial>(),
    inventoryDigest: text('inventory_digest').notNull(),
    itemCount: integer('item_count').notNull(),
    sourceBytes: bigint('source_bytes', { mode: 'number' }).notNull(),
    fileBytes: bigint('file_bytes', { mode: 'number' }).notNull(),
    stagedBytes: bigint('staged_bytes', { mode: 'number' }).notNull().default(0),
    reservedFileBytes: bigint('reserved_file_bytes', { mode: 'number' }).notNull().default(0),
    recoveryDigest: text('recovery_digest'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: ts('expires_at').notNull(),
    committedAt: ts('committed_at'),
  },
  (t) => [
    index('encryption_rotations_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('encryption_rotations_one_active')
      .on(t.userId)
      .where(sql`${t.phase} in ('preparing', 'migrating', 'ready')`),
    index('encryption_rotations_expiry_idx').on(t.expiresAt),
  ],
).enableRLS();

export const rotationItems = pgTable(
  'rotation_items',
  {
    operationId: text('operation_id')
      .notNull()
      .references(() => encryptionRotations.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<RotationKind>().notNull(),
    resourceId: text('resource_id').notNull(),
    parentId: text('parent_id'),
    sourceDigest: text('source_digest').notNull(),
    source: jsonb('source').$type<RotationCipherValue>(),
    replacement: jsonb('replacement').$type<RotationCipherValue>(),
    replacementDigest: text('replacement_digest'),
    verifiedDigest: text('verified_digest'),
    stageKey: text('stage_key'),
    stagedBytes: integer('staged_bytes').notNull().default(0),
    // File grant ownership is reserved durably before issuing any presigned URL.
    fileGrant: jsonb('file_grant').$type<{ key: string; bytes: number; checksum: string; iv: string }>(),
    grantExpiresAt: ts('grant_expires_at'),
    fileVerified: boolean('file_verified').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.operationId, t.kind, t.resourceId] })],
).enableRLS();

export const rotationCleanup = pgTable(
  'rotation_cleanup',
  {
    id: id(),
    operationId: text('operation_id')
      .notNull()
      .references(() => encryptionRotations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    objectKey: text('object_key').notNull(),
    reservedBytes: integer('reserved_bytes').notNull().default(0),
    notBefore: ts('not_before').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    completedAt: ts('completed_at'),
    /** When the object was last confirmed gone. A tombstone is only retired
     * once this is at or past the end of its re-check window, so a missed
     * sweep delays retirement instead of stranding a late-arriving object. */
    lastSweptAt: ts('last_swept_at'),
  },
  (t) => [
    uniqueIndex('rotation_cleanup_object_unique').on(t.objectKey),
    index('rotation_cleanup_due_idx').on(t.notBefore),
  ],
).enableRLS();
