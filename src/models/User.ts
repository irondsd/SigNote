import { type HydratedDocument, model, models, Schema } from 'mongoose';

export type User = {
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
};

export type UserDocument = HydratedDocument<User>;

const userSchema = new Schema<User>(
  {
    displayName: {
      type: String,
      required: true,
    },
  },
  {
    collection: 'users',
    timestamps: true,
  },
);

export const UserModel = models.User || model<User>('User', userSchema);
