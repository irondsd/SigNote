import type { Address } from 'viem';
import { tags as tagsTable } from '../../src/db/schema';
import { autoTagColor, type TagColor } from '@/config/noteStyles';
import { getOrCreateUserId } from './getOrCreateUserId';
import { testDb } from './db';

export type SeedTag = { name: string; color?: TagColor };
/** The inserted row, plus the `_id` alias the app's API exposes — specs
 *  address seeded rows the same way the client sees them. */
export type SeededTag = typeof tagsTable.$inferSelect & { _id: string };

const withAliasedId = (row: typeof tagsTable.$inferSelect): SeededTag => ({ ...row, _id: row.id });

export const seedTags = async (address: Address, tags: SeedTag[]): Promise<SeededTag[]> => {
  const db = testDb();
  const userId = await getOrCreateUserId(address);

  const created: SeededTag[] = [];
  for (const tag of tags) {
    const [row] = await db
      .insert(tagsTable)
      .values({ userId, name: tag.name, color: tag.color ?? autoTagColor(tag.name) })
      .returning();
    created.push(withAliasedId(row));
  }
  return created;
};
