# TOTP authenticator design

Status: proposed design for future development  
Recorded: 2026-09-02

Reviewed against PostgreSQL/Drizzle implementation: 2026-09-04  
Reviewed against the current codebase (auth, offline, storage, CSP, erase flows): 2026-09-05

## Summary

SigNote should add a dedicated **Authenticator** tab for storing and generating TOTP codes. OTP credentials are structured security records, not a rendering mode for Notes, Secrets, or Seals.

The core product contract is:

> OTP seeds are always end-to-end encrypted. On a new device, the existing SigNote encryption passphrase enrolls the authenticator. On a trusted device, OTPs remain available offline without keeping Secrets or Seals unlocked.

The server must never receive a plaintext seed or generate an OTP code. Seed parsing, QR scanning, encryption, decryption, and code generation all happen locally.

## Why OTP encryption needs a separate lifecycle

Authenticator availability and note-vault availability have different requirements:

- Secrets and Seals should retain their current short-lived MEK session and hard-lock behavior.
- Authenticator codes must remain quickly accessible and work after an app restart or while offline.
- Keeping the SigNote MEK alive merely to show OTP codes would weaken the effective lock policy of Secrets and Seals.
- Requiring the full encryption passphrase every five minutes would make the authenticator unpleasant and unreliable in practice.

Cloud encryption, device enrollment, and local app locking are separate concerns. They do not need to share the same session duration.

## Key hierarchy

Use the existing passphrase and MEK for enrollment and recovery, but derive a domain-separated OTP working key:

```text
Existing encryption passphrase
            |
            v
      Existing SigNote MEK
            |
            +-- verifyKey                 (key-verify:v1, the keyCheck)
            +-- secretBodyKey             (secret-body:v1)
            +-- sealWrapKey[sealId]       (seal-wrap:v1:<sealId>, one per seal)
            +-- fileEncKey                (file-enc:v1)
            +-- otpVaultKey               (otp-vault:v1, new)
```

Add `HKDF_INFO_OTP_VAULT = 'otp-vault:v1'` next to the other info strings in
`src/config/constants.ts` and a `deriveOtpVaultKey(mek)` in `src/lib/crypto.ts`
that goes through the existing `hkdfDeriveAesKey`. The MEK is imported with only
`deriveKey` usage, and `hkdfDeriveAesKey` already produces a non-extractable
AES-GCM key with `encrypt`/`decrypt`, which is exactly the shape the vault key
needs. No new primitive is required.

A passphrase change and a recovery-file restore both keep the MEK (they
recompute `serverShare = MEK XOR newDeviceShare`; see `change-passphrase` and
`recover` pages), so `otpVaultKey` and every enrolled device survive them.
Only an encryption-profile reset (`erase-encryption`) replaces the MEK.

The initial implementation should derive:

```text
otpVaultKey = HKDF(MEK, "otp-vault:v1")
```

`otpVaultKey` should be a non-extractable Web Crypto `CryptoKey` with only the usages required for OTP-record encryption and decryption.

Domain separation provides the important runtime boundary:

- Possession of `otpVaultKey` does not reveal the MEK.
- It cannot derive or replace `secretBodyKey`, `sealWrapKey`, or `fileEncKey`.
- An unlocked authenticator does not imply unlocked Secrets or Seals.
- Compromise of the MEK still compromises every derived domain, including OTP. This is expected when all domains share one passphrase and recovery root.

An independently random OTP master key wrapped by the MEK is a possible later evolution if independent key rotation or device-to-device enrollment requires it. It is not necessary for the first implementation.

## Separate runtime contexts

The OTP lifecycle must not be added to the existing `EncryptionContext` state.

```text
EncryptionContext
  `-- MEK: memory only
      `-- current Secrets/Seals lock behavior

OtpEncryptionContext
  `-- otpVaultKey: independently retained on a trusted device
      `-- authenticator-specific lock behavior
```

Enrollment may reconstruct the MEK briefly to derive `otpVaultKey`, but OTP code generation must not require the MEK afterward. The MEK reference should be discarded after derivation unless the user separately unlocked Secrets or Seals.

