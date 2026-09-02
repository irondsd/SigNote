import { type HydratedDocument, model, models, Schema } from 'mongoose';

export type DesktopAuthAttemptStatus = 'pending' | 'authorized' | 'consumed';

export type DesktopAuthAttempt = {
  attemptId: string;
  stateHash: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  authorizationCodeHash: string | null;
  userId: string | null;
  status: DesktopAuthAttemptStatus;
  ip: string;
  exchangeAttempts: number;
  authorizedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

export type DesktopAuthAttemptDocument = HydratedDocument<DesktopAuthAttempt>;

const desktopAuthAttemptSchema = new Schema<DesktopAuthAttempt>(
  {
    attemptId: { type: String, required: true, unique: true },
    stateHash: { type: String, required: true },
    codeChallenge: { type: String, required: true },
    codeChallengeMethod: { type: String, enum: ['S256'], required: true },
    authorizationCodeHash: { type: String, default: null },
    userId: { type: String, default: null },
    status: { type: String, enum: ['pending', 'authorized', 'consumed'], required: true, default: 'pending' },
    ip: { type: String, default: '' },
    exchangeAttempts: { type: Number, default: 0 },
    authorizedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: 'desktop_auth_attempts',
    timestamps: true,
  },
);

desktopAuthAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
desktopAuthAttemptSchema.index({ ip: 1, createdAt: -1 });
desktopAuthAttemptSchema.index(
  { authorizationCodeHash: 1 },
  { unique: true, partialFilterExpression: { authorizationCodeHash: { $type: 'string' } } },
);

export const DesktopAuthAttemptModel =
  models.DesktopAuthAttempt || model<DesktopAuthAttempt>('DesktopAuthAttempt', desktopAuthAttemptSchema);
