import { AuthIdentityModel } from '@/models/AuthIdentity';
import { UserModel } from '@/models/User';
import connectToDatabase from '@/utils/mongoose';

export const upsertSiweUser = async (address: string) => {
  const now = new Date();
  const addressLower = address.toLowerCase();
  await connectToDatabase();

  const existingIdentity = await AuthIdentityModel.findOne({
    provider: 'siwe',
    providerSubject: addressLower,
  });

  if (existingIdentity) {
    existingIdentity.lastLoginAt = now;
    await existingIdentity.save();
    return UserModel.findById(existingIdentity.userId).lean().exec();
  }

  const user = await UserModel.create({ displayName: address });

  await AuthIdentityModel.create({
    userId: user._id.toString(),
    provider: 'siwe',
    providerSubject: addressLower,
    lastLoginAt: now,
    rawProfileJson: { addressLower, addressChecksum: address },
  });

  return user;
};