Locking Secrets and Seals must not lock the authenticator. Conversely, locking or removing the authenticator must not alter the note-vault key lifecycle.

## Trusted-device enrollment

On a new device:

1. The user signs in to SigNote while online.
2. If Secrets/Seals are already unlocked, or soft-locked with a device share in
   `sessionStorage`, SigNote reuses that MEK through `useEncryptionGuard.execute`
   and no passphrase prompt appears. Otherwise the user enters the passphrase
   once. (This means the Authenticator page lives under the `(vault)` layout so
   `EncryptionProvider` is available; see the review notes on layout.)
3. SigNote reconstructs the MEK.
4. SigNote derives `otpVaultKey` using the OTP HKDF domain.
5. The device stores `otpVaultKey` locally as a non-extractable `CryptoKey`,
   together with `{ userId, profileId, enrolledAt, deviceId }`, in a dedicated
   IndexedDB **database** (`signote-otp`). It must not be a new object store
   inside the existing `signote-offline` database: `src/lib/idb.ts` opens that
   database through `idb-keyval` at version 1, and a second store cannot be
   added without a version upgrade the current code does not perform.
6. The temporary MEK reference is discarded.
7. Encrypted OTP records are downloaded and cached locally in the same
   `signote-otp` database, never in the TanStack Query cache (see review notes:
   that cache is wiped on sign-out and on every app version bump).

On subsequent visits, the device loads `otpVaultKey` from IndexedDB. It can decrypt cached OTP records and generate codes without requesting the passphrase or contacting the server.

The UI should explicitly describe this as trusting the device for offline authenticator access.

## Offline and session behavior

Offline access is mandatory, not an enhancement. TOTP only needs a credential seed, its parameters, and an accurate local clock.

Authenticator availability must not depend on a current NextAuth session. Otherwise codes could become inaccessible when the network or identity provider is unavailable, or when the user needs a stored code to complete sign-in.

Required behavior:

| Event                                        | Authenticator behavior                                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network unavailable                          | Cached credentials continue generating codes                                                                                                                                             |
| Server session expires                       | Codes remain available; synchronization pauses                                                                                                                                           |
| Secrets/Seals hard-lock                      | Codes remain available                                                                                                                                                                   |
| Explicit authenticator lock                  | Follow the selected local lock policy                                                                                                                                                    |
| Explicit device removal                      | Delete the local OTP key and encrypted OTP cache                                                                                                                                         |
| Remote device revocation                     | Delete local material on the next successful connection                                                                                                                                  |
| Permanent offline device after revocation    | Cannot be remotely erased; document this limitation                                                                                                                                      |
| Desktop (Electron) app offline               | Out of scope for v1: the shell loads the remote origin and unregisters service workers, so nothing loads without a network. Codes remain available only while the window is already open |
| A different account signs in on this browser | Existing local vaults for other accounts are hidden and the user is offered removal; they are never shown to the new account                                                             |
| Encryption profile reset on any device       | Every device detects the profile-generation mismatch on its next successful sync and wipes its local vault                                                                               |

The application may need to distinguish between signing out of cloud synchronization and removing the local authenticator profile. An explicit "Sign out and remove this device" action must wipe the local OTP material.

## Local security modes

Every OTP record receives the same encryption. The modes below change only local key availability.

### Quick access

Recommended for personal, OS-protected devices:

- Persist `otpVaultKey` in IndexedDB.
- Work offline and after a browser or app restart.
- Do not request the encryption passphrase on a timer.
- Treat the user's unlocked OS/browser profile as the local security boundary.

### App lock

A future option:

- Keep the device enrolled, but require local device authentication before showing codes.
- Native applications should prefer the OS keychain and Face ID, Touch ID, or equivalent.
- The web/PWA version may use WebAuthn device verification where support and recovery behavior are adequate.
- Do not use a four-digit PIN directly as a cryptographic wrapping key; an offline attacker could brute-force it.

