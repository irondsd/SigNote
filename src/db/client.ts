import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import path from 'node:path';
import postgres from 'postgres';

import * as schema from './schema';

/** Common supertype of the postgres-js and PGlite drizzle instances — every
 *  query in the app is written against this, so tests can swap in PGlite. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

/** Generated SQL lives at the repo root; `cwd` is the repo root under both
 *  `next dev`/`next start` and ts-jest. */
export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

// The dev server re-evaluates modules on every hot reload. Without a global,
// each reload would open a fresh connection pool and exhaust Postgres.
const globalForDb = globalThis as typeof globalThis & {
  _signoteDb?: Db;
  _signoteDbClose?: () => Promise<void>;
};

/**
 * Opens (once) the app-wide connection pool from `DATABASE_URL`.
 *
 * Migrations are NOT applied here — a serverless invocation is the wrong place
 * to run DDL. Run `bun run db:migrate` deliberately instead.
 */
export function connectToDatabase(): Db {
  if (globalForDb._signoteDb) return globalForDb._signoteDb;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Missing DATABASE_URL in environment variables');
  }

  // A transaction pooler (Supabase :6543, PgBouncer) hands each query a
  // different backend, so server-side prepared statements can't be cached
  // there. A direct connection keeps them — they're a straight win.
  const pooled = /:6543(\/|$)/.test(url) || /[?&]pgbouncer=true/.test(url);

  const sql = postgres(url, {
    max: Number(process.env.PG_POOL_SIZE ?? 10),
    prepare: !pooled,
  });
  const instance = drizzlePostgres(sql, { schema }) as unknown as Db;

  globalForDb._signoteDb = instance;
  globalForDb._signoteDbClose = () => sql.end();
  return instance;
}

/** The app-wide database handle, connecting lazily on first use. */
export function getDb(): Db {
  return globalForDb._signoteDb ?? connectToDatabase();
}

/** Test hook: inject a PGlite-backed drizzle instance in place of a real pool. */
export function setDb(instance: Db | undefined, close?: () => Promise<void>): void {
  globalForDb._signoteDb = instance;
  globalForDb._signoteDbClose = close;
}

export async function disconnectDatabase(): Promise<void> {
  const close = globalForDb._signoteDbClose;
  globalForDb._signoteDb = undefined;
  globalForDb._signoteDbClose = undefined;
  if (close) await close();
}

export function isDatabaseConnected(): boolean {
  return globalForDb._signoteDb !== undefined;
}

export default connectToDatabase;
