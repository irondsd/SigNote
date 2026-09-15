import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';

import * as schema from '../db/schema';

/** DDL for the whole schema, generated from `src/db/schema.ts` the way
 *  `drizzle-kit push` would against an empty database. Throwaway test
 *  databases are built from this; real ones are synced with `db:push`. */
export async function schemaStatements(): Promise<string[]> {
  return generateMigration(
    generateDrizzleJson({}, undefined, undefined, 'snake_case'),
    generateDrizzleJson(schema, undefined, undefined, 'snake_case'),
  );
}