### Strict mode

An optional mode for shared or high-risk machines:

- Do not persist `otpVaultKey` across the selected lock boundary.
- Require the encryption passphrase to enroll or unlock again.
- This should not be the default authenticator experience.

## Web security boundary

Persisting a non-extractable `CryptoKey` is preferable to storing raw key bytes. It prevents ordinary JavaScript from exporting the key and avoids plaintext key material in application storage.

It is not equivalent to hardware-backed storage. It does not protect against:

- malicious JavaScript executing on the SigNote origin;
- a compromised browser extension;
- a person using an already-unlocked OS and browser profile;
- an attacker controlling the running application and asking the key to decrypt records.

The web/PWA threat model must state this clearly. Native clients can provide a stronger device boundary by using operating-system key storage.

## OTP record model

Authenticator records should have a dedicated model and tRPC router. Do not store them as note HTML.

The encrypted record should contain at least:

- type (`totp` initially; `hotp` later);
- issuer;
- account name;
- Base32 secret;
- algorithm (`SHA1`, `SHA256`, or `SHA512`);
- digits (normally 6 or 8);
- period (30 seconds by default);
- optional display metadata and notes.

The server-side PostgreSQL row should contain only the minimum synchronization metadata plus an opaque encrypted payload, for example:

- user ID;
- encrypted payload;
- position;
- schema/encryption version;
- creation and update timestamps;
- deletion state.

### PostgreSQL and Drizzle implementation

The database migration does not change the client-side encryption or offline-access contract. It does change how persistence, authorization, migrations, and synchronization should be implemented:

- Define a dedicated `otp_records` table in `src/db/schema.ts`, with a dedicated repository using `getDb()` from `src/db/client.ts`. Do not extend `makeTierRepo` or reuse `tierColumns`: those assume note behavior, including plaintext titles, search vectors, and note-specific expiry.
- Follow the existing ID convention: `TEXT` primary keys with UUIDv7 for new records, and a `TEXT` user ID. Treat IDs as opaque strings, not Mongo ObjectIds or PostgreSQL UUID columns. The existing note API's `_id` mapping is a compatibility layer; the new router exposes `id` and nothing else. Ids are **generated on the client** (`uuid` v7 is already a dependency) so a record can be encrypted with its id as AAD before it is ever sent, created offline, and retried idempotently; the server rejects a create whose id already exists.
- Store the AES-GCM envelope (`alg`, `iv`, `ciphertext`) in a non-null, typed `jsonb` column using `EncryptedPayload`. Keep payload-format/encryption version, position, timezone-aware creation/update timestamps, and nullable `deleted_at` as separate columns. Add a record revision for optimistic concurrency; format version and mutation revision have different purposes.
- Add user-scoped indexes for the chosen list/sync queries. Do not add plaintext issuer/account columns, a `search_tsv`, or full-text indexes: authenticator search remains local.
- Register a dedicated router in `src/server/routers/_app.ts`. Cloud operations use `protectedProcedure`, derive ownership from `ctx.userId`, and include it in every read/update/delete predicate. Validate envelope shape and size with Zod; a Drizzle JSON type alone is not runtime validation. Do not reuse the shared `encryptedPayload` schema from `src/server/schemas/common.ts`: its `MAX_CIPHER` cap is 750 KB, sized for note bodies. An OTP envelope is a few hundred bytes; cap the ciphertext at a few kilobytes and cap records per user (a few hundred) so the table cannot be used as free blob storage.
- Declare schema changes first, run `bun run db:generate`, and commit the generated migration. Apply migrations deliberately; app startup does not migrate. Append `ALTER TABLE "otp_records" ENABLE ROW LEVEL SECURITY;` by hand to the generated SQL, exactly as `0003` and `0005` do: drizzle-kit does not model RLS, and the `ensure_rls` event trigger from `0002` is only a safety net (its installation is skipped on `insufficient_privilege`). Confirm `anon`/`authenticated` have no grants or policies. Do not enable `FORCE ROW LEVEL SECURITY`: the application currently connects as the table owner, so application ownership checks remain essential.
- Bind each ciphertext to its row: encrypt with AAD `otp-record:v1:<id>` (the pattern `encryptSealBody` already uses with `getSealKeyString`). A stale or malicious server cannot then move a payload between rows or replay one record's ciphertext under another id.

