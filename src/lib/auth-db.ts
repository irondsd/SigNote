import type { Address } from 'viem';

import { AuthNonceModel, type AuthNonce } from '@/models/AuthNonce';
import { UserModel, type User } from '@/models/User';
import connectToDatabase from '@/utils/mongoose';

const NONCE_TTL_MS = 10 * 60 * 1000;

export type AuthNonceDocument = AuthNonce;

export type UserDocument = User;

let nonceIndexesEnsured = false;

export const ensureNonceIndexes = async () => {
  if (nonceIndexesEnsured) {
    return;
  }

  await connectToDatabase();
  await AuthNonceModel.createIndexes();

  nonceIndexesEnsured = true;
};

export const createNonceRecord = async (nonce: string) => {
  const now = new Date();
  await connectToDatabase();

  await AuthNonceModel.create({
    nonce,
    usedAt: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + NONCE_TTL_MS),
  });
};

export const consumeNonceRecord = async (nonce: string) => {
  const now = new Date();
  await connectToDatabase();

  return AuthNonceModel.findOneAndUpdate(
    {
      nonce,
      usedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        usedAt: now,
      },
    },
    {
      new: true,
    },
  );
};

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
      new: true,
    },
  );

  return user;
};
