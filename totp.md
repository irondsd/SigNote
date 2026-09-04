# TOTP authenticator design

Status: proposed design for future development  
Recorded: 2026-09-02

Reviewed against PostgreSQL/Drizzle implementation: 2026-09-04

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
            +-- secretBodyKey
            +-- sealWrapKey
            +-- fileEncKey
            +-- otpVaultKey
```

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
2. The user enters the existing encryption passphrase once.
3. SigNote reconstructs the MEK.
4. SigNote derives `otpVaultKey` using the OTP HKDF domain.
5. The device stores `otpVaultKey` locally as a non-extractable `CryptoKey` in a dedicated IndexedDB store.
6. The temporary MEK reference is discarded.
7. Encrypted OTP records are downloaded and cached locally.

On subsequent visits, the device loads `otpVaultKey` from IndexedDB. It can decrypt cached OTP records and generate codes without requesting the passphrase or contacting the server.

The UI should explicitly describe this as trusting the device for offline authenticator access.

## Offline and session behavior

Offline access is mandatory, not an enhancement. TOTP only needs a credential seed, its parameters, and an accurate local clock.

Authenticator availability must not depend on a current NextAuth session. Otherwise codes could become inaccessible when the network or identity provider is unavailable, or when the user needs a stored code to complete sign-in.

Required behavior:

| Event | Authenticator behavior |
| --- | --- |
| Network unavailable | Cached credentials continue generating codes |
| Server session expires | Codes remain available; synchronization pauses |
| Secrets/Seals hard-lock | Codes remain available |
| Explicit authenticator lock | Follow the selected local lock policy |
| Explicit device removal | Delete the local OTP key and encrypted OTP cache |
| Remote device revocation | Delete local material on the next successful connection |
| Permanent offline device after revocation | Cannot be remotely erased; document this limitation |

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
- Follow the existing ID convention: `TEXT` primary keys with UUIDv7 for new records, and a `TEXT` user ID. Treat IDs as opaque strings, not Mongo ObjectIds or PostgreSQL UUID columns. The existing note API's `_id` mapping is a compatibility layer; choose and document the new router's ID field explicitly.
- Store the AES-GCM envelope (`alg`, `iv`, `ciphertext`) in a non-null, typed `jsonb` column using `EncryptedPayload`. Keep payload-format/encryption version, position, timezone-aware creation/update timestamps, and nullable `deleted_at` as separate columns. Add a record revision for optimistic concurrency; format version and mutation revision have different purposes.
- Add user-scoped indexes for the chosen list/sync queries. Do not add plaintext issuer/account columns, a `search_tsv`, or full-text indexes: authenticator search remains local.
- Register a dedicated router in `src/server/routers/_app.ts`. Cloud operations use `protectedProcedure`, derive ownership from `ctx.userId`, and include it in every read/update/delete predicate. Validate envelope shape and size with Zod; a Drizzle JSON type alone is not runtime validation.
- Declare schema changes first, run `bun run db:generate`, and commit the generated migration. Apply migrations deliberately; app startup does not migrate. Verify RLS is enabled on every new public table and that `anon`/`authenticated` have no grants or policies. The existing `ensure_rls` trigger is a safety net, but its installation can be skipped for insufficient privileges. Do not enable `FORCE ROW LEVEL SECURITY`: the application currently connects as the table owner, so application ownership checks remain essential.

### Synchronization and deletion rules

Define the sync protocol before implementing persistence. A record revision should advance atomically on every synchronized change, including reorder and deletion; writes should compare the expected revision and report conflicts. Do not copy note `updatedAt` behavior: note metadata changes intentionally leave it untouched. Timestamps alone must not be treated as a lossless incremental-sync cursor; choose a consistent full-snapshot protocol or design a change feed with explicit cursor and resync semantics.

Postgres has no TTL cleanup. `src/controllers/cleanup.ts` currently purges soft-deleted notes after an hour; do not add OTP records to that sweep. Offline clients need deletion tombstones or an authoritative full resync to discover removals. Define retention and stale-client recovery before purging tombstones, and prevent a stale write from resurrecting a deleted credential. Offline code generation is required; offline editing and queued-write conflict handling need a separate scope decision.

Wire OTP data into account erasure and encryption-profile reset through `src/controllers/erase.ts` and `src/server/routers/erase.ts`. Current user ownership columns do not generally provide automatic user-delete cascades. A destructive encryption reset must remove associated OTP ciphertext and invalidate device enrollment; distinguish it from a passphrase change that preserves the MEK. Local stores must be scoped to the account and encryption-profile generation so old keys and caches cannot be reused after account switching or reset.

Trusted authenticator enrollment must outlive an ordinary auth session. If remote device revocation ships, give it durable enrollment/revocation state rather than relying solely on `auth_sessions`, whose expired rows are removed by cleanup. Define an authenticated revocation check after reconnection or reauthentication. A generic 401 cannot distinguish expiry from revocation and must only pause sync, not wipe the offline vault. Review the shared sign-out path triggered by `src/lib/trpcLinks.ts` so the local authenticator remains reachable without a valid cloud session.

Issuer and account name should be encrypted because they reveal which services and identities the user has. Search should happen locally after decryption.

Generated codes must never be persisted. They are derived locally from the seed, configured parameters, and current Unix time.

## Product and import behavior

Add Authenticator as a separate top-level destination alongside Notes, Secrets, and Seals.

Initial input methods:

- scan a standard `otpauth://totp` QR code locally;
- paste an `otpauth://` URI;
- manually enter a Base32 seed and parameters.

QR images must never be uploaded to an external decoding service.

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
- offline access independent of server-session validity;
- standard TOTP with SHA-1, SHA-256, and SHA-512;
- 6- and 8-digit codes;
- configurable period, defaulting to 30 seconds;
- local QR scanning, URI paste, and manual entry;
- countdown indicator and explicit copy action;
- individual portable export;
- RFC test vectors, time-boundary tests, leading-zero tests, and Base32 validation;
- database/repository tests using `src/test/db.ts` (PGlite with real Drizzle migrations), covering ownership isolation, revision conflicts, deletion reconciliation, and erasure/reset;
- browser tests covering restart/offline access, session expiry, account switching, and explicit device removal;
- threat-model and recovery documentation updates.

Defer until later:

- HOTP, because its counter requires careful atomic multi-device synchronization;
- Google Authenticator migration QR bulk import;
- Ente and other bulk backup formats;
- issuer icons, taking care not to leak issuer metadata to third parties;
- native biometric and OS-keychain integration;
- independent OTP-key rotation and device-to-device key transfer.

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

## References

- [RFC 6238: TOTP](https://www.rfc-editor.org/rfc/rfc6238)
- [RFC 4226: HOTP](https://www.rfc-editor.org/rfc/rfc4226)
- [Google Authenticator Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)
- [Web Cryptography API: key storage](https://www.w3.org/TR/WebCryptoAPI/#concepts-key-storage)
- [Authy backup password and local device protection](https://help.twilio.com/articles/19753631509019)
- [Ente Auth](https://ente.io/auth/)