### Synchronization and deletion rules

The v1 protocol is a **full snapshot**. An authenticator holds tens of records of a few hundred bytes each, so there is nothing to gain from an incremental feed and a lot of reconciliation logic to lose. Concretely:

- `otp.list` returns every non-purged row for the user, tombstones included (`id`, `revision`, `position`, `payload` or null when deleted, `deletedAt`, `updatedAt`). The client replaces its local cache with the snapshot. A record present locally but absent from the snapshot was purged server-side and is dropped locally.
- Every row carries an integer `revision` that advances on every write, including reorder and soft-delete. Do not copy note `updatedAt` behavior: note metadata changes intentionally leave it untouched. Timestamps are informational only, never a cursor.
- `create(id, payload, position)`: insert; if the id exists (live or tombstoned) throw `CONFLICT`.
- `update(id, expectedRevision, payload?, position?)` and `remove(id, expectedRevision)`: `UPDATE ... WHERE id = ? AND user_id = ? AND revision = ? AND deleted_at IS NULL RETURNING *`; zero rows is `CONFLICT`, and the response carries the current row so the client can re-apply or discard. A tombstone therefore always wins over a stale edit, which is what prevents a deleted credential from being resurrected.
- Soft-delete keeps the row as a tombstone with `payload = NULL` and bumps `revision`. Tombstones are purged 30 days after `deleted_at` by a **new, separate branch** in `src/controllers/cleanup.ts`; do not put `otp_records` in the existing one-hour note sweep. A client offline for longer than 30 days is handled by the snapshot rule above.
- v1 does not queue offline writes. Offline, the authenticator is read-only: creation, editing, reorder, and deletion require a live session and are disabled with a clear reason. Queued writes and merge rules are a separate scope decision.

Wire OTP data into account erasure and encryption-profile reset: add `eraseOtp(userId)` to `src/controllers/erase.ts`, an `erase.otp` procedure gated on `ALL_OR_ENC` in `src/server/routers/erase.ts`, and an `{ key: 'otp', label: 'Authenticator', requiresEncryptionProfile: true }` step to both `erase/page.tsx` and `erase-encryption/page.tsx` (placed before the `encryption` step). Nothing cascades from `users` today, so a missing step leaves orphaned ciphertext behind.

A destructive encryption reset must also invalidate every enrolled device. The mechanism is the **profile generation**: `createProfile` inserts a fresh `encryption_profiles` row with a new id on reset, while passphrase change and recovery update the existing row in place. Expose that id (as `profileId`) from `encryption.profile`, store it beside the local key at enrollment, and compare on every sync; a mismatch wipes the local key and cache and returns the device to the not-enrolled state. Local stores are keyed by `userId` as well, so one browser can hold vaults for several accounts without mixing them.

Trusted authenticator enrollment must outlive an ordinary auth session. Remote per-device revocation is **not in v1**; the only remote kill switch is the encryption-profile reset above, which is destructive and is documented as such. Generate a random `deviceId` at enrollment anyway and keep it in the local store, so a later `otp_devices` table (enrolled/last-seen/revoked, checked on sync) can be added without re-enrolling anyone. Do not hang enrollment off `auth_sessions`: expired rows are deleted by cleanup and `sessions.revoke` has session, not device, semantics.

A 401 on sync only pauses sync. Today every tRPC and ky client runs `handleUnauthorized`, which toasts, broadcasts a logout to every tab, and calls `signOut({ callbackUrl: '/' })`, navigating away from the authenticator. OTP sync therefore uses its own vanilla tRPC client built without `unauthorizedLink` (or an op-context flag the link honors), and the Authenticator page never redirects on `status === 'unauthenticated'`, unlike the other vault pages.

