import { type HydratedDocument, model, models, Schema } from 'mongoose';

// Provider-specific identity data — discriminated by `provider`

type SIWEIdentityData = {
  provider: 'siwe';
  providerSubject: string; // lowercase Ethereum address
  rawProfileJson?: { addressLower: string; addressChecksum: string };
};

type GoogleIdentityData = {
  provider: 'google';
  providerSubject: string; // Google user ID
  email?: string;
  emailVerified?: boolean;
  rawProfileJson?: Record<string, unknown>;
};

export type AuthIdentityProviderData = SIWEIdentityData | GoogleIdentityData;

export type AuthIdentity = {
  userId: string; // FK to User._id
  lastLoginAt: Date;
  createdAt: Date;
  updatedAt: Date;
} & AuthIdentityProviderData;

export type AuthIdentityDocument = HydratedDocument<AuthIdentity>;

const authIdentitySchema = new Schema<AuthIdentity>(
  {
    userId: { type: String, required: true, index: true },
    provider: { type: String, required: true, enum: ['siwe', 'google'] },
    providerSubject: { type: String, required: true },
    email: { type: String },
    lastLoginAt: { type: Date, required: true, default: () => new Date() },
    rawProfileJson: { type: Schema.Types.Mixed },
  },
  {
    collection: 'auth_identities',
    timestamps: true,
  },
);

// Prevents two accounts from claiming the same provider identity
authIdentitySchema.index({ provider: 1, providerSubject: 1 }, { unique: true });

export const AuthIdentityModel = models.AuthIdentity || model<AuthIdentity>('AuthIdentity', authIdentitySchema);
