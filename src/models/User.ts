import { type HydratedDocument, model, models, Schema } from 'mongoose';
import type { Address } from 'viem';

export type User = {
  addressLower: Address;
  addressChecksum: Address;
  createdAt: Date;
  lastLoginAt: Date;
};

export type UserDocument = HydratedDocument<User>;

const userSchema = new Schema<User>(
  {
    addressLower: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    addressChecksum: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    lastLoginAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  {
    collection: 'users',
  },
);

export const UserModel = models.User || model<User>('User', userSchema);
