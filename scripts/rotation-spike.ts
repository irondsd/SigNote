/** Disposable local DB feasibility baseline. NEVER reads an environment DB URL.
 * This is not representative deployment evidence and chooses no release limits.
 * Run: bun scripts/rotation-spike.ts > /tmp/rotation-spike.json
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { startTestPostgres } from '../tests/setup/postgres';
import { createLocalRotationDatabase } from '../tests/rotation/localResources';

const docker = process.argv.includes('--docker');
const cluster = docker ? await createLocalRotationDatabase() : await startTestPostgres();
const sql = postgres(cluster.url, { max: 2, prepare: false });
const results: Record<string, unknown>[] = [];
try {
  const settings = await sql`select name, setting, unit from pg_settings where name in
    ('server_version', 'statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'max_connections', 'shared_buffers')`;
  // Standalone synthetic schema, not an application migration.
  await sql`create table spike_account (id int primary key, generation int not null)`;
  await sql`insert into spike_account values (1, 0)`;
  await sql`create table spike_active (id int primary key, body text not null, pending text, saved_at timestamptz not null default now())`;
  await sql`create table spike_staged (id int primary key references spike_active(id), body text not null)`;
  const sizes = async () =>
    (
      await sql`select
    pg_total_relation_size('spike_active')::text as active_bytes,
    pg_total_relation_size('spike_staged')::text as staged_bytes`
    )[0];

  for (const [count, characters] of [
    [100, 1024],
    [500, 65536],
    [100, 750000],
  ]) {
    for (const layout of ['side-table', 'pending-column'] as const) {
      await sql`truncate spike_active, spike_staged`;
      await sql`update spike_account set generation = 0 where id = 1`;
      const started = performance.now();
      for (let id = 0; id < count; id++) {
        const body = randomBytes(Math.ceil((characters * 3) / 4))
          .toString('base64')
          .slice(0, characters);
        await sql`insert into spike_active (id, body) values (${id}, ${body})`;
      }
      const sourceMs = performance.now() - started;
      const sourceSize = await sizes();
      const [{ lsn }] = await sql`select pg_current_wal_insert_lsn()::text as lsn`;
      const stageStart = performance.now();
      for (let id = 0; id < count; id++) {
        const body = randomBytes(Math.ceil((characters * 3) / 4))
          .toString('base64')
          .slice(0, characters);
        if (layout === 'side-table') await sql`insert into spike_staged (id, body) values (${id}, ${body})`;
        else await sql`update spike_active set pending = ${body} where id = ${id}`;
      }
      const stageMs = performance.now() - stageStart;
      const stagedSize = await sizes();
      // Deliberate transaction fault verifies the benchmark's activation rollback.
      try {
        await sql.begin(async (tx) => {
          await tx`select id from spike_account where id = 1 for update`;
          await tx`update spike_active set body = 'fault'`;
          await tx`update spike_account set generation = 1 where id = 1`;
          throw new Error('injected rollback');
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'injected rollback') throw error;
      }
      const [{ bad }] = await sql`select count(*)::int as bad from spike_active where body = 'fault'`;
      const [{ generation }] = await sql`select generation from spike_account where id = 1`;
      if (bad !== 0 || generation !== 0) throw new Error('Rollback invariant failed');

      const commitStart = performance.now();
      await sql.begin(async (tx) => {
        await tx`select id from spike_account where id = 1 for update`;
        if (layout === 'side-table')
          await tx`update spike_active a set body = s.body from spike_staged s where a.id = s.id`;
        else await tx`update spike_active set body = pending, pending = null`;
        await tx`update spike_account set generation = 1 where id = 1`;
      });
      const commitMs = performance.now() - commitStart;
      const committedSize = await sizes();
      const [{ wal_bytes }] =
        await sql`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${lsn}::pg_lsn)::text as wal_bytes`;
      const cleanupStart = performance.now();
      await sql`truncate spike_staged`;
      await sql`vacuum analyze spike_active`;
      const cleanupMs = performance.now() - cleanupStart;
      results.push({
        layout,
        count,
        characters,
        sourceCiphertextBytes: count * characters,
        sourceMs,
        stageMs,
        commitMs,
        cleanupMs,
        sourceSize,
        stagedSize,
        committedSize,
        afterVacuumSize: await sizes(),
        walBytesIncludingRollback: wal_bytes,
        rollbackPassed: true,
      });
    }
  }
  process.stdout.write(
    JSON.stringify(
      {
        scope: `local synthetic ${docker ? 'Docker' : 'native'} PostgreSQL; NOT deployment qualification`,
        generatedAt: new Date().toISOString(),
        settings,
        results,
        remainingGates: [
          'representative function and pooler settings',
          'full application schema transaction and lock contention',
          'request/response boundary probes',
          'provider checksum/immutable upload and CORS behavior',
          'browser worker memory',
          'temporary storage headroom and retention configuration',
        ],
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  try {
    await sql.end();
  } finally {
    await cluster.stop();
  }
}
