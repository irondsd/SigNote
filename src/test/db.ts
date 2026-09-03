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

export async function resetTestDb(db: Db): Promise<void> {
  await db.execute(sql`
    truncate table
      notes, note_versions, note_tags,
      secret_notes, secret_note_versions, secret_note_tags,
      seal_notes, seal_note_versions, seal_note_tags,
      tags, users, auth_identities, auth_sessions, auth_nonces,
      desktop_auth_attempts, encryption_profiles, file_attachments,
      notification_preferences
    cascade
  `);
}
