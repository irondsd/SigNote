import type { Address } from 'viem';

import { UserModel } from '@/models/User';
import connectToDatabase from '@/utils/mongoose';

export const upsertSiweUser = async (address: string) => {
  const now = new Date();
  const normalizedAddress = address.toLowerCase();
  await connectToDatabase();

  const user = await UserModel.findOneAndUpdate(
    {
      addressLower: normalizedAddress as Address,
    },
    {
      $set: {
        addressChecksum: address as Address,
        lastLoginAt: now,
      },
      $setOnInsert: {
        addressLower: normalizedAddress as Address,
        createdAt: now,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    },
  );

  return user;
};
