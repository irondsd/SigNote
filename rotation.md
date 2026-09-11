# Full encryption-key rotation

Status: parts 1 and 2 complete locally. Production verification and release
qualification are part 3. New rotations default to disabled.

## Three-part delivery plan

### Part 1 — primitives, backend, and backend tests

Include the disposable deployment feasibility spike (gate 0) in this part. Settle
measured limits and immutable storage behavior before generating the application
staging schema. Build independently testable crypto and backend integrity
primitives while deployment access is being arranged.

Deliver generation/session-epoch infrastructure, transactional fencing of all
affected writers and cleanup, durable inventory/staging/state transitions,
idempotency, ownership/takeover, direct file transfer and verification, atomic
activation, recovery-generation validation, and cleanup. Cover these with real
crypto tests, PGlite transaction/controller tests, and native PostgreSQL race tests.
Keep rotation unavailable to clients until compatibility and release gates pass.

Part 1 is complete only when the durable backend and its tests are implemented;
standalone helpers and a local benchmark do not satisfy that milestone. Run
focused tests and lint during implementation; defer broad release validation to
part 3, not the tests needed to establish correctness of each change.

### Part 2 — frontend, wizard, and E2E tests

Implement the dedicated non-batching client, generation-aware stores and Auth
re-enrollment, service-worker compatibility, draft/tab readiness, credential and
recovery-file steps, bounded worker processing, progress, pause/resume/takeover,
and post-commit reconciliation. Build the wizard on the tested part-1 backend.
Add the Playwright page object, durable storage harness, and full rotation/fault
scenarios specified below. Do not enable the feature just because the UI exists.

### Part 3 — verification, validation, and corrections

Run the full unit/E2E/desktop suites and production build; exercise the real
production service worker, desktop/PWA flows, browser-loss and lost-response
recovery, storage races, resource limits, and deployment timeouts. Correct failures
and rerun affected checks. Record supported bounds and complete the independent
security/data-integrity review before controlled enablement. This phase verifies
the integrated feature; it does not postpone part-1 transaction tests or part-2
E2E implementation.

### Part 1 progress — 2026-09-10

- Implemented independent crypto primitives in `src/lib/rotation/crypto.ts`:
  fresh production-policy material, online-material reconstruction, Secret/Auth/
  Seal body replacement, durable-wrapper-based Seal resume, binary file
  replacement, and staged read-back comparisons. They perform no persistence or
  active-vault writes. Fixed large-buffer base64 encoding in `src/lib/crypto.ts`.
- Implemented pure backend checks in `src/server/rotation/integrity.ts`: exact
  manifest equality, source/replacement verification digests, exact-byte retry
  binding, explicit aggregate byte budgets, and UTF-8 byte-bounded page assembly.
  These are not an authorization layer, database fence, or durable backend.
- Added real Web Crypto and backend integrity unit tests. Frontend, wizard, and
  E2E implementation have not started.
- Ran `scripts/rotation-spike.ts` against a fresh local PostgreSQL 18.4 cluster.
  It ignores configured database URLs and deletes its cluster on completion.
  Synthetic random base64 bodies avoid misleading compression of repeated text.
  Both layouts passed an injected transaction rollback check.

Local single-run baseline (milliseconds, not production limits):

| Source rows × characters | Layout         | Stage | Atomic replacement | Cleanup/vacuum |
| ------------------------ | -------------- | ----: | -----------------: | -------------: |
| 100 × 1,024              | Separate table |  22.7 |                2.2 |            4.4 |
| 100 × 1,024              | Pending column |  15.3 |                1.5 |            4.0 |
| 500 × 65,536             | Separate table | 273.4 |              220.3 |           25.6 |
| 500 × 65,536             | Pending column | 252.0 |              234.8 |           18.5 |
| 100 × 750,000            | Separate table | 450.5 |              552.8 |           62.8 |
| 100 × 750,000            | Pending column | 386.2 |              599.2 |          110.9 |

At 75 MB of source ciphertext, the separate-table run held approximately 233.7 MB
across active and staged relations immediately after replacement. Pending columns
held approximately 233.6 MB. Ordinary vacuum did not return most active-relation
space to the filesystem. WAL totals include the injected rollback and must not be
treated as clean commit-only measurements. This simplified schema lacks the real
vault's indexes, relationships, file pointers, concurrency, and verification work.
Local statement/lock/idle-transaction timeouts were all zero; prepared statements
were disabled. No deployed timeout, pooler, browser, or object-store claims follow
from this run. Raw results: `scripts/rotation-spike.local.json`.

### Deployment spike progress — 2026-09-10

Vercel authentication is now working. Read-only project/deployment inspection
confirmed SigNote's Pro plan, Node 24 configuration, Fluid Compute, and `iad1`
region. Preview protection is `all_except_custom_domains`. The project configures
`DATABASE_URL` for production only; storage credentials are shared across preview
and production. No disposable database or bucket has been identified yet.

Deployed a synthetic-only protected preview under the same project, containing
no application imports, database calls, storage calls, or credential reads beyond
the runtime's Node/region/memory metadata. The probe used an explicit 30-second
maximum duration. The production deployment was not promoted or replaced.

| Probe                                             | Result                                                |
| ------------------------------------------------- | ----------------------------------------------------- |
| Runtime                                           | Node `v24.19.0`, region `iad1`                        |
| Request body: 3,500,000 / 4,400,000 bytes         | 200; handler received the exact byte counts           |
| Request body: 4,800,000 / 5,242,880 bytes         | 413 `FUNCTION_PAYLOAD_TOO_LARGE`                      |
| Response body: all four sizes above               | 200; downloaded byte counts matched                   |
| 5-second operation                                | 200 after 5.35 seconds total                          |
| 35-second operation with configured 30-second cap | 504 `FUNCTION_INVOCATION_TIMEOUT` after 30.28 seconds |

