import { type HydratedDocument, model, models, Schema } from 'mongoose';

export type AuthNonce = {
  nonce: string;
  usedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
};

export type AuthNonceDocument = HydratedDocument<AuthNonce>;

const authNonceSchema = new Schema<AuthNonce>(
  {
    nonce: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    collection: 'auth_nonces',
  },
);

authNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthNonceModel = models.AuthNonce || model<AuthNonce>('AuthNonce', authNonceSchema);
