import { type HydratedDocument, model, models, Schema } from 'mongoose';

export type AuthNonce = {
  nonce: string;
  usedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  ip?: string;
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
    ip: {
      type: String,
    },
  },
  {
    collection: 'auth_nonces',
  },
);

authNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authNonceSchema.index({ ip: 1, createdAt: 1 });

export const AuthNonceModel = models.AuthNonce || model<AuthNonce>('AuthNonce', authNonceSchema);
