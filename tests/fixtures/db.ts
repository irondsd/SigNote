import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';

/**
 * Postgres handle for E2E fixtures. Separate from the app's own pool in
 * `src/db/client.ts`: fixtures run in the Playwright process, the app runs in
 * the dev server spawned by globalSetup, and both point at the same
 * `DATABASE_URL` that globalSetup exported.
 */
let sql: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function testDb() {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Missing DATABASE_URL — globalSetup should have set it');
    sql = postgres(url, { max: 4 });
    db = drizzle(sql, { schema });
  }
  return db;
}

export async function closeTestDb(): Promise<void> {
  const open = sql;
  sql = undefined;
  db = undefined;
  if (open) await open.end();
}

export { schema };
