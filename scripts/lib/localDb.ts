import path from 'node:path';

import { config } from 'dotenv';
import { sql } from 'drizzle-orm';

import { closeTestDb, testDb } from '../../tests/fixtures/db';

const repoRoot = path.resolve(__dirname, '../..');

/**
 * Hosts that can only mean "this machine". Anything else — a Supabase pooler,
 * a tunnel, a colleague's box — is rejected outright rather than confirmed.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * Resolves the local `DATABASE_URL` and proves it is local before anything can
 * connect through it.
 *
 * `.env.local` is the *only* file read, and it is read with `override: true`
 * for the same reason `drizzle.config.ts` does: Bun auto-loads `.env.local`
 * into the process and dotenv will not replace a variable that already exists,
 * so without the override an ambient `DATABASE_URL` — one exported in the
 * shell, one left over from a `:prod` command — would win silently.
 *
 * `.env.prod` is never consulted, and `DRIZZLE_ENV` is deliberately ignored:
 * these scripts destroy data, and there must be no argument, flag, or exported
 * variable that can aim them at production.
 */
export function resolveLocalDatabaseUrl(): { url: string; host: string } {
  const envFile = path.join(repoRoot, '.env.local');
  const parsed = config({ path: envFile, override: true });
  if (parsed.error) throw new Error(`Could not read ${envFile}: ${parsed.error.message}`);

  const url = parsed.parsed?.DATABASE_URL;
  if (!url) throw new Error(`Missing DATABASE_URL in ${envFile}`);

  const { hostname, port, pathname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to touch a non-local database: DATABASE_URL in .env.local points at ${hostname}. ` +
        `Only ${[...LOCAL_HOSTS].join(', ')} are allowed.`,
    );
  }

  // Export it so `testDb()` — which reads DATABASE_URL, as it does under
  // Playwright — connects to exactly the URL that was just vetted.
  process.env.DATABASE_URL = url;

  return { url, host: `${hostname}:${port || 5432}${pathname}` };
}

/** The vetted local handle, plus its `close()`. Both scripts open exactly one. */
export function openLocalDb() {
  const { host } = resolveLocalDatabaseUrl();
  // Say out loud which database is about to be touched, exactly as drizzle-kit does.
  console.log(`local db → ${host} (from .env.local)`);
  return { db: testDb(), host, close: closeTestDb };
}

export type LocalDb = ReturnType<typeof testDb>;

/** Table names in `public`, in no particular order — TRUNCATE takes them all at once. */
export async function publicTables(db: LocalDb): Promise<string[]> {
  const rows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`);
  return [...(rows as unknown as { tablename: string }[])].map((row) => row.tablename);
}

/**
 * Empties every table in `public`.
 *
 * One `TRUNCATE` naming all of them at once: truncating them one at a time
 * would need a delete order that the schema is free to change underneath us,
 * and `CASCADE` alone does not make that ordering safe.
 *
 * Only rows go. The `drizzle.__drizzle_migrations` ledger lives in another
 * schema and is untouched, so a wipe never desyncs migration state — you get
 * the schema you already had, with nothing in it.
 */
export async function wipeLocalDatabase(db: LocalDb): Promise<string[]> {
  const tables = await publicTables(db);
  if (tables.length === 0) return [];

  const list = tables.map((table) => `"public"."${table}"`).join(', ');
  await db.execute(sql.raw(`truncate table ${list} restart identity cascade`));
  return tables;
}
