# Encryption rotation release

Status: local verification completed except the final browser-capacity rerun; production qualification is not complete.
No production database, bucket, or deployment was changed by this verification.
Rotation has no feature flag: deployment makes it available immediately.

## What changed during verification

- Preserve null bodies/wrappers for never-written Seals; verify their entries even
  when no Seal has an existing key.
- Exclude signed legacy source-file reads as well as replacement objects from
  service-worker caching, and purge inherited signed responses on activation.
- Require the controlling worker to acknowledge the rotation protocol before
  loading the wizard or beginning/resuming an operation. An old worker prompts
  the user to close and reopen the app.
- Reject delayed ordinary tRPC responses when account/generation changes while
  they are in flight; do not repopulate an invalidated cache.
- Scope generation lookups to the current account and keep reconciliation pending
  if local key/draft removal fails.
- Treat infrastructure HTTP 413/401 responses as terminal, including non-tRPC
  bodies. Renew signed file grants during bounded transfer retries.
- Exclude aborted receipts and operations with outstanding deletes from the
  staging-finalization candidate window; old cancellations cannot starve cleanup.
- Remove the environment switch and disposable spike/layout/transport probes.
  Retain real PostgreSQL/MinIO regression suites in `tests/rotation`.

## Evidence and supported bounds

The configured admission limits are 500 retained inventory entries, 32 MiB source
ciphertext JSON, 48 MiB replacement JSON, 100 MiB encrypted files, 5 MiB per
object including its GCM tag, and 200 MiB outstanding temporary reservations per
account. One API request/response is limited to 3,000,000 bytes. PUT grants last
60 seconds, with another 60 seconds before eligible cleanup. Inactive operations
expire after seven days of accepted progress.

These are admission limits, not measured production capacity guarantees.
The native PostgreSQL/MinIO run on 2026-09-11 passed at 500 entries,
30,762,760 source bytes and 104,857,600 file bytes. Begin took 404 ms,
staging 7.69 s, and commit including file verification took 1.15 s.
There were 11 inventory pages. The combined test process's final RSS was
494,632,960 bytes; this includes fixtures, client crypto and server work and
must not be treated as browser peak memory or deployed function memory.
The native run also passed writer/claim/commit/cancel races, durable commit
retry, stale-generation rejection and delayed-PUT cleanup.

The signed-transfer suite passed origin checksum verification, signed length,
conditional-create rejection, grant expiry, CORS, and a real MinIO process
restart with accepted objects preserved. MinIO is not evidence about another
provider's behavior.

Validation on the revised code: 87 unit suites / 906 tests passed; ESLint and
TypeScript passed; desktop tests passed (32 tests). Production builds passed as
part of Playwright setup. Two full E2E runs completed. The first had 527 passes
and three failures (auth-layout fixture import, passkey creation, infinite scroll).
The second had 530 passes, two unrelated-flow failures (the same fixture import
and email linking), and a capacity fixture whitespace mismatch after successful
activation. The fixture is corrected; final focused validation is recorded below.
These runs are not a claim that the entire E2E suite is green.

Keep the original `rotation.md` until the outstanding release checks below are
completed. This runbook replaces disposable raw measurements, not missing evidence.

## Before deployment

1. Qualify a protected preview using a disposable Supabase database and private
   storage bucket with the same provider/configuration as production. Do not
   point test fixtures or destructive fault injection at a real user vault.
2. Run the actual Next.js rotation endpoints at the admission bounds through the
   deployment runtime and transaction pooler. Record begin/commit/request latency,
   memory, database/WAL headroom, and timeout rollback/recovery. Check effective
   `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout`.
   Local execution cannot establish those values.
3. Verify production-provider conditional PUT (`If-None-Match: *`), checksum and
   length binding, origin read-back, expired grants, delayed PUT cleanup, and
   browser CORS for every supported app/preview origin. Permit GET/PUT/HEAD and
   the required `if-none-match`, `x-amz-checksum-sha256`, `content-type` headers.
   Confirm GetObject/PutObject/DeleteObject access and any KMS permissions used
   by the bucket. Do not grant public bucket access.
