# Local rotation integration resources

Run from the repository root:

```sh
bun run rotation:local:up
bun run rotation:local:locks
bun run rotation:local:storage
bun run rotation:local:integration
```

PostgreSQL uses the existing Docker service on `127.0.0.1:5434`. Each database
command creates its own randomly named `signote_rotation_*` database and drops
that database in teardown. It never uses `DATABASE_URL` or the `signote` vault.
The lock test applies the real Drizzle migrations, uses two independent clients
with prepared statements disabled, and checks row-lock contention, timeout
rollback, metadata preservation, retained rows, and RLS. It is a baseline for
controller integration tests, not a substitute for testing the rotation service.

MinIO runs in its own Docker volume on `127.0.0.1:9100`; its console is at
`http://127.0.0.1:9101`. Local credentials are declared in `docker-compose.yml`:
user `signote-rotation-local`, password `signote-rotation-local-only`. The test
helper creates the private `signote-rotation-test` bucket if it is missing. These
are test credentials and the scripts do not read the app's AWS environment.

The storage command restarts **only the dedicated rotation MinIO service** to
check persistence. It tests real signed PUT/GETs, SHA-256 and signed length,
conditional-create protection against old PUT grants, expiry, HTTP no-store,
localhost browser CORS, and cleanup. It waits for its PUT grants to expire before
deleting only the objects it allocated. The bucket and volume remain available
between runs. Stop the test storage without deleting its volume with:

```sh
docker compose --profile rotation stop rotation-minio
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

The local results do not establish Supabase pooler timeouts, production storage
immutability/CORS, or browser memory bounds. Those are release checks in
`docs/rotation-release.md`. No Supabase URL or external S3 account is needed for these commands.
The integration suites inject only test resources. Rotation has no environment
flag; deploying the application makes it available. The standalone scripts here
are retained regression suites, not deployment spikes. Raw one-off measurements
and the disposable transport/layout probes have been removed.
