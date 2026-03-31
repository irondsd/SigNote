import { AuthIdentityModel } from '@/models/AuthIdentity';
import { UserModel } from '@/models/User';
import connectToDatabase from '@/utils/mongoose';

export const upsertGoogleUser = async (googleId: string, displayName: string, email?: string, image?: string) => {
  const now = new Date();
  await connectToDatabase();

  const existingIdentity = await AuthIdentityModel.findOne({
    provider: 'google',
    providerSubject: googleId,
  });

  if (existingIdentity) {
    existingIdentity.lastLoginAt = now;
    await existingIdentity.save();
    return UserModel.findById(existingIdentity.userId).lean().exec();
  }

  const user = await UserModel.create({ displayName });

  await AuthIdentityModel.create({
    userId: user._id.toString(),
    provider: 'google',
    providerSubject: googleId,
    lastLoginAt: now,
    email,
    rawProfileJson: { displayName, image },
  });

  return user;
};

export const updateDisplayName = async (userId: string, displayName: string) => {
  await connectToDatabase();
  return UserModel.findByIdAndUpdate(userId, { displayName }, { new: true }).lean().exec();
};

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