Issuer and account name should be encrypted because they reveal which services and identities the user has. Search should happen locally after decryption.

Generated codes must never be persisted. They are derived locally from the seed, configured parameters, and current Unix time.

## Product and import behavior

Add Authenticator as a separate top-level destination alongside Notes, Secrets, and Seals.

Initial input methods:

- scan a standard `otpauth://totp` QR code locally;
- paste an `otpauth://` URI;
- manually enter a Base32 seed and parameters.

QR images must never be uploaded to an external decoding service.

Three current settings block a camera scanner and must change with this feature:

- `next.config.ts` sends `Permissions-Policy: camera=()`, which disables
  `getUserMedia` for the app's own origin. Change it to `camera=(self)`.
- The desktop shell (`desktop/src/main.ts`) answers every permission request
  with `false`. Either allow `media` (video only) for the app origin, or accept
  that the desktop path is image-based: pick a screenshot file, or paste an
  image from the clipboard, and decode it locally. Ship the image path on all
  platforms regardless; it is the only path that works in Electron today and
  the most convenient one on a desktop browser.
- The production CSP is `script-src 'self' 'unsafe-inline'` with no
  `'wasm-unsafe-eval'` and no `worker-src`, so WASM decoders (zxing-wasm) and
  blob-URL workers fail silently. Use the native `BarcodeDetector` where present
  and a pure-JS decoder (jsQR or equivalent) as the fallback, loaded from a
  same-origin worker file rather than a blob.

An "Import into Authenticator" action may later parse an OTP URI or seed stored inside a Secret or Seal, create a structured OTP record, verify it, and then offer to delete the source. Ordinary plaintext Notes must not silently become OTP records.

All credentials should be encrypted equally. SigNote should not offer plaintext or "less secure" OTP tiers; convenience is controlled by the trusted-device policy instead.

## Sync, recovery, and export

Treat these as three distinct promises:

1. **Sync:** encrypted credentials follow the user across enrolled devices.
2. **Recovery:** the existing encryption passphrase and recovery mechanism can enroll a replacement device.
3. **Portability:** the user can leave SigNote and import credentials into another authenticator.

The current SigNote recovery file contains a `deviceShare`; it is not a complete portable backup of stored records. Authenticator development should include a separate complete encrypted export design.

Expected export support:

- individual `otpauth://` URI or QR export behind explicit confirmation;
- a password-encrypted, versioned full authenticator backup;
- eventual bulk import from common formats, including Google Authenticator migration exports and Ente Auth exports.

Plaintext exports expose every OTP seed and require prominent warnings and reauthentication.

## Initial development scope

The first useful release should include:

- dedicated Authenticator page and encrypted record model;
- `otpVaultKey` HKDF derivation;
- separate OTP encryption context and IndexedDB key store;
- encrypted offline record cache;
- trusted-device enrollment and removal;
- offline access independent of server-session validity (web and installed
  PWA; the desktop shell is deferred, see the review notes);
- standard TOTP with SHA-1, SHA-256, and SHA-512;
- 6- and 8-digit codes;
- configurable period, defaulting to 30 seconds;
- local QR scanning from camera and from an image file or pasted image, URI paste, and manual entry;
- countdown indicator and explicit copy action;
- individual portable export;
- RFC test vectors, time-boundary tests, leading-zero tests, and Base32 validation;
- database/repository tests using `src/test/db.ts` (PGlite with real Drizzle migrations), covering ownership isolation, revision conflicts, deletion reconciliation, and erasure/reset;
- browser tests covering in-session offline access (`context.setOffline`), session expiry, account switching, and explicit device removal; restart-and-reload offline access is covered by a separate Playwright project with service workers enabled, because `playwright.config.ts` blocks them for the main suite;
- unit tests for the local store using `fake-indexeddb` (to be added as a dev dependency) so persistence, account scoping, and profile-generation invalidation run without a browser;
- threat-model and recovery documentation updates.

Defer until later:

