import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { MIGRATIONS_FOLDER, setDb, type Db } from '@/db/client';
import * as schema from '@/db/schema';

/** In-process Postgres for tests: one PGlite instance per suite, real Drizzle
 *  migrations applied, injected as the app-wide db via `setDb`. */
export async function setupTestDb(): Promise<Db> {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  setDb(db, () => pglite.close());
  return db;
}

export async function teardownTestDb(): Promise<void> {
  const { disconnectDatabase } = await import('@/db/client');
  await disconnectDatabase();
}

/**
 * Truncates every table rather than a hand-kept list. The list version silently
 * skipped any table added after it was written, and rows surviving into the
 * next test fail in ways that look like logic bugs.
 */
export async function resetTestDb(db: Db): Promise<void> {
  const result = await db.execute(sql`
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> '__drizzle_migrations'
  `);
  // The pglite driver returns `{ rows }`; postgres-js returns the array itself.
  const raw = result as unknown as { rows?: { tablename: string }[] } | { tablename: string }[];
  const records = Array.isArray(raw) ? raw : (raw.rows ?? []);
  const tables = records.map((row) => row.tablename);
  if (tables.length === 0) return;

  await db.execute(sql.raw(`truncate table ${tables.map((t) => `"${t}"`).join(', ')} cascade`));
}
