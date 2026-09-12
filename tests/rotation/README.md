# Local rotation integration resources

Run from the repository root:

```sh
bun run local:up
bun run test:rotation:locks
bun run test:rotation:storage
bun run test:rotation:integration
```

PostgreSQL uses the existing Docker service on `127.0.0.1:5434`. Each database
command creates its own randomly named `signote_rotation_*` database and drops
that database in teardown. It never uses `DATABASE_URL` or the `signote` vault.
The lock test applies the real Drizzle migrations, uses two independent clients
with prepared statements disabled, and checks row-lock contention, timeout
rollback, metadata preservation, retained rows, and RLS. It is a baseline for
controller integration tests, not a substitute for testing the rotation service.

MinIO is the permanent local object store on `127.0.0.1:9100`; its console is at
`http://127.0.0.1:9101`. Local credentials are declared in `docker-compose.yml`:
user `signote-local`, password `signote-local-only`. These scripts write only to
the private `signote-rotation-test` bucket — never to `signote-local`, which is
where development attachments live — and they do not read the app's AWS
environment. `minio-init` creates both buckets on first boot; the test helper
also creates its own if it is missing.

The storage command **restarts the MinIO container** to check that accepted
objects survive it. That is the same container development uses, so expect a few
seconds where local attachments are unreachable. It tests real signed PUT/GETs,
SHA-256 and signed length, conditional-create protection against old PUT grants,
expiry, HTTP no-store, localhost browser CORS, and cleanup. It waits for its PUT
grants to expire before deleting only the objects it allocated. The bucket and
volume remain available between runs. Stop the store without deleting its volume
with:

```sh
docker compose stop minio
```

`src/server/rotation/objectStore.ts` is the reusable internal storage adapter.
Its receipts must come from a trusted controller, which must enforce account
ownership, generation, worker fence, quotas, and grant-expiry-aware cleanup.
Those controller requirements are not implemented by the storage adapter itself.
Never log its signed URLs or treat the operation ID as authorization.

The integration command runs the actual service with real Web Crypto, PostgreSQL
and MinIO: 500 inventory items (~32 MB ciphertext), twenty 5 MiB encrypted files (100 MiB total),
byte-bounded pagination, real account-lock contention, concurrent budget checks,
claim/commit/cancel races, stale-generation rejection, and delayed PUT cleanup.
It creates and drops an owned database and removes only its test objects after
issued PUT grants expire. Unit tests additionally exercise mixed tiers and every
activation rollback checkpoint with real PGlite migrations.

The local results do not establish Supabase pooler timeouts or browser memory
bounds. They also say nothing about another storage provider: MinIO honouring
conditional create and SHA-256 checksum binding is not evidence that the
production bucket does, so the storage command can be pointed at a **throwaway
bucket on the real provider** (never the one holding attachments):

```sh
ROTATION_TEST_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
ROTATION_TEST_S3_BUCKET=signote-rotation-qualify \
ROTATION_TEST_S3_ACCESS_KEY_ID=… ROTATION_TEST_S3_SECRET_ACCESS_KEY=… \
ROTATION_TEST_APP_ORIGIN=https://<app origin> \
bun run test:rotation:storage
```

The variables are deliberately not the `AWS_*` names the app reads, the bucket
must already exist (it is not created remotely), the CORS probe checks the given
origin, and the container-restart step is skipped. Every assertion in the run is
one the adapter relies on in production: signed PUT accepted, repeat PUT on the
same key refused with 412, `GetObject`/`HeadObject` reporting an entity tag, a
body of the wrong signed length refused with 403, expired grants refused. No
Supabase URL is needed for any of these commands.

Note what is deliberately _not_ asserted. The suite requires no provider
checksum, and it expects a same-length corrupt body to be **accepted** and then
refused by the server's own read-back. R2 has no full-object SHA-256 for a single
`PutObject`, so an adapter that required one worked against MinIO and would have
failed every rotation of a vault with attachments in production. Do not "fix"
that assertion by reintroducing `x-amz-checksum-sha256`.
The integration suites inject only test resources. Rotation is enabled by default;
`ROTATION_DISABLED=1` refuses new starts while operations in flight stay usable. The standalone scripts here
are retained regression suites, not deployment spikes. Raw one-off measurements
and the disposable transport/layout probes have been removed.