- HOTP, because its counter requires careful atomic multi-device synchronization;
- Google Authenticator migration QR bulk import;
- Ente and other bulk backup formats;
- issuer icons, taking care not to leak issuer metadata to third parties;
- native biometric and OS-keychain integration;
- independent OTP-key rotation and device-to-device key transfer.

## Codebase review: constraints, corner cases, and resolutions

Recorded 2026-09-05 against `main`. Each item names what the current code does and what the implementation must do about it.

### Runtime and layout

1. **Route placement.** Put the page at `src/app/(main)/(vault)/authenticator/page.tsx` so `EncryptionProvider` is in scope for enrollment. Consequences: add `/authenticator` to `NAV_LINKS` in `SidebarNav`, to `PAGES` in `SwipeNavWrapper` (swipe order), and to `HIDDEN_ON_ROUTES` in `LockFab`, whose lock button has Secrets/Seals semantics and would be misleading here. `AutoLockListener` may stay; it only touches the MEK.
2. **Signed-out rendering.** Every `(main)` page today renders `UnauthenticatedState` when `session.user.id` is missing, and `change-passphrase`/`recover`/`erase-*` redirect to `/` on `unauthenticated`. The Authenticator page does neither: if a local vault exists for any account, it renders it with a "sync paused, sign in to continue" banner; the sign-in card is shown only when no local vault exists. When signed out, `UnauthenticatedState` and the sidebar show an "Open authenticator" link if a local vault exists, because a stored code is often what the user needs to finish signing in.
3. **Which vault to show without a session.** IndexedDB is per origin, not per account. Keep `lastActiveUserId` in `localStorage`; offline with no session, show that account's vault, or the only one if exactly one exists, and a chooser otherwise.
4. **`useSession` going `unauthenticated` is not a removal signal.** It fires on real sign-out, on JWT expiry, and, in the desktop shell, simply on losing the network (no service worker caches `/api/auth/session` there). `SessionCleanup` deletes the persisted query cache on that transition; the OTP store must not subscribe to it. The only things that delete local OTP material are: explicit "remove from this device", the user accepting removal of another account's vault, and a profile-generation mismatch reported by an authenticated sync.
5. **Multi-tab.** The `signote-auth` `BroadcastChannel` already coordinates logout. Add an `otp-vault-removed` message so other tabs drop their in-memory `otpVaultKey` immediately; the IndexedDB deletion alone leaves an already-loaded tab working until reload.
6. **Offline page availability.** The service worker caches navigations `NetworkFirst` at runtime, so `/authenticator` is available offline only after it was visited once online. Either accept that (and say so on the enrollment screen) or add the route to the precache manifest. Note that the E2E suite blocks service workers entirely.

### Storage

7. **Separate IndexedDB database.** `signote-offline` is opened by `idb-keyval` at version 1 with a single `query-cache` store; nothing else fits in it without an upgrade path. Use `signote-otp` with two stores: `vaults` keyed by `userId` (`{ key: CryptoKey, profileId, deviceId, enrolledAt, serverTimeOffsetMs }`) and `records` keyed by `[userId, id]`.
8. **Never through the TanStack persister.** `QueryPersister` dehydrates every query into IndexedDB with `buster = NEXT_PUBLIC_APP_VERSION` (the cache is discarded on every deploy) and `SessionCleanup` removes it on `unauthenticated`. Both violate invariant 7. Fetch OTP records with the vanilla client and write them to the `records` store yourself; if any react-query key is used for the sync status, exclude it with `shouldDehydrateQuery`, as the comment in `QueryPersister` already anticipates.
9. **Browser eviction.** Safari removes script-writable storage, IndexedDB included, from sites not interacted with for seven days unless the app is installed to the Home Screen; private windows drop it on close; Chromium can evict under storage pressure. Call `navigator.storage.persist()` at enrollment, recommend installing the PWA on iOS, and treat a missing key as "this device needs enrolling again" rather than an error. The design cannot promise the key survives; it can promise the passphrase always re-enrolls.
10. **`CryptoKey` in IndexedDB.** Structured-clone storage of a non-extractable key works in current Chromium, Firefox, and WebKit, but WebKit had bugs here historically; include Safari and iOS Safari in the manual test matrix before release. There is no fallback that keeps the security property, so a failure to persist must surface as "quick access unavailable on this browser" rather than silently storing raw bytes.
11. **Shared browser, several accounts.** In quick-access mode the persisted key is usable by any script on the origin, so a second person signing into a different account on the same browser profile could, with developer tools, decrypt the first account's cached seeds. The plan's threat model already concedes the unlocked-profile boundary; make the product behavior match: when a sign-in resolves to a user with no local vault while vaults for other accounts exist, show a one-time prompt to remove them, defaulting to removal. The sign-out button's confirmation gains a checkbox "Also remove the authenticator from this device", unchecked by default.

