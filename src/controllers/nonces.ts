import { AuthNonceModel } from '@/models/AuthNonce';
import connectToDatabase from '@/utils/mongoose';

const NONCE_TTL_MS = 10 * 60 * 1000;

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
