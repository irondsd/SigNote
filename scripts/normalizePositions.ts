/**
 * Normalize note `position` values to clean, evenly-spaced integers.
 *
 * Float fractional-indexing — `(above + below) / 2` in calculatePosition —
 * produces ever-finer decimals whose gaps eventually collapse below what a
 * midpoint can separate, at which point reordering silently no-ops. This
 * script rewrites every user's positions, per tier, as multiples of
 * POSITION_STEP in their current order, restoring large integer gaps.
 *
 *
 * Run from the project root:
 *   bun run scripts/normalizePositions.ts            # apply changes
 *   bun run scripts/normalizePositions.ts --dry-run  # preview only, no writes
 */
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });
config();

const POSITION_STEP = 1000;
const TABLES = ['notes', 'secret_notes', 'seal_notes'] as const;
const DRY_RUN = process.argv.includes('--dry-run');

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Missing DATABASE_URL — set it in .env.local');
}

async function main() {
  const sql = postgres(url!, { max: 1 });

  try {
    for (const table of TABLES) {
      // Same ordering the list query uses, minus `pinned` (which is a separate
      // sort key, not part of the position sequence).
      const rows = await sql<{ id: string; user_id: string; position: number }[]>`
        select id, user_id, position
        from ${sql(table)}
        order by user_id asc, position desc, id desc`;

      if (rows.length === 0) {
        console.log(`${table}: empty, skipping`);
        continue;
      }

      // Positions are a per-user ordering. Rows arrive grouped by user and
      // already in list order, so each user's block is numbered downward from
      // count*STEP — the highest position stays first in the list.
      const byUser = new Map<string, { id: string; position: number }[]>();
      for (const row of rows) {
        const bucket = byUser.get(row.user_id);
        if (bucket) bucket.push(row);
        else byUser.set(row.user_id, [row]);
      }

      const updates: { id: string; position: number }[] = [];
      for (const bucket of byUser.values()) {
        bucket.forEach((row, i) => {
          const position = (bucket.length - i) * POSITION_STEP;
          if (position !== row.position) updates.push({ id: row.id, position });
        });
      }

      if (updates.length === 0) {
        console.log(`${table}: ${rows.length} rows across ${byUser.size} users — already normalized`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`${table}: would rewrite ${updates.length}/${rows.length} positions`);
        continue;
      }

      // One statement per tier: the id/position pairs go over as two arrays and
      // are zipped back into rows by unnest, then joined onto the table.
      await sql`
        update ${sql(table)} as t
        set position = v.position
        from unnest(${updates.map((u) => u.id)}::text[], ${updates.map((u) => u.position)}::double precision[])
          as v(id, position)
        where t.id = v.id`;
      console.log(`${table}: rewrote ${updates.length}/${rows.length} positions`);
    }
    console.log(DRY_RUN ? '\nDone (dry run — nothing written).' : '\nDone.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