### Encryption profile lifecycle

12. **Passphrase change and recovery keep the MEK**; verified in both pages, which compute `newServerShare = MEK XOR newDeviceShare`. No re-enrollment is needed and no code path should touch the OTP store there.
13. **Encryption reset creates a new profile id.** `encryption.profile` currently strips the id; add `profileId` to its response (the id is not secret). Enrollment stores it; every successful `otp.list` compares it. The `EncryptionSetup` component that creates a replacement profile should also clear any local vault for that user, so the device does not wait for a sync to notice.
14. **Enrollment needs the network** (`encryption.material` is server-side). Say so in the UI; there is no offline enrollment by design.

### Sync client

15. **Dedicated tRPC client.** Build it from `httpBatchLink` with the same session-client headers but without `unauthorizedLink`. On `UNAUTHORIZED` it sets a `syncState = 'signed-out'` flag and stops; nothing else. Legacy REST (`ky`) is not involved.
16. **Clock offset.** TOTP needs correct time, and a device that is minutes off produces codes that are silently rejected everywhere. On every successful sync, compute `serverTimeOffsetMs` from the response `Date` header (or a tiny `otp.time` procedure returning `Date.now()`), persist it in the vault record, and generate codes from `Date.now() + offset`. If `|offset|` exceeds half a period, show a persistent warning on the page. Never block generation on it.
17. **Read-only offline.** See the sync protocol: no queued writes in v1. The "new" and "delete" actions are disabled with a tooltip when `syncState !== 'online'`.

### Code generation and parsing

18. **Web Crypto covers everything.** `crypto.subtle` HMAC with `SHA-1`, `SHA-256`, and `SHA-512` reproduces every RFC 6238 Appendix B vector (checked in Node 20 during this review); no third-party TOTP library is needed. Implement `hotpFromHmac` and `totp` as pure functions over `Uint8Array` seeds so the unit tests can run under the existing `testEnvironment: 'node'`.
19. **Base32 tolerance.** Accept lowercase, embedded spaces and hyphens, and missing `=` padding, all of which appear in real setup screens; reject characters outside the RFC 4648 alphabet with a message that does not echo the input. Secrets shorter than 128 bits are common in the wild; accept them with a warning rather than refusing.
20. **`otpauth://` corner cases.** Label is `issuer:account` or just `account`, percent-encoded, sometimes with a space after the colon; the `issuer` query parameter wins over the label prefix when both exist; `algorithm` may be lowercase; `digits` may be 6, 7, or 8; `period` must be a positive integer, default 30; `counter` marks HOTP and is rejected in v1 with a specific message; `otpauth-migration://` (Google Authenticator export) is recognised and rejected with a "not yet supported" message rather than a parse error. Steam's 5-character alphanumeric codes are out of scope.
21. **Duplicate import.** Before creating, compare the decoded seed bytes plus issuer and account against the local cache and offer to keep the existing record.
22. **Display.** Pad to `digits` with leading zeros; tick once per second aligned to the period; show the remaining seconds; warn visually in the last five seconds. Copy uses the existing `useCopy` hook. Never render the seed after creation except behind the explicit export confirmation.

### Analytics and error reporting

