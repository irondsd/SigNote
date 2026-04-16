import { AuthNonceModel } from '@/models/AuthNonce';
import connectToDatabase from '@/utils/mongoose';

const NONCE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

export const checkNonceRateLimit = async (ip: string): Promise<boolean> => {
  await connectToDatabase();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const count = await AuthNonceModel.countDocuments({ ip, createdAt: { $gt: windowStart } });
  return count < RATE_LIMIT_MAX;
};

export const createNonceRecord = async (nonce: string, ip?: string) => {
  const now = new Date();
  await connectToDatabase();

  await AuthNonceModel.create({
    nonce,
    usedAt: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + NONCE_TTL_MS),
    ip,
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
      returnDocument: 'after',
    },
  );
};
