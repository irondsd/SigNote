/** Native PostgreSQL locking/rollback baseline using the real app migrations.
 * This proves the selected locking primitive, not the future rotation controller.
 * Only creates/uses/drops a generated database inside local Docker PostgreSQL.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createLocalRotationDatabase } from './localResources';

const database = await createLocalRotationDatabase();
const writer = postgres(database.url, { max: 1, prepare: false });
const contender = postgres(database.url, { max: 1, prepare: false });
const profile = randomUUID();
const user = randomUUID();
const secret = randomUUID();
const oldPayload = { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' };
const replacement = { ...oldPayload, ciphertext: 'AQEBAQEBAQEBAQEBAQEBAQ==' };
const results: Record<string, unknown> = {};
try {
  await migrate(drizzle(writer), { migrationsFolder: 'drizzle' });
  await writer`insert into encryption_profiles (id, user_id, version, server_share, salt, kdf, key_check, created_at, updated_at)
    values (${profile}, ${user}, 1, 'source-share', 'source-salt', '{}'::jsonb, ${JSON.stringify(oldPayload)}::jsonb, now(), now())`;
  let notifyLocked!: () => void;
  let releaseWriter!: () => void;
  const locked = new Promise<void>((resolve) => {
    notifyLocked = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const pending = writer.begin(async (tx) => {
    await tx`select id from encryption_profiles where id = ${profile} for update`;
    notifyLocked();
    await release;
    await tx`insert into secret_notes (id, user_id, position, encrypted_body, archived, expires_at, created_at, updated_at)
      values (${secret}, ${user}, 0, ${JSON.stringify(oldPayload)}::jsonb, true, now() - interval '1 day', now(), now())`;
  });
  // Promise.race ensures connection/SQL failures cannot strand the barrier.
  await Promise.race([locked, pending]);
  try {
    await assert.rejects(
      contender.begin(async (tx) => {
        await tx`set local lock_timeout = '100ms'`;
        await tx`select id from encryption_profiles where id = ${profile} for update`;
      }),
      (error: unknown) => (error as { code?: string }).code === '55P03',
    );
  } finally {
    releaseWriter();
    await pending;
  }
  const snapshot = await contender.begin(async (tx) => {
    await tx`select id from encryption_profiles where id = ${profile} for update`;
    return tx`select * from secret_notes where user_id = ${user}`;
  });
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].archived, true);
  assert.deepEqual(snapshot[0].encrypted_body, oldPayload);
  results.lockSerializedWriterBeforeInventory = true;
  results.retainedArchivedExpiredRowIncluded = true;

  await assert.rejects(
    writer.begin(async (tx) => {
      await tx`select id from encryption_profiles where id = ${profile} for update`;
      await tx`update secret_notes set encrypted_body = ${JSON.stringify(replacement)}::jsonb where id = ${secret}`;
      await tx`update encryption_profiles set server_share = 'target-share' where id = ${profile}`;
      await tx`set local statement_timeout = '50ms'`;
      await tx`select pg_sleep(0.2)`;
    }),
    (error: unknown) => (error as { code?: string }).code === '57014',
  );
  const [afterFault] = await contender`select * from secret_notes where id = ${secret}`;
  assert.deepEqual(afterFault, snapshot[0]);
  const [oldProfile] = await contender`select server_share from encryption_profiles where id = ${profile}`;
  assert.equal(oldProfile.server_share, 'source-share');
  results.statementTimeoutRolledBackProfileAndCiphertext = true;
  await writer.begin(async (tx) => {
    await tx`select id from encryption_profiles where id = ${profile} for update`;
    await tx`update secret_notes set encrypted_body = ${JSON.stringify(replacement)}::jsonb where id = ${secret}`;
    await tx`update encryption_profiles set server_share = 'target-share' where id = ${profile}`;
  });
  const [afterCommit] = await contender`select * from secret_notes where id = ${secret}`;
  assert.deepEqual(afterCommit, { ...snapshot[0], encrypted_body: replacement });
  const [nextProfile] = await contender`select server_share from encryption_profiles where id = ${profile}`;
  assert.equal(nextProfile.server_share, 'target-share');
  results.atomicReplacementPreservedAllOtherColumns = true;
  const [unprotected] =
    await writer`select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`;
  assert.equal(unprotected.count, 0);
  results.realMigrationTablesHaveRls = true;
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scope:
          'Docker PostgreSQL real schema, two independent clients; not a deployed pooler or rotation controller test',
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  try {
    await Promise.all([writer.end(), contender.end()]);
  } finally {
    await database.stop();
  }
}
