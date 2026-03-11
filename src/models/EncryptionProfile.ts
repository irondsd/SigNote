import { type HydratedDocument, model, models, Schema } from 'mongoose';

export type EncryptedPayload = {
  alg: 'A256GCM';
  iv: string; // base64
  ciphertext: string; // base64
};

export type KdfParams = {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  length: number;
};

export type EncryptionProfile = {
  walletAddress: string; // normalized lowercase, unique index
  version: number;
  serverShare: string; // base64, 32 bytes random
  salt: string; // base64
  kdf: KdfParams;
  keyCheck: EncryptedPayload;
  createdAt: Date;
  updatedAt: Date;
};

export type EncryptionProfileDocument = HydratedDocument<EncryptionProfile>;

const encryptedPayloadSchema = new Schema<EncryptedPayload>(
  {
    alg: { type: String, required: true },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { _id: false },
);

const encryptionProfileSchema = new Schema<EncryptionProfile>({
  walletAddress: { type: String, required: true, unique: true },
  version: { type: Number, required: true },
  serverShare: { type: String, required: true },
  salt: { type: String, required: true },
  kdf: {
    name: { type: String, required: true },
    hash: { type: String, required: true },
    iterations: { type: Number, required: true },
    length: { type: Number, required: true },
  },
  keyCheck: { type: encryptedPayloadSchema, required: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

export const EncryptionProfileModel =
  models.EncryptionProfile || model<EncryptionProfile>('EncryptionProfile', encryptionProfileSchema);
