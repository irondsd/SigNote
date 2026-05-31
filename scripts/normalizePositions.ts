/**
 * Normalize note `position` values to clean, evenly-spaced integers.
 *
 * Float fractional-indexing — `(above + below) / 2` in calculatePosition —
 * produces ever-finer decimals whose gaps eventually collapse below what a
 * midpoint can separate, at which point reordering silently no-ops. This
 * script rewrites every user's positions, per tier, as multiples of
 * POSITION_STEP in their current order, restoring large integer gaps.
 *
 * Run from the project root (bun auto-loads .env.local):
 *   bun run scripts/normalizePositions.ts            # apply changes
 *   bun run scripts/normalizePositions.ts --dry-run  # preview only, no writes
 */
import mongoose from 'mongoose';

const POSITION_STEP = 1000;
const COLLECTIONS = ['notes', 'secretnotes', 'sealnotes'] as const;
const DRY_RUN = process.argv.includes('--dry-run');
const INSPECT = process.argv.includes('--inspect');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? 'signote';

if (!uri) {
  throw new Error('Missing MONGODB_URI — set it in .env.local');
}

type Doc = { _id: mongoose.Types.ObjectId; userId?: unknown; position?: unknown };

// Sort key: missing / non-numeric positions sink to the bottom.
const posValue = (p: unknown): number => (typeof p === 'number' && Number.isFinite(p) ? p : -Infinity);

const hasDecimal = (p: unknown): boolean => typeof p === 'number' && !Number.isInteger(p);

async function main() {
  await mongoose.connect(uri!, { dbName });
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');

  console.log(`Connected to "${dbName}"${DRY_RUN ? ' (dry run — no writes)' : ''}\n`);

  if (INSPECT) {
    // Print the exact BSON type of position + pinned per doc, in the SAME order the
    // app's list query uses. A doc whose type differs from its siblings is the one
    // MongoDB mis-sorts (type-bracket ordering rather than numeric value).
    for (const name of COLLECTIONS) {
      const col = db.collection(name);
      const rows = await col
        .aggregate([
          { $sort: { pinned: -1, position: -1 } },
          {
            $project: {
              position: 1,
              posType: { $type: '$position' },
              pinned: 1,
              pinnedType: { $type: '$pinned' },
            },
          },
        ])
        .toArray();
      console.log(`\n=== ${name} (list-sort order) ===`);
      for (const r of rows) {
        console.log(
          `  ${String(r._id).slice(-6)}  position=${r.position} (${r.posType})  pinned=${r.pinned} (${r.pinnedType})`,
        );
      }
    }
    await mongoose.disconnect();
    console.log('\nDone (inspect).');
    return;
  }

  for (const name of COLLECTIONS) {
    const col = db.collection<Doc>(name);

    // BSON-type breakdown of `position` — mixed types (string vs number) silently
    // break the descending sort, which is the actual reorder bug.
    const typeBreakdown = await col
      .aggregate([{ $group: { _id: { $type: '$position' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      .toArray();
    console.log(`${name}: position BSON types →`, typeBreakdown.map((t) => `${t._id}: ${t.count}`).join(', '));

    // `pinned` is the PRIMARY sort key. A missing field (BSON "missing") sorts in a
    // different type-bracket than a real boolean `false`, which scrambles the
    // secondary position sort. Report its types/presence too.
    const pinnedBreakdown = await col
      .aggregate([{ $group: { _id: { $type: '$pinned' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      .toArray();
    console.log(`${name}: pinned BSON types →`, pinnedBreakdown.map((t) => `${t._id}: ${t.count}`).join(', '));

    // Backfill `pinned` to a real boolean on every doc that isn't already a boolean
    // (missing field or wrong type), so the `{ pinned: -1, ... }` sort can't bracket
    // docs into separate type groups. We target "not a boolean" via the inverse of the
    // two valid states (true/false); this matches missing fields and never clobbers a
    // genuinely-pinned doc.
    const needsPinned = { pinned: { $nin: [true, false] } };
    const pinnedToFix = await col.countDocuments(needsPinned);
    if (pinnedToFix > 0) {
      if (DRY_RUN) {
        console.log(`${name}: ${pinnedToFix} docs have a missing/non-boolean pinned → would set pinned: false`);
      } else {
        const res = await col.updateMany(needsPinned, { $set: { pinned: false } });
        console.log(`${name}: set pinned: false on ${res.modifiedCount} docs`);
      }
    }

    const docs = await col.find({}, { projection: { _id: 1, userId: 1, position: 1 } }).toArray();

    if (docs.length === 0) {
      console.log(`${name}: empty, skipping\n`);
      continue;
    }

    // Group by user — positions are a per-user ordering.
    const byUser = new Map<string, Doc[]>();
    for (const d of docs) {
      const key = String(d.userId ?? '');
      const bucket = byUser.get(key) ?? [];
      bucket.push(d);
      byUser.set(key, bucket);
    }

    const ops: Parameters<typeof col.bulkWrite>[0][number][] = [];
    let decimalsSeen = 0;

    for (const [userId, group] of byUser) {
      // Highest position first — matches the descending list sort.
      group.sort((a, b) => posValue(b.position) - posValue(a.position));

      group.forEach((doc, i) => {
        if (hasDecimal(doc.position)) decimalsSeen++;
        // Top item gets the largest position; each step below drops by POSITION_STEP.
        const newPos = (group.length - i) * POSITION_STEP;
        if (doc.position !== newPos) {
          ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { position: newPos } } } });
        }
      });

      if (DRY_RUN) {
        const preview = group
          .map((d) => (typeof d.position === 'number' ? d.position : `(${String(d.position)})`))
          .join(', ');
        console.log(`  ${name} · user ${userId} (${group.length}): ${preview}`);
      }
    }

    if (DRY_RUN) {
      console.log(`${name}: ${docs.length} docs, ${decimalsSeen} with decimals, ${ops.length} would change\n`);
    } else if (ops.length > 0) {
      const res = await col.bulkWrite(ops);
      console.log(`${name}: ${docs.length} docs, ${decimalsSeen} had decimals, ${res.modifiedCount} updated\n`);
    } else {
      console.log(`${name}: ${docs.length} docs, already normalized\n`);
    }
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