These are measured preview results, not an inferred production timeout or a
qualification of the future Next.js/tRPC handler. In particular, this Node
handler delivered responses above Vercel's documented 4.5 MB function-payload
limit; preserve explicit JSON response budgets and test the actual rotation
transport instead of assuming that behavior applies to it. The request results
confirm that a 5 MiB upload cannot use this app-server transport. See
[Vercel function limits](https://vercel.com/docs/functions/limitations).

A **3,000,000-byte serialized request/response budget is a transport candidate**
with headroom below the successful request probes. It is not yet a configured
backend limit: database/staging limits and actual endpoint envelopes remain
unqualified. The 30-second cap was chosen for a bounded timeout experiment, not
as the final activation deadline. No application-specific duration or memory
default was established by the project metadata.

Raw sanitized results: `scripts/rotation-spike.vercel.json`. Recreate the isolated
fixture with `bun scripts/rotation-transport-fixture.mjs`; it writes only to a new
temporary directory and does not deploy automatically. Deploy only as a protected
preview, use `vercel curl` for authenticated probes, and remove the specific
disposable deployment afterward. The measured preview's ID is recorded in the
results; its probe code is never added to the application API tree.

### Docker PostgreSQL and MinIO — 2026-09-10

The user authorized local Docker PostgreSQL and an isolated MinIO service for
part-1 development. External test-resource provisioning is no longer blocking
that work. Production-provider validation remains a rollout gate.

`bun run rotation:local:up` starts the resources. PostgreSQL tests create and
remove uniquely named databases on the existing loopback port 5434; they never
use the development vault or an ambient database URL. The dedicated MinIO
service uses a pinned image, its own persistent volume, loopback ports 9100/9101,
and the private `signote-rotation-test` bucket. App AWS credentials are not used.
See `tests/rotation/README.md` for commands and local access details.

The Docker layout comparison passed all injected rollback checks. At 75 MB of
source ciphertext, separate-table activation took 582.1 ms; pending-column
activation took 461.3 ms in this single local run. Keep separate staging tables
as the development design for source isolation; this is not a claim that they
are always faster. Raw measurements: `scripts/rotation-spike.docker.json`.

A second disposable database applied the real app migrations and exercised two
independent clients. The account/profile row lock blocked the competing writer;
the next inventory saw the completed prior write, including retained archived/
expired data. An injected SQL statement timeout rolled back both profile and
ciphertext changes. A successful replacement preserved other columns. These
tests establish the transaction primitive, not the complete rotation controller.
Results: `scripts/rotation-spike.locks.json`.

**Migration correction discovered by the spike:** `0001_lock_down_public_schema`
and `0002_harden_rls_auto_enable` are not registered in Drizzle's journal. A
fresh rebuild therefore left 17 original tables without RLS, contrary to the
earlier assumptions in this plan. All 23 schema tables now explicitly call
`.enableRLS()`, and Drizzle generated `0008_explicit_table_rls.sql` to apply that
declaration. The filename prefix comes from the journal index; journal order is
authoritative. No old migration was rewritten and no FORCE RLS was added. The
generated migration passed fresh Docker/PGlite checks. A non-owner granted SELECT
sees no rows; the owner still operates normally. This migration has not been
applied to production or the existing development vault.

The reusable `src/server/rotation/objectStore.ts` adapter passed real signed
transfers against MinIO at 16 bytes, 1 KiB, and 5 MiB:

- An accepted object's old PUT grant returns 412 rather than overwriting it.
- Removing the signed conditional header or changing signed length returns 403.
- Incorrect SHA-256 returns 400; expired upload grants return 403.
- Server verification checks origin bytes and checksum metadata, not ETags.
- Signed read-back returns exact bytes and `private, no-store`.
- Localhost browser CORS works; accepted objects survive a container restart.
- Test cleanup waits for issued PUT grants to expire and removes only owned
  test objects. The persistent test bucket remains available.

Conditional create plus signed length/checksum is the local development storage
strategy. The production provider must pass equivalent checks before enablement.
The adapter is internal: it does not supply controller authorization, worker/
generation fencing, durable receipts, quotas, or active-reference cleanup checks.
Results: `scripts/rotation-spike.minio.json`.

### Full local backend — 2026-09-11

The user explicitly approved finishing part 1 using Docker PostgreSQL and MinIO.
This supersedes the original requirement to qualify Supabase/storage deployment
settings before the development staging schema. Production qualification still
blocks enablement in part 3; no production database or bucket was mutated.

Implemented `encryption_states`, `encryption_rotations`, `rotation_items`, and
`rotation_cleanup` with generated migrations and explicit RLS/default-deny.
Account row locks and request-scoped transactions serialize ordinary mutations,
session revocation, rotation inventory/activation, and cleanup. Session epochs
are immutable signed claims; initial new sign-in clears the revoke-all prerequisite,
even before an audit row exists. Epoch checks precede lazy row creation.

`src/server/rotation/service.ts` supplies durable begin/status/inventory/stage/
verify, public recovery acknowledgement, pause/claim/cancel, file grants and
read-back, atomic activation, expiry, and retryable cleanup. Every nonterminal
worker operation checks account/session ownership, generation, worker fence,
expiry and the sole-session prerequisite. Committed retries return the receipt
without requiring obsolete objects. Source metadata fingerprints are rechecked
inside activation. Replacement updates preserve IDs, history sequence, metadata,
and plaintext data; Auth revisions advance once. No object-store operation runs
inside activation. Ordinary uploads and physical cleanup retain the account
lock during storage I/O to serialize their pointer publication/deletion.

Recovery v1 parsing remains compatible; the v2 pending file binds account,
profile, operation and target generation. Its device share and cryptographic
verification stay local. The backend receives only public binding acknowledgement,
never a recovery file, device share, passphrase, key or plaintext verification hash.

Development limits (checked before accepting more work):

| Resource                                                          |                          Bound |
| ----------------------------------------------------------------- | -----------------------------: |
| Retained inventory entries, including versions/wrappers/files     |                            500 |
| Serialized source ciphertext                                      |                         32 MiB |
| Serialized replacement ciphertext                                 |                         48 MiB |
| Encrypted source files total                                      |                        100 MiB |
| One encrypted object, including GCM tag                           |                          5 MiB |
| Outstanding temporary file reservations across account operations |                        200 MiB |
| Individual rotation HTTP request/response                         |                3,000,000 bytes |
| Signed grant                                                      |                     60 seconds |
| Cleanup grace after last issued upload grant                      |          additional 60 seconds |
| Inactive staging retention                                        | 7 days since accepted progress |

Cancellation does not reset temporary storage charges. Cleanup frees those charges
only after deleting eligible unreferenced objects; commit transfers the replacement
charge to its obsolete source object until that object is reclaimed. The daily
storage cron expires abandoned operations before ordinary cleanup. Active staging
is never purged simply because a note becomes expired. Status/begin also resolve
expired work; the daily cadence can defer automatic reclamation by another day,
and provider failure can delay it further. Receipts remain available after cleanup. Completed object tombstones are
re-swept daily with active-reference checks: expiry of a signed URL does not
necessarily stop an upload body already in flight. A late-created cancelled
object is reclaimed on a later sweep, without releasing its reservation twice.
The 200 MiB bound limits outstanding reservations; it is not a hard instantaneous
provider-capacity guarantee during late transfers or provider deletion failures.

The HTTP backend rejects batched rotation calls and caps streamed input. Ordinary
encrypted snapshots and mutations carry generation metadata; clients must send
`x-signote-encryption-generation` after generation zero. Legacy missing-generation
requests fail with a conflict after activation. Part 2 must implement generation
reconciliation, dedicated transport, service-worker rules and compatible readers
before enabling the flag. Disabling the flag blocks only new operations.

`bun run rotation:local:integration` applies real migrations to an owned database
and runs the actual service against MinIO. A 500-entry run contained 30,762,760
serialized source bytes and twenty 5,242,880-byte encrypted objects (100 MiB total). It paginated into
11 responses under the transport budget. Native races cover a pre-existing writer,
concurrent stage budgets, claims, commit/cancel/cleanup, durable commit retries,
stale generation writes and delayed PUT after cancellation. The aggregate test
process includes client crypto, source/replacement fixtures and the server; its
RSS is not a serverless memory qualification. Raw timing/resource results are in
`scripts/rotation-spike.integration.json`. Supabase transaction-mode reuse,
production timeouts/memory, provider CORS/immutability and full browser loss remain
part-3 gates. Part 2's wizard and E2E implementation have not started.

Part-1 validation: full Jest suite (75 suites, 781 tests), ESLint/TypeScript,
and the real PostgreSQL/MinIO integration pass. Tests include mixed-tier plaintext
preservation, all activation rollback checkpoints, generation/session rejection,
controller/cleanup fences, streamed HTTP limits, recovery binding, quota retention,
and repeated late-object reclamation. Account erasure retains an epoch tombstone
and revokes all sessions, preventing old tokens from becoming valid again.
Generated migrations were applied only to disposable test databases. No production
migration, feature enablement, frontend change, or release qualification is implied.

### Part 2 progress — 2026-09-11

Frontend, wizard and E2E are implemented. The feature remains disabled by
default; `ENCRYPTION_ROTATION_ENABLED` is set only for the E2E run, never in a
checked-in environment file.

**Generation-aware clients.** `src/lib/encryptionGeneration.ts` keeps the
account's generation and persists it as a marker whose `reconciled: false`
survives a crash mid-purge. `encryption.generation` is the one ungated read, so
a device with no marker can learn the number instead of deadlocking on a check
it cannot pass; it carries no pending material. `generationLink` retries only
for a device that had nothing to invalidate — a device that recorded N and is
told N+1 never replays, because a mutation would push old-MEK ciphertext into
the new vault and a query would fetch rows it cannot decrypt. It records and
broadcasts instead, and `encryptionReconcile.ts` drops the device share, the
cached `serverShare`, the Authenticator vault, encrypted drafts, the persisted
query cache and the HTTP caches, completing the marker last.

**Service worker.** Rotation, encryption, encrypted-tier and OTP procedures,
`/api/files` and signed storage transfers are claimed NetworkOnly before
`defaultCache`, and inherited entries are swept on activation. Plaintext Notes
keep their offline reads: their rows hold no ciphertext, so a stale page is out
of date rather than undecryptable. **The file-route offline change is real:** an
attachment opened offline now fails instead of being served from a cache that
may predate a rotation.

**Transport.** `src/lib/rotation/client.ts` does not batch, counts bytes in both
directions, and does not attach the global `unauthorizedLink`. A real 401 still
stops everything, but the rotation's own code does it, keeping the durable
operation identity for resume. Retries are bounded and apply to network and
server faults only.

**Engine.** `src/lib/rotation/engine.ts` walks the frozen inventory, stages,
reads the staged ciphertext back and proves it decrypts to the same plaintext,
then acknowledges it with an independently computed digest (`digest.ts` matches
the server's byte for byte, asserted directly against it). Memory is bounded per
item. Seal wrappers sort _after_ their bodies, so the walk is two passes and the
second re-reads only the Seal range. An item the server already accepted is
never re-encrypted, which is what keeps a half-processed Seal on one NEK.

**Wizard.** `src/lib/rotation/wizard.ts` holds every rule with no React in it;
`src/app/(main)/(vault)/rotate-keys/page.tsx` renders it. Prerequisites are
re-checked rather than remembered, and the server checks them again in `begin`.
Resuming reopens the operation's _pending_ material with the passphrase chosen
when the rotation started — minting fresh material would produce a key that
opens nothing already staged — and goes back through the prerequisites, because
signing in again clears the server's record of which session owns the operation.
Continuing then claims it, advancing the fence. Only messages the wizard wrote
are shown verbatim; everything else is translated.

**Authenticator.** Enrollment is now bound to the generation as well as the
profile id, because a rotation deliberately keeps the id stable. An enrollment
predating the field is adopted only at generation zero and treated as dead
otherwise.

E2E: `tests/pages/RotationPage.ts` plus `rotation`, `rotation-resume`,
`rotation-concurrency` and `rotation-files` specs — 23 scenarios. The recovery
step is a genuine download-and-reselect round trip. The object store models
conditional create, checksum binding on write and on `HeadObject`, CORS, restart
persistence and fault injection over a control path that exists only in the test
run. Assertions compare decrypted plaintext, file bytes and preserved metadata.

Four real bugs surfaced, none of which unit tests could have caught alone:

- The rotation route rebuilt its bounded-body request with `new Request(req, …)`,
  which throws `Cannot read private member #state` on a `NextRequest`. Node's own
  `Request` survives that call, so only a real Next runtime reproduces it.
- The CSP blocked every signed storage transfer. `connect-src https:` covers a
  real bucket but not a configured S3-compatible endpoint, so the origin from
  `AWS_S3_ENDPOINT` is now named explicitly — the mirror image of the CORS rules
  the transfers already needed.
- `encryption.profile` read the generation under the snapshot lock and dropped
  it on the way out, so every enrolled Authenticator compared against `undefined`
  and wiped itself. Router-level PGlite tests now assert the wire contract.
- Storage transfers were called outside the retry wrapper, so a provider hiccup
  on a multi-megabyte body was handed straight to the user.

Validation: full Jest suite, ESLint/TypeScript, and the full Playwright suite
(526 passing) against a production build. `tests/specs/account-linking.spec.ts:246`
flakes at roughly one run in four; it was verified to flake identically on a
worktree at `5df53d2`, before any part-2 work, and is tracked separately.

Not yet done, and carried into part 3: service-worker behaviour against a real
controlling worker (Playwright blocks registration, so the current specs prove
nothing about it), desktop/PWA smoke, oversized-request and 413 handling end to
end, runs at the documented 500-item and 100 MiB bounds, storage-restart
persistence as a spec rather than a harness capability, and everything under
"Validation and release gates" below.

## Goal and decisions

Provide an advanced, deliberate, multi-step operation that replaces the MEK,
all derived working keys, and every Seal's random note encryption key (NEK).
Re-encrypt all retained encrypted content, including historical versions and
attachments. Preserve plaintext Notes and the logical identity and metadata of
all records. Ordinary passphrase change remains available and preserves the MEK.

Accepted product decisions:

- Require the user to revoke all other sessions, then verify that only the
  initiating session remains before proceeding. Be extremely clear why it's
  necessary to proceed. This applies to all steps.
- Require local drafts and pending saves/uploads to be resolved or discarded.
  Warn the user to inspect other devices and explicitly acknowledge that
  remaining encrypted drafts there will become unrecoverable through the app.
- Verify the current passphrase, then collect and confirm a replacement. Permit
  the same passphrase, recommend a different one, and always generate a fresh salt.
- Recommend a laptop or desktop connected to power and a stable network.
- Show a wizard with explicit prerequisite actions, acknowledgements, and
  individual progress steps. Every network step must support safe retries.
- Require a fresh recovery file for the new encryption generation.

“Unrecoverable drafts” is an application guarantee, not remote erasure: another
device may still possess old keys and ciphertext while offline. Rotation cannot
revoke data or TOTP seeds already copied. TOTP setup secrets themselves do not
change; replacing them requires re-enrollment at their respective services.

## Safety contract

**An interruption must never leave the active vault partially rotated.** Network
loss, browser termination, sleep, power loss, session expiry, server restart, and
an ambiguous commit response are expected failure modes, not accepted data-loss
cases. The user warning must not excuse an in-place, partially destructive migration.

Create replacement ciphertext separately. Keep the old profile, rows, and file
objects usable until every replacement is durable and verified. Activate all
replacement rows and file pointers with the new profile in one database
transaction. No S3 operation belongs inside that transaction.

Before commit, cancellation preserves the old vault and old passphrase. After
commit, the new passphrase is authoritative and the old generation is never
silently restored. If commit acknowledgement is lost, query durable status before
choosing either path. Session revocation and explicitly discarded drafts are not
undone by cancellation.

Do not persist plaintext, raw MEKs/NEKs, passphrases, or a bridge that wraps the new
MEK under the old MEK. Such a bridge would let an old-key holder obtain the new key.
Recovery must work without browser memory, localStorage, or IndexedDB surviving.

## Existing implementation and implications

Relevant code to revisit during implementation:

| Area              | Existing files / behavior                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Crypto            | `src/lib/crypto.ts`: PBKDF2 deviceShare; MEK = deviceShare XOR serverShare; HKDF working keys; AES-GCM                                        |
| Passphrase change | `src/app/(main)/(vault)/change-passphrase/page.tsx`: fresh salt and both shares, unchanged MEK                                                |
| Profile           | `src/controllers/encryptionProfiles.ts`, `src/server/routers/encryption.ts`: current update has no rotation concurrency fence                 |
| Notes/history     | `src/db/tier.ts`, `src/db/tiers.ts`, `src/db/schema.ts`: version insertion order is `seq`, not timestamps                                     |
| Sessions          | `src/controllers/authSessions.ts`, `src/lib/routeAuth.ts`, `src/lib/desktopSession.ts`, `src/server/routers/sessions.ts`                      |
| Authenticator     | `src/contexts/OtpVaultContext.tsx`, `src/lib/otpStore.ts`, `src/controllers/otpRecords.ts`: cached derived key and profile-ID reset detection |
| Offline unlock    | `src/lib/encryptionMaterialStore.ts`, `src/contexts/EncryptionContext.tsx`                                                                    |
| Drafts            | `src/lib/draft.ts`, `src/hooks/useDraftRecovery.ts`: encrypted local checkpoints and pending work                                             |
| Files             | `src/controllers/files.ts`, `src/app/api/files/`, `src/lib/s3.ts`                                                                             |
| Recovery          | `src/lib/recoveryBackup.ts`, recovery and backup-recovery pages                                                                               |
| Cleanup           | `src/controllers/cleanup.ts`, orphaned-file cleanup, storage service route                                                                    |

The current “NEK never rotates” rule protects history during ordinary edits. Add a
rotation-only exception that replaces the parent wrapper and every version body
together. Never route rotation through ordinary save/version APIs: these compress
history, enforce version caps, update content timestamps, and may trigger side effects.

Current file limits are 5 MiB per uploaded object and 100 MiB logical account
storage (`src/config/fileConstants.ts`). Estimate transfer from the actual
inventory: download + replacement upload + verification download, approximately
three times encrypted bytes for the proposed full read-back check. Retries add
traffic. Temporary storage includes old and replacement objects; retained deleted
objects may exceed the live quota. Do not promise a hard 100 MiB migration bound.

Session verification already rejects missing `sid` in `authenticateRequest` and
`isSessionUnusable`, including NextAuth's session endpoint. Do not describe this
closed gap as an outstanding bug. A valid signed token with a sid but no audit row
is still accepted for lazy session creation; this is a separate revocation concern.

Read the installed Next.js guides before writing framework code. Generate schema
migrations from Drizzle; do not hand-write migrations. Verify RLS/default-deny on
all new tables, without FORCE ROW LEVEL SECURITY.

## Gate 0: deployment feasibility before implementation

Before committing to the staging schema or wizard, run a disposable synthetic-data
spike against a representative deployment. Inspect actual function duration,
request/response limits, database statement/transaction timeouts, pooler behavior,
and storage capabilities; do not infer account-specific settings from defaults.
No production user data or production fault injection is needed. Record benchmark
results, selected limits, and provider settings in this document before implementation;
these measurements have not been performed as part of this planning revision.

- `MAX_CIPHER` is 750,000 base64-string characters per payload, not 750 KiB of raw
  plaintext; `MAX_VERSIONS` is 10, but account note count is not capped. Measure
  inventory bytes, staging amplification, indexes/TOAST/WAL, commit time, lock
  duration, cleanup/vacuum cost, and temporary DB capacity at increasing sizes.
- Set explicit server-enforced limits on source ciphertext bytes, staged bytes,
  record/version count, request/response bytes, file bytes, and active operation
  storage. Derive limits from measurements with headroom; recheck under the begin
  lock before creating staging. Oversized vaults get an explanation before work,
  not an operation that later cannot commit. Stream/page the inventory itself.
- Default to separate staging tables for isolation, ownership constraints, and
  cleanup. Compare against pending columns only in this spike. Pending columns
  still rewrite active rows, generate WAL, and require an atomic bulk update;
  fewer joins do not by themselves solve transaction size or table bloat.
- If bounded atomic row replacement is not acceptable for supported vault sizes,
  select versioned ciphertext datasets with an atomic active-generation pointer
  before implementation. Include version and file references in that design;
  never relax atomicity to fit a function timeout.
- Benchmark small mobile-browser memory budgets and worker behavior. Laptop advice
  stays advice; eligibility is based on measured resource bounds, not user-agent
  detection or PBKDF2 timing alone. Bound memory per item and avoid retaining a
  decrypted whole-vault snapshot in the browser.

Vercel documents a 4.5 MB function request/response payload limit. The current
buffered upload route allows 5 MiB, so it is not a suitable rotation transport at
the configured maximum. Rotation will use direct signed storage transfers; verify
normal large-file reads separately rather than assuming this also fixes the
existing upload/download paths. See [Vercel function limits](https://vercel.com/docs/functions/limitations)
and [direct-upload guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

The database client already disables prepared statements for transaction pooling.
Use a row lock (`SELECT ... FOR UPDATE`) on the shared account encryption state,
or a consistently keyed `pg_advisory_xact_lock`, **inside each writing transaction**.
Never depend on session-level advisory locks, a held connection, or a transaction
spanning requests. Durable operation ownership/expiry in database rows is allowed;
it is not a connection-held lease. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

## User workflow

### 1. Introduction and readiness

Explain scope: Secrets, Seals, Auths, history, encrypted attachments, other devices,
and recovery files. Show an initial estimate of records, file bytes, transfer, and
temporary storage; mark it preliminary until the inventory is frozen. No expensive
migration work starts yet. Recommend laptop/desktop, power, stable internet, and
keeping the page open; mobile is not prohibited solely by device detection.

Suggested warning: “This replaces the encryption keys for your encrypted data.
Keep your current and new passphrases available until it finishes. If your
connection drops or this device restarts, sign in again to resume. Unsaved
encrypted drafts left on other devices will no longer open after completion.”

Also explain residual risk accurately: forgotten credentials, pre-existing corrupt
or missing data, and implementation/storage failures can prevent recovery. An
ordinary dropped connection must not be described as losing half the vault.

### 2. Revoke other sessions

Explicit **Revoke all other sessions** button, followed by a server-confirmed list
showing only the current session. Mark the step complete only after verification.
This action is intentionally irreversible, even if the user later cancels rotation.
A new competing session before rotation begins invalidates this prerequisite and
requires repeating it. Include web and desktop sessions. Revocation must also cover previously issued
tokens whose lazy session row does not exist yet. Use a persisted account session
epoch, captured as a signed immutable claim at initial sign-in in both web and
desktop tokens. Revocation atomically advances the required epoch and records the
explicit surviving sid; refresh must not upgrade an old token's epoch. Validate
this before lazy row creation and through NextAuth's session endpoint as well as
REST/tRPC. Keep ordinary explicit revocation/expiry checks for the surviving sid.

Do not use refreshed JWT `iat` as session issuance time. Do not default a missing
epoch claim to the current account epoch. After an account's epoch enforcement is
activated, legacy epoch-less tokens fail closed except the explicitly surviving
sid; the compatibility release must handle the resulting re-authentication.
Persist the exception beyond rotation until that surviving session expires or is
revoked. Subsequent revocations atomically replace the exception. Serialize epoch
capture at sign-in with the same account lock so issuance/revocation races have a
defined order. Server generation fencing still protects in-flight requests.

The wizard can verify the server's revocation result plus the surviving session
list at that moment. It cannot prove that an offline device erased its keys or
prevent later sign-ins; do not change the button into a claim of remote erasure.
Parsing timestamps from UUIDv7/ObjectId sids is not required for this design and
would add timestamp precision/format compatibility assumptions.

### 3. Resolve drafts and pending work

List local drafts with Save/Resolve and Discard actions, using existing editors.
Resolving encrypted drafts may require a normal unlock here; still verify the
current passphrase again at the credentials step. Wait for saves, uploads, editor
checkpoints, and queued mutations to settle. Malformed/unreadable draft storage or
an unavailable storage API is not proof of zero drafts: show an explicit diagnostic
and deliberate cleanup option. Do not silently delete unknown data.

Require no remaining local drafts before Next. Explain that other devices cannot
be inspected remotely, and require an unchecked-by-default acknowledgement:
“I checked my other devices. I understand that remaining unsaved encrypted drafts
will become unrecoverable after rotation.”

Because other sessions were revoked first, advise checking/exporting local work
before signing back in; if saving on another device requires signing in, return to
step 2 and repeat revocation. Repeat the local scan immediately before freezing.
Other tabs must stop edits/checkpoints and acknowledge readiness where supported.
BroadcastChannel/Web Locks improve coordination but are not the security boundary.

### 4. Verify and choose passphrase

Fetch fresh online material; never use offline cached material for this workflow.
Verify the current passphrase locally against keyCheck. No passphrase is sent to
the server. Apply the current passphrase rules to the new value and confirmation.
Permit equality with the current passphrase and explain the recommendation to
change it. A fresh salt ensures a different deviceShare even for the same value.

Generate a random 32-byte new MEK. Derive the new deviceShare and compute the new
serverShare by XOR. Generate the new keyCheck. Use the current supported KDF policy;
store its exact parameters. Do not confuse format version with rotation generation.

### 5. Confirm and start

Summarize consequences and acknowledged draft loss. Begin atomically rechecks the
profile generation, session prerequisite, and competing rotation. Install the
server fence and create the durable operation before accepting staged data.
Capture the frozen inventory and final estimate. If prerequisites changed, return
to the relevant step without modifying active encrypted data.

### 6. Rotate, with nested progress

Use labeled states (pending, running, completed, paused, failed), progress counts,
and accessible announcements; completed checkmarks are status indicators, not
user-editable checkboxes. Suggested order:

1. Inventory and validate source data.
2. Fetch and re-encrypt Secrets and their versions.
3. Fetch and re-encrypt Seals and their versions using fresh per-seal keys.
4. Fetch and re-encrypt Auths.
5. Download, re-encrypt, upload, and read back encrypted files.
6. Verify every staged replacement and completeness.
7. Save and verify the new recovery file.
8. Activate new keys and encrypted data.
9. Refresh this device and schedule cleanup.

Within each content phase show processed/total records; files also show bytes and
current-file progress. Bounded pages/batches prevent large JSON requests. Work in
a dedicated worker when useful, with bounded concurrency and cancellation.
Never count a local encryption result as a completed durable item.

Pause/retry retains durable completed items. Cancellation is available before
activation; during an ambiguous activation request, resolve status first.
Do not artificially disable ordinary lock/security behavior to keep keys alive:
locking or sleeping pauses work and re-verification resumes it.

### 7. Completion

Only durable committed status earns “Rotation complete.” Explain that other
devices must sign in, unlock, and rebuild their Auth cache. Old recovery files no
longer unlock the current vault. Distinguish optional/background old-object cleanup
from successful activation; report cleanup failures without implying rotation failed.

## Inventory and preservation

Use dedicated owner-scoped snapshot queries, not normal list/search endpoints:
normal endpoints omit archived/deleted/expired records, paginate incompletely, and
may burn notes when read. Migration reads must never trigger burn-on-read, version
recording, email, or user-content analytics.

Include all physically retained Secret and Seal heads and versions, including
archived and soft-deleted records, without exposing hidden content in the wizard.
Inventory all non-null Auth payloads; preserve null tombstones and their semantics.
Include every retained encrypted file object, regardless of parent tier, including
unlinked uploads and attachments referenced only from historical content. Keep
file IDs and embedded HTML references unchanged. Preserve plaintext attachments.

Freeze structural mutations of the affected inventory, including file links,
metadata changes, deletes, history pruning, and destructive reads. Plaintext Notes
may remain usable except operations that touch fenced attachment resources.
Gate passphrase changes, recovery restore, encryption reset, account erasure, and
concurrent rotation so none can interleave; account erasure must first resolve the
rotation through an explicit supported path.

Cleanup workers must coordinate with the same fence. A one-time pre-purge is not
a substitute: rows can expire or reach their deletion grace period during a long
migration, and orphan cleanup can race independently. Keep normal purge semantics;
do not silently introduce an extra destructive prerequisite. If ordinary eligible
cleanup runs before begin, inventory simply reflects what still exists.

The checked-in `vercel.json` schedules storage cleanup daily (`0 0 * * *`), despite
older documentation describing hourly execution. Correct that documentation when
implementing related cleanup changes; correctness must not depend on cron cadence.

Temporarily defer physical
purging for frozen sources and exclude staged objects from orphan cleanup. Expiry
and visibility rules remain effective: rotation does not resurrect expired notes or
extend their expiry timestamps. After completion/cancellation, catch up deferred
cleanup. Bound abandoned-operation retention so expired ciphertext is not retained
indefinitely. Document that retention delay explicitly in security docs.

Preserve IDs (legacy hex and UUID), ownership, tags/order, pin/color/pattern,
createdAt/updatedAt content timestamps, archive/delete/expiry/burn flags, attachment
metadata, version IDs and seq order. Auth revisions must advance consistently to
invalidate old optimistic writes, without resurrecting tombstones. Generation
checks remain mandatory regardless of per-row revisions.

A retained required object that is missing/corrupt blocks activation with a precise
item/error count. Never silently skip it, invent an empty body, or truncate history.
The user may cancel and resolve existing damage separately, then start a new run.

## Durable state and schema

Proposed additions (final names chosen during implementation):

- A stable account/profile encryption generation, separate from crypto format
  version and profile identity. All unlock material, writes, cached vaults, and
  recovery files carry it. Existing rows/caches need an explicit migration path.
- One active rotation per user enforced by a database constraint.
- `encryption_rotations`: operation ID, user, source/target generations, owner sid,
  monotonic worker fence token, state, timestamps, source-profile fingerprint,
  pending new material (salt/KDF/serverShare/keyCheck), inventory summary/hash,
  acknowledgements, and sanitized failure/progress fields.
- Owner-scoped immutable inventory and staged-item tables keyed by operation,
  resource kind, record/version ID. Record source digest/revision, replacement
  ciphertext/wrapper or replacement S3 pointer/IV, ciphertext checksum and size,
  verification state, and idempotency token.
- Durable cleanup work for superseded file objects and aborted staged objects.

State machine:

`preparing -> migrating -> ready -> committed -> cleaned`

Before commit, an operation can be paused (without losing its underlying phase)
or move to `aborted`. Activation is one DB transaction, so a crash cannot strand a
partially applied “committing” state. Preserve a durable committed receipt/status
after sensitive staging metadata is cleaned, so delayed retries resolve correctly.

## Resume and key lifetime

Pending new material has the same sensitivity as ordinary server material. It is
available only through authenticated, owner-scoped rotation endpoints; never
expose old or new raw keys. The server stores no deviceShare.

On a fresh browser/session before commit:

1. Read operation status and source/target generations online.
2. Re-authenticate and reclaim ownership if necessary; revoke other sessions and
   advance the worker fence token so the old tab/session cannot continue writing.
3. Ask for the current and chosen new passphrases. Verify each against its own
   stored salt/KDF/keyCheck and reconstruct both MEKs locally.
4. Fetch completed staged items and verify them; continue remaining work.

Stage each new Seal wrapper before processing its bodies. It wraps a random new
NEK under the new MEK. A resumed worker unwraps that same staged NEK instead of
generating a different one for the remaining versions. Staged wrappers are
immutable after acceptance. This is necessary to resume a partially processed Seal.

If the user forgot the chosen new passphrase before commit, cancel and restart:
old active data is intact. If the user cannot recover the old MEK, do not pretend
staging can replace unavailable source decryption. After commit, only the new
material is active; the old passphrase is no longer required for resume/finalization.

Support session expiry/re-authentication and device loss without waiting for a
lease to expire: authenticated recovery may explicitly take ownership, fences out
the previous worker, and requires passphrase verification to continue cryptography.
Do not lock an account indefinitely to a dead sid. Leases never automatically
activate data or discard the only usable vault. Suggested abandoned staging policy:
abort after seven days without progress, preserving the old active vault; make the
actual configured deadline visible and test boundary races with commit.

## Server concurrency and API requirements

Proposed procedures: `rotation.status`, `begin`, paged `inventory`/source reads,
`stage`, `verify`, `claim`, `commit`, and `cancel`, plus small transfer-authorization
and transfer-finalization procedures. File bodies go directly to object storage,
not through binary application routes. Each checks authentication, ownership, state, generation,
worker token, request size, and idempotency. Operation IDs are not credentials.

A UI session count is insufficient: auth sessions are lazily created and an old
request may already have authenticated. Every affected mutation must lock/check a
shared account encryption state within the same transaction that writes. Begin
acquires that same lock before creating the snapshot/fence; previously started
writers either finish before inventory or fail after the fence. Include REST file
paths, desktop auth paths, restore/delete/burn operations, and background jobs.
Storage work outside a transaction must recheck before publishing its DB pointer.

New sign-ins may authenticate but cannot mutate the frozen vault. Give them a
rotation-in-progress screen and an explicit resume/takeover path. Re-verify and
revoke competing sessions on takeover and before activation. Gate legacy clients
with missing generations after rollout; never infer their ciphertext generation
from the latest server profile. A client-compatibility deployment must precede
feature enablement.

Idempotency keys bind to the exact payload digest. Same key/same payload returns
the original receipt; same key/different payload conflicts. Persist original
encrypted request bytes for retry or fetch the accepted staged result before
regenerating an IV. Duplicate begin/commit/cancel and delayed messages must converge
to the same durable outcome. Use bounded exponential backoff for transient errors;
authorization, generation, integrity, and ownership failures require explicit action.

Normal reads/material must return a consistent generation, and clients must reject
mixed responses arriving across activation. Do not serve sensitive rotation RPCs
from the service worker cache. Audit `resolveMaterial`'s broad fallback: revoked
sessions, rotation/generation conflicts, and explicit server errors must not silently
fall back to stale offline material during this workflow.

### Dedicated transport and error behavior

Use a rotation-specific non-batching tRPC client (`httpLink`, or an equivalent
explicit transport) with preserved web/desktop session headers. The existing
`httpBatchLink` can merge parallel 750,000-character payloads into an oversized
request. Enforce a byte budget on serialized requests **and responses**, including
JSON/base64 overhead; use byte-bounded pages rather than item-count-only batches.
Server limits remain authoritative and 413 must not trigger an identical retry
loop. Gate 0 chooses safe budgets below the actual deployed limits.

Do not attach the ordinary global `unauthorizedLink` to this client. A real 401
must immediately stop transfers/crypto, clear in-memory secrets, and require
re-authentication, while retaining durable operation identity for status/resume.
It must never be ignored or replaced with offline credentials. Fence, generation,
and competing-owner state conflicts use typed `CONFLICT`/`PRECONDITION_FAILED`
responses; foreign-account requests remain forbidden/not-found without disclosure.
Other ordinary clients may still initiate global sign-out on genuine revocation:
resume must survive that cleanup, not depend on this transport preventing it.

### Service-worker and HTTP cache protocol

The production Serwist defaults include NetworkFirst same-origin API GET caching;
development defaults are NetworkOnly. Current `src/sw.ts` only explicitly exempts
`encryption.material` among encryption procedures. Add early NetworkOnly rules for
rotation RPCs (including comma-joined legacy batch paths), encryption profile and
material, encrypted-tier/OTP queries, file API routes, and signed storage transfer
requests. Match storage requests before generic cross-origin/image rules too.
Retain intentional offline functionality through explicit generation-aware stores,
not an implicit HTTP cache. Document the file-route offline behavior change.

Send private/no-store response headers on sensitive application endpoints and
`cache: 'no-store'` on migration fetches. This fetch option alone does not override
an old service worker: require an updated controlling worker protocol before
begin/resume, with a clear update/reload path. No worker present is valid. Require
network read-back from the private origin object, not a CDN or stable file URL.

On worker activation, remove legacy affected API/file cache entries. On committed
generation detection, clear affected per-account app caches and HTTP entries before
rendering; if old HTTP cache keys are not account scoped, purge that affected cache
namespace. Retry failed purge on launch. Tag/reject in-flight old-generation
responses so they cannot repopulate a cleared cache. Repeat reconciliation on
other devices when they reconnect; the initiating device cannot purge them remotely.

Explicit Auth behavior: return a stored generation with `encryption.profile` and
every Auth snapshot. Before decrypting/replacing cached rows, compare it with the
enrollment generation. On mismatch, remove the old key and rows, broadcast removal,
clear visible codes, and transition to **not-enrolled**. Re-enrollment derives the
new key only after unlock and records the new generation. Keep the profile ID
stable for an in-place rotation; its existing reset behavior still applies. Old
enrollments without generation require migration/re-enrollment, not blind trust.
The initiating device may re-enroll in the completion flow after clearing old state.

## Verification, activation, and storage

For each encrypted item, authenticate/decrypt its source locally, encrypt using a
fresh random GCM IV and the appropriate existing AAD/domain, then read the staged
ciphertext back and decrypt/compare locally. Keep plaintext comparisons/hashes in
memory; do not send plaintext hashes to the server. Server ciphertext checksums
verify transfer integrity, not plaintext correctness.

For files, issue short-lived presigned PUT/GET URLs for exact private object keys.
Authorize each grant/finalization using user, operation, worker fence, generation,
and inventory identity. Configure CORS for supported origins and required checksum
headers, and avoid putting signed URLs in logs/analytics. Grant expiry permits
renewal after rechecking operation ownership. Do not expose arbitrary bucket keys.

Presigned URLs remain usable until expiry even after session revocation/takeover;
they are bearer capabilities, not instantly revocable sessions. A stale PUT must
never alter a verified/committed replacement: use provider-enforced immutable
writes (conditional create and checksum binding), immutable version references,
or promotion to a final object key for which no writable grant exists. Choose and
test one supported strategy in gate 0. Unique keys alone are insufficient if the
same key can still be overwritten. Finalize verifies stored size/checksum and
current fence; stale uploads can become garbage but cannot become active data.
Validate/enforce signed upload bounds and temporary quota at grant and completion.

Use new unique object keys, never overwrite source objects. Bind object
ownership, length, IV, checksum, and operation in the DB. An uploaded object whose
receipt was lost can be discovered/retried safely. Allow bounded temporary quota
headroom for exactly the frozen inventory; prevent quota bypass through arbitrary
staging uploads. Clean up successful-upload/failed-DB-write orphans safely. Avoid
relying on provider-specific ETags as cryptographic checksums.

The client verifies staged data with the target keys and acknowledges exact item
digests. The server validates manifest completeness, ownership, source stability,
file existence/checksum receipts, and exact set equality, not counts alone. It
cannot prove plaintext correctness without keys: this boundary makes client crypto
tests and staged read-back checks release-critical.

Before activation, generate a recovery file bound to user, profile/generation, and
pending deviceShare. Ask the user to save it and re-import it; verify that it
reconstructs the pending MEK with pending server material. Mark it clearly as
pending until commit; if cancelled, it is not a recovery file for the active vault.
Require verified recovery-file readiness for commit in the normal client workflow.
Maintain legacy recovery-file parsing with online keyCheck validation, and reject
stale generation files with clear errors rather than overwriting the profile.

Commit under the account lock:

1. Validate active source generation, operation/worker ownership, readiness,
   sessions, complete verified inventory, and unchanged source references.
2. Replace head/version ciphertexts, seal wrappers, Auth payloads/revisions, and
   attachment S3 pointers/IVs from staging with set-based DB operations.
3. Activate new profile material and generation; mark operation committed and
   queue superseded-object cleanup in the same transaction.
4. Release the fence with the new generation required for all writes.

Do not do network IO in commit. Benchmark transaction size/time on large note
histories in gate 0; enforce the selected inventory limits before staging. If a single transaction cannot meet deployment limits,
redesign around versioned datasets and an atomic active-generation pointer; never
split active table updates across commits as a shortcut.

After commit, refresh initiating-device MEK/share, material cache, Auth key and
cache, query caches, decrypted file/blob URLs, editor state, and draft generation.
Use a persistent generation marker so a crash halfway through local cache updates
causes invalidation/re-unlock instead of mixed-key reads. Offline devices cannot be
remotely wiped; reconcile generation before sync or writes when they reconnect.

Delete old serverShare and pending metadata when no longer needed; do not retain a
live old-key recovery path. Cleanup retries must delete only unreferenced objects
belonging to the finalized operation. Account for bucket versioning/backups and DB
backup retention: UI completion does not promise immediate erasure from backups.
Cleanup failure never rolls back committed data or deletes active replacements.

## Additional crypto-format decision

Keep this feature as full replacement; do not add a “fast rewrap” mode in v1.
Files currently have no wrapped per-file keys, so adding them would require an
initial content migration anyway. Envelope encryption can be evaluated separately,
but later rewrapping does not replace those data keys and would not meet this
feature's promise. The same scope rule applies to Secrets and Seals.

The feedback correctly identifies that Secret bodies and files currently omit AAD.
Record-bound AAD is worthwhile hardening but not “nearly free” or the only chance
to add it. Defer an AAD format migration from this rotation implementation unless
completed as a separately reviewed prerequisite. The rotation must preserve current
AAD behavior and must not claim resistance to server-side ciphertext substitution
or rollback that the current formats do not provide.

A future v2 design should bind canonical user/tier/record/file identity and payload
format, and consider encryption generation. Binding a version's DB-assigned `seq`
or head/version role is incompatible with today's server-side ciphertext copying
on saves/restores unless those flows also change. Define client-known stable
content identities or re-encryption semantics for every save, snapshot, and restore
before choosing that AAD. AAD alone cannot detect replay of an older valid payload
at the same identity; rollback protection requires trusted freshness state beyond
server-supplied metadata. Keep crypto-format version, recovery-file version, and
key generation separate, with dual-format readers deployed before any new writer.

## Test plan

Use real Web Crypto and real encrypted fixtures. Assertions must compare decrypted
content and file bytes, not merely UI success text. Use deterministic clocks and
controlled faults; never weaken production KDF/security behavior through test-only
public routes. Cover fast primitive fixtures plus real production-parameter smoke
coverage. No real user data, external TOTP services, or production storage.

### Unit and component tests (Jest)

- Same passphrase + fresh salt gives different deviceShare; fresh MEK and shares
  reconstruct correctly; wrong passphrase and altered keyCheck fail.
- Every supported payload round-trips old -> new; old working keys fail on new
  ciphertext; new keys fail on old ciphertext. Test empty/Unicode/large bodies.
- Existing AAD/domain separation rejects wrong Seal/Auth IDs; modified
  IV/ciphertext, malformed encodings, and unsupported versions fail closed. Do not
  assert record binding for legacy Secrets/files that currently omit AAD.
- Seal rotation replaces the actual NEK, covers current body and every version,
  and resumes halfway with the same staged NEK. Old NEK fails on all new bodies.
- Auth seed/issuer/account/algorithm/digits/period are preserved; fixed-time TOTP
  output is unchanged after re-encryption. Tombstones remain tombstones.
- File plaintext bytes are identical after migration; fresh key/IV and all allowed
  boundary sizes behave correctly (including GCM overhead at upload limits).
- Wizard prerequisites cannot be skipped; same passphrase is allowed; wrong
  current passphrase does not start rotation; local draft cleanup is explicit.
- Draft storage errors, pending checkpoints/uploads, another tab creating a draft,
  draft loss acknowledgement, new session, and rescan invalidation are covered.
- State-machine transitions, idempotent retries, payload conflicts, pause/cancel,
  forgotten-new-passphrase restart, session takeover, and commit-response loss.
- Reload drops all in-memory keys and still resumes from server material with
  both passphrases. Lock pauses; no secret is persisted to continue automatically.
- Cache generation mismatch hides stale data before rendering; staged responses
  cannot poison active caches; recovery file validates target generation.
- Logs, telemetry, error objects, and persistence contain no plaintext or raw keys.

### Database/controller integration tests

Use existing PGlite with real Drizzle migrations for transactional controller
coverage; use native PostgreSQL integration tests for real lock/race behavior that
PGlite cannot faithfully exercise.

- One active operation per account; owner isolation for all procedures and staged
  objects; unknown/foreign IDs never disclose data; RLS and grants on new tables.
- Complete inventory beyond normal pagination, history compression/MAX_VERSIONS,
  mixed ID formats, deleted/archived/expired rows, unlinked files, historical-only
  attachments, null payloads and tombstones.
- Metadata/seq preservation, no synthetic history entries, no burn-on-read or
  notification side effects; plaintext Notes/files remain unchanged.
- Fence races: writer authenticated before begin, delayed file publication,
  lazy-created sid, new sign-in, desktop request, stale tab, cleanup worker,
  expiry, restore, profile change/reset, and competing begin/commit/takeover.
- Exact-set completeness rejects omitted/substituted/duplicate items despite equal
  counts; source digest mismatch, wrong generation, missing/corrupt file, wrong
  checksum, and unverified replacement reject commit without active changes.
- Inject exceptions between each commit statement: everything rolls back,
  including profile, ciphertext, pointers, operation state, and cleanup queue.
- Successful commit switches all resources together. Repeat commit returns the
  receipt; late stage/cancel cannot modify or revert the result.
- Cancellation and abandoned-operation expiry preserve source data; expiry cannot
  race a commit into deleting its replacements. Cleanup retries preserve active
  references and eventually reclaim only eligible objects.

### End-to-end tests (Playwright)

Add a `RotationPage` page object and focused specs such as
`rotation.spec.ts`, `rotation-resume.spec.ts`, `rotation-concurrency.spec.ts`, and
`rotation-files.spec.ts`. Reuse existing session, encryption, OTP, and file fixtures.
E2E owns its native PostgreSQL and server as today. Extend the storage test harness
with a local durable object-store implementation/test service that supports byte
read-back, restart persistence, and deterministic failure injection. Keep fault
controls private to the test process/environment, never deployable public APIs.

Release-critical scenarios:

1. Full wizard on a mixed vault: multiple Secrets/Seals and history, Auths,
   plaintext Notes, encrypted and plaintext files, archived/deleted records.
   Compare pre/post plaintext and metadata through UI plus test DB assertions.
2. Same-passphrase run still changes MEK, Seal NEKs, shares, salt, ciphertext,
   and generation. Different-passphrase run rejects the old passphrase afterward.
3. Session revocation step with two browsers and desktop-style session; draft
   resolution, discard, other-device checkbox, and mandatory new recovery file.
4. Disconnect during each fetch/stage/file transfer/verify phase, restore network,
   retry, and finish without duplicated history, records, or active file objects.
5. Terminate the entire browser context and clear all browser storage at several
   points, including midway through one Seal's versions. Re-authenticate and
   resume with both passphrases using the same operation and staged keys.
6. Restart the app server mid-operation with DB/object store intact; status and
   staged progress survive. Expire/revoke the owner session and test takeover.
7. Drop a response after stage success and after commit success. A fresh page
   resolves durable status; commit is never replayed as a second rotation.
8. Cancel in each precommit phase, then unlock every old item and restore history;
   staged garbage is eventually removed and revoked sessions remain revoked.
9. Inject source corruption/missing file and replacement corruption; completion
   stays blocked, old vault remains intact, and errors identify the affected item.
10. Concurrent edits, deletes, history restore, burn, uploads, cleanup, new login,
    passphrase/recovery/reset, and a second rotation are fenced server-side.
11. Old browser tab submits after commit; old generation is rejected. Auth device
    reconnects, clears its old key/records, enters not-enrolled, and requires
    unlock/re-enrollment; offline cached codes continue until
    reconnection, without claiming remote seed revocation.
12. Current-device crash during cache refresh; next launch reads committed status
    and opens only target-generation data. Test opted-in offline material cache,
    service-worker update, account switching, and desktop restart.
13. New recovery file restores the committed vault; old file cannot change it.
    Cancelled pending recovery file does not unlock the unchanged active vault.
14. Files near quota and maximum size: bounded memory, accurate progress, temporary
    quota allowance, byte-identical downloads, stable embedded file references,
    and cleanup retries after provider failure.
15. Empty vault, no files, no Auths, many pages/versions, note expiring during a run,
    and retained deleted rows all finish without weakening visibility semantics.

For each fault point assert one of two states: complete old generation active or
complete new generation active. Never accept “some items still decrypt” as success.
Run browser-kill/network tests with real encrypted payloads and durable staging,
not mocks that skip the operation's persistence path.

### Additional regression and deployment tests

- Preserve sid-less rejection on REST, tRPC, and NextAuth session paths. Test an
  old signed sid with no row, refreshed JWT `iat` with unchanged old epoch, missing
  legacy epoch, sign-in/revoke race, surviving-sid expiry/revocation, and web plus
  desktop token refresh. Revoked tokens cannot lazily create a usable session.
- Run service-worker rotation tests against a production build with a real
  controlling worker and seeded stale `apis`/file caches. Development NetworkOnly
  behavior would mask the bug. Test old-worker update handshake, mixed tRPC batch
  matching, signed-storage requests, no-store read-back, failed cache purge, and
  delayed responses arriving after generation invalidation.
- Assert Auth mismatch visibly enters not-enrolled before displaying/decrypting
  new-generation data; test missing-generation enrollment compatibility as well
  as the existing profile-ID reset path.
- Send concurrent maximal stage calls and assert separate requests obey serialized
  byte limits. Test large response pagination, oversized requests, 413 handling,
  and genuine 401 versus fence conflict behavior with the rotation client.
- Verify file bytes bypass app-server bodies, CORS on supported browser/desktop
  origins, expired signed URL renewal, tampered scope/length/checksum, and delayed
  PUT after takeover, cancel, verification, and commit. Accepted replacements
  cannot be overwritten using a still-valid old grant.
- Simulate actual function/pooler timeouts and transaction-mode connection reuse;
  verify that state does not rely on one backend connection. Test inventory byte
  limits at the boundary and exhaustion of temporary DB/storage headroom.
- Reconfirm cleanup fencing when a row becomes purge-eligible after inventory;
  testing only a pre-purge at begin is insufficient.
- Recovery compatibility deploy: old v1 files continue to parse, new generation-
  bound files require new readers, stale files fail before profile mutation, and
  the feature remains disabled for incompatible clients. The current parser
  rejects versions greater than 1; bumping the writer alone is not sufficient.

### Validation and release gates

- Run `bun run lint`, relevant Jest suites, then the full unit suite.
- Run `bun run test:e2e:prepare` when dependencies require preparation, focused
  rotation E2E, then the full E2E suite and production build.
- Include desktop tests and targeted desktop/PWA smoke tests for affected paths.
- Measure file memory/traffic, largest supported DB transaction, resume time,
  cleanup backlog, and storage headroom; publish supported bounds in this plan
  before enabling the feature. Exercise slow network and low-memory behavior.
- Independent security/data-integrity review is a release gate; use explicit
  human review or separately authorized review work before rollout.
- No rollout until full-browser-loss resume, lost-commit-response recovery,
  multi-resource atomicity, genuine key replacement, and old-generation rejection
  have all passed. Do not substitute a warning for a failing safety test.

## Implementation sequence and rollout

0. Complete gate 0 deployment/storage/transaction spike, choose the activation
   architecture, and record measured limits before committing to production schema.
1. Add generation/fencing infrastructure and client/cache compatibility while
   rotation remains disabled. Audit every affected read/write/cleanup path.
2. Add migration schema, state machine, staging and idempotency; prove transaction
   and concurrency behavior with tests before building the wizard.
3. Implement client rotation primitives and restart-safe Seal processing.
4. Implement staged file transfer/read-back and operation-aware cleanup.
5. Add wizard, local-draft checks, session prerequisites, resume/takeover UI,
   recovery-file verification, and cache finalization.
6. Complete failure-injection tests, resource-limit benchmarks, and review.
7. Enable behind a feature flag for controlled testing, then gradual availability.

Feature disabling must prevent new operations while leaving resume/status/cancel
and committed-generation readers working. Do not roll back code/schema in a way
that makes already-rotated vaults unreadable. Retain compatible recovery handlers
across deployments and serve a clear client-upgrade requirement for old clients.

Telemetry is limited to operation IDs, coarse counts/bytes, phase durations, and
sanitized failure codes. Never include passphrases, shares, plaintext, TOTP seeds,
note titles, or filenames. Monitor stuck operations, rejected stale writes,
verification failures, commit latency, and cleanup failures.

Before coding, settle measured batch/transaction bounds, deployed storage-provider
checksum/versioning behavior, and the explicit staging-retention configuration.
These are engineering gates; the required product behavior and no-partial-vault
safety contract above are fixed.

## Feedback disposition

The external review was checked against current source rather than accepted as
an authority. This records deliberate choices for later reviewers:

| Point                    | Decision                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Sessions              | Sid-less acceptance is outdated; latest code rejects it. Lazy-row revocation remains relevant. Use immutable signed account epochs, not refreshed `iat` or mandatory sid timestamp parsing.            |
| 2. Transaction/pooler    | Accept early feasibility gate and transaction-scoped locks. Persisted ownership is valid; connection-held locks/leases are not.                                                                        |
| 3. File transport        | Accept direct signed storage transfers for rotation; current 5 MiB buffered uploads exceed the documented function payload bound at the maximum. Existing upload repair remains separate work.         |
| 4. Auth reset            | Already anticipated generation changes; now explicitly require not-enrolled on mismatch and compatibility for older enrollments.                                                                       |
| 5. Cache                 | Accept concrete production SW rules, protocol upgrade, cache purge, and uncached verification tests.                                                                                                   |
| 6. Unauthorized handling | Accept dedicated client and typed conflicts; genuine authentication failure still stops work and clears secrets.                                                                                       |
| 7. Batching              | Accept non-batching transport plus serialized request/response byte budgets.                                                                                                                           |
| 8. Purge                 | Reject pre-purge as replacement for fencing; eligibility changes during migration. Confirm daily checked-in cron.                                                                                      |
| 9. Rewrap                | Exclude fast rewrap from agreed full-replacement scope; existing files cannot acquire it without an initial migration.                                                                                 |
| 10. AAD                  | Confirm missing AAD on Secrets/files, but defer coupled format changes; DB-assigned seq and ciphertext-copy restore semantics make this nontrivial. Identity binding alone is not rollback protection. |
| 11. DB staging           | Accept byte budgets and measurement of layout alternatives. Side tables remain default unless gate 0 supports a different decision.                                                                    |
| 12. Compatibility/mobile | Accept explicit recovery-format compatibility tests and measured resource limits; laptop remains a recommendation.                                                                                     |