4. Confirm the storage lifecycle policy will not expire active `rotation/`
   objects: after commit these are permanent active attachments. Check versioning
   and backup retention separately; object deletion does not erase old versions
   or database backups.
5. Complete installed PWA and Electron restart/unlock/Auth re-enrollment smoke
   tests, slow-network/low-memory checks, and server-process-loss recovery on the
   deployed candidate. Browser E2E and desktop unit tests do not replace these.
6. Complete security/data-integrity review and resolve release-critical failures.
   Verify rollback checkpoints, genuine MEK/NEK replacement, retained versions,
   recovery v1/v2 compatibility, account isolation and old-client fencing.
7. Confirm database and object-store backups and a recovery procedure. Inventory
   old deployments that remain addressable and protect/retire them; old backend
   code does not enforce the new account fences. Do not allow a new rotation
   while traffic can still reach that old backend.

Supabase recommends transaction pooling for serverless traffic; transaction mode
requires prepared statements disabled. The runtime already does that for port 6543. Use the session pooler on 5432 for migrations.
[Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
Vercel duration is configurable and project overrides matter; verify the actual
route settings rather than relying on the disposable probe's old 30-second cap.
[Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).
The immutable-object contract depends on provider support for conditional writes.
[Amazon S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

## Deployment order

Once qualification passes, the database/code sequence is migration then deploy.
There is no bulk data conversion: existing vaults stay at generation zero and
rotation happens only when a user explicitly completes the wizard.

1. Prepare and validate the exact release build; arrange a controlled traffic
   cutover because there is no enablement switch. Drain/protect old deployments
   before users can start rotations on the candidate.
2. If merging main triggers automatic deployment, perform the migration before
   merging. Confirm `.env.prod` contains the intended production session-pooler URL and
   that `DRIZZLE_DATABASE_URL` is unset (that variable overrides the file).
   Run `bun run db:migrate:prod`, with the target host checked in advance, and verify the host printed by Drizzle.
   Do not use `db:push:prod` for the release. The repo currently has no
   `db:check:prod` command despite its mention in AGENTS.md.
3. Verify the Drizzle journal applied the pending generated migrations in journal
   order: `0008_explicit_table_rls`, `0009_rotation_backend`,
   `0010_rotation_session_prerequisite`, `0011_rotation_file_reservations`.
   Numeric filename prefixes overlap earlier migrations; the journal determines
   order. These add tables/columns and enable RLS, without rewriting vault data.
   Confirm RLS on new tables and the app role's owner/bypass behavior; never add
   FORCE RLS. Older handwritten 0001/0002 files are not journal entries.
4. Deploy the candidate with the production runtime database URL, storage
   credentials/CORS and `CRON_SECRET`. Check the daily `/api/service/storage`
   schedule is active. Remove the obsolete rotation setting from hosting secrets
   if it exists; the code no longer reads it.
5. Smoke-test an existing generation-zero vault, then a disposable release
   account with Secrets, Seals/history, Auths and files. Verify actual stored
   material/ciphertext/NEK changes as well as decrypted contents. Reload/reopen,
   restore from the new recovery file, and reject the old file/passphrase.
6. Observe commit errors/latency, stuck operations, storage verification errors,
   stale-generation conflicts and cleanup backlog. Check pending cleanup rows,
   reserved bytes and oldest `not_before` rather than treating UI completion as
   confirmation that obsolete objects were already reclaimed. The cron currently
   processes at most 20 object tasks per invocation and re-sweeps tombstones;
   measure backlog under expected load before release.
7. After all release checks pass, remove `rotation.md` and keep this runbook.

## Rollback

Before any rotation commits, a code rollback can leave additive schema in place,
provided no operation remains active. After the first commit, do not roll back to
pre-rotation readers/writers or recovery handlers. Fix forward, or temporarily
block new rotation starts at the traffic layer while preserving status, resume,
cancel, generation-aware access and committed receipts. Restoring only a database
backup or only objects can break the profile/ciphertext/file-pointer relationship;
any disaster restore must recover a mutually consistent set.

## Merge history

A normal rebase merge retains each branch commit, including commits that added
files subsequently deleted. To keep disposable files out of main's history, squash
merge or interactively rebase/squash the branch before merging. The cleanup here
changes the final tree; it does not rewrite committed history.
