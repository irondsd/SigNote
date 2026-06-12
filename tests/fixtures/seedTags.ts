import mongoose from 'mongoose';
import type { Address } from 'viem';
import { TagModel, type TagDocument } from '@/models/Tag';
import { autoTagColor, type TagColor } from '@/config/noteStyles';
import { getOrCreateUserId } from './getOrCreateUserId';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';

export type SeedTag = { name: string; color?: TagColor };

export const seedTags = async (address: Address, tags: SeedTag[]): Promise<TagDocument[]> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const userId = await getOrCreateUserId(address);

  const created: TagDocument[] = [];
  for (const tag of tags) {
    created.push(await TagModel.create({ userId, name: tag.name, color: tag.color ?? autoTagColor(tag.name) }));
  }
  return created;
};
