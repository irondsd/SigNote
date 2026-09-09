/**
 * Empties every table in the local database's `public` schema.
 *
 *   bun run ./scripts/wipeLocalDb.ts [--yes]
 *
 * The target is read from `.env.local` and nothing else — see
 * `scripts/lib/localDb.ts` for why `.env.prod` and `DRIZZLE_ENV` are ignored
 * here on purpose. Migration state survives; only rows go.
 */
import { openLocalDb, publicTables, wipeLocalDatabase } from './lib/localDb';

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `);
  for await (const chunk of process.stdin) {
    return /^y(es)?$/i.test(chunk.toString().trim());
  }
  return false;
}

async function main() {
  const { db, host, close } = openLocalDb();
  try {
    const tables = await publicTables(db);
    if (tables.length === 0) {
      console.log('Nothing to wipe — no tables in `public`. Run `bun run db:migrate` first.');
      return;
    }

    if (!process.argv.includes('--yes') && !process.argv.includes('-y')) {
      console.log(`About to empty ${tables.length} tables in ${host}.`);
      if (!(await confirm('Wipe it?'))) {
        console.log('Aborted.');
        process.exitCode = 1;
        return;
      }
    }

    await wipeLocalDatabase(db);
    console.log(`Wiped ${tables.length} tables.`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
