import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { setupTestDb, teardownTestDb } from '@/test/db';

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(teardownTestDb);

test('every migrated app table enables default-deny RLS without forcing the owner', async () => {
  const result = await db.execute(sql`select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`);
  const { rows } = result as unknown as {
    rows: { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[];
  };
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.filter((row) => !row.relrowsecurity || row.relforcerowsecurity)).toEqual([]);
  const policies = await db.execute(sql`select * from pg_policies where schemaname = 'public'`);
  expect((policies as unknown as { rows: unknown[] }).rows).toEqual([]);
});

test('table-owner writes work while an explicitly granted non-owner sees no rows', async () => {
  await db.execute(
    sql`insert into users (id, display_name, created_at, updated_at) values ('rls-owner-test', 'synthetic', now(), now())`,
  );
  // PGlite is owned by this suite, so even this role is isolated from real DBs.
  await db.execute(sql`create role rotation_test_reader`);
  await db.execute(sql`grant usage on schema public to rotation_test_reader`);
  await db.execute(sql`grant select on users to rotation_test_reader`);
  const owner = await db.execute(sql`select id from users where id = 'rls-owner-test'`);
  expect((owner as unknown as { rows: unknown[] }).rows).toHaveLength(1);
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local role rotation_test_reader`);
    const reader = await tx.execute(sql`select id from users where id = 'rls-owner-test'`);
    expect((reader as unknown as { rows: unknown[] }).rows).toEqual([]);
  });
});
