import { type HydratedDocument, model, models, Schema } from 'mongoose';

export type AuthProvider = 'google' | 'siwe';
export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export type AuthSession = {
  userId: string;
  provider: AuthProvider;
  ip: string;
  userAgent: string;
  browser: string;
  os: string;
  deviceType: DeviceType;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type AuthSessionDocument = HydratedDocument<AuthSession>;

const authSessionSchema = new Schema<AuthSession>(
  {
    userId: { type: String, required: true },
    provider: { type: String, enum: ['google', 'siwe'], required: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    browser: { type: String, default: '' },
    os: { type: String, default: '' },
    deviceType: { type: String, enum: ['mobile', 'tablet', 'desktop', 'unknown'], default: 'unknown' },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  {
    collection: 'authsessions',
    timestamps: true,
  },
);

// List query: a user's most-recently-active sessions
authSessionSchema.index({ userId: 1, updatedAt: -1 });

// TTL — auto-remove the row once it expires (covers both natural expiry and post-revoke cleanup)
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthSessionModel =
  models.AuthSession || model<AuthSession>('AuthSession', authSessionSchema);