23. **PostHog is initialised with autocapture and `capture_exceptions`** (`instrumentation-client.ts`). Autocapture sends the text content of clicked elements, so a tappable code or an issuer card would send codes and issuers to a third party, breaching invariant 2. Put `ph-no-capture` on the Authenticator page root (this also blocks session replay if it is ever enabled), capture only shape-level events (`otp_record_added` with `{ method: 'qr' | 'uri' | 'manual' }`), and make every parser error message constant text that never includes the input. Wrap the page in an error boundary so a thrown parse error cannot reach `captureException` with a URI in its message.

### Erase and reset flows

24. Covered above: `erase.otp` procedure, `eraseOtp` controller, and an `otp` step in both erase pages. Both flows already gate on a 15-minute scoped token; the OTP step uses `ALL_OR_ENC`.

### Testing against the current setup

25. **Unit tests** run under Jest with `testEnvironment: 'node'`, which has `crypto.subtle` but no IndexedDB. Add `fake-indexeddb` as a dev dependency and use a per-file `@jest-environment jsdom` docblock for the store tests, as the component tests in `src/components/**/__tests__` would.
26. **Repository tests** use `src/test/db.ts` (PGlite with the real migrations); `resetTestDb` truncates every `public` table, so `otp_records` is picked up automatically.
27. **E2E** blocks service workers (`serviceWorkers: 'block'`), so "close the browser, reopen offline" cannot be tested in the main suite. Cover in-session offline with `context.setOffline(true)` and persistence across reload with a second Playwright project that enables service workers, or accept manual coverage for that one case. Sign-in in tests goes through `tests/utils/signIn.ts`; enrollment can reuse `SecretsPage` helpers for the passphrase.

### Desktop shell

28. The Electron app loads the remote origin, unregisters service workers on start, and denies all permission requests. Offline authenticator use on desktop therefore needs one of: enabling the service worker in the shell, or bundling the client; both are separate projects. For v1 the desktop app gets the same page, image-based QR import, and codes for as long as the window stays open. Say this in the docs rather than implying parity.

### Documentation

29. `src/docs/` is the rendered documentation set. Add `13.authenticator.md`, extend `10.encryption.md`'s key-hierarchy section with `otpVaultKey`, and add an "Authenticator on a trusted device" subsection to `11.threat-model.md` covering the persisted-key boundary, the shared-browser case, and the desktop limitation. While there, `11.threat-model.md` still says "No recovery mechanism", which the recovery file made false.

## Security invariants

Implementation and review should preserve these invariants:

1. The server never receives plaintext OTP seeds or generated codes.
2. No OTP seed, URI, code, issuer, or account name enters logs, analytics, URLs, or error-report metadata.
3. An available `otpVaultKey` cannot decrypt Secrets, Seals, or files.
4. The Secrets/Seals lock timer does not depend on authenticator availability.
5. Offline OTP access does not require `serverShare`, `deviceShare`, or the MEK after enrollment.
6. Explicit device removal deletes the persisted OTP key and encrypted local cache.
7. Session expiry pauses synchronization without destroying access to locally enrolled codes.
8. OTP records are always encrypted regardless of their perceived importance.
9. Ordinary sign-out, JWT expiry, a 401 on sync, and loss of network never delete local OTP material. Only explicit removal, the user accepting removal of another account's vault, or a profile-generation mismatch reported by an authenticated sync do.
10. The Authenticator DOM is excluded from analytics capture, and no parser or sync error message ever contains user input.
11. Each ciphertext is bound to its record id through AAD; a payload cannot be replayed under another id.

## References

- [RFC 6238: TOTP](https://www.rfc-editor.org/rfc/rfc6238)
- [RFC 4226: HOTP](https://www.rfc-editor.org/rfc/rfc4226)
- [Google Authenticator Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)
- [Web Cryptography API: key storage](https://www.w3.org/TR/WebCryptoAPI/#concepts-key-storage)
- [Authy backup password and local device protection](https://help.twilio.com/articles/19753631509019)
- [Ente Auth](https://ente.io/auth/)
