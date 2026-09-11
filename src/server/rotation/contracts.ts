import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ENC_PBKDF2_ITERATIONS, ENC_VERSION } from '@/config/constants';

const canonical64 = (size?: number) =>
  z.string().refine((value) => {
    const bytes = Buffer.from(value, 'base64');
    return bytes.toString('base64') === value && (size === undefined ? bytes.length >= 16 : bytes.length === size);
  });
export const payloadSchema = z
  .object({
    alg: z.literal('A256GCM'),
    iv: canonical64(12),
    ciphertext: canonical64().refine((v) => v.length <= 750_000),
  })
  .strict();
export const materialSchema = z
  .object({
    version: z.literal(ENC_VERSION),
    salt: canonical64(32),
    serverShare: canonical64(32),
    kdf: z
      .object({
        name: z.literal('PBKDF2'),
        hash: z.literal('SHA-256'),
        iterations: z.literal(ENC_PBKDF2_ITERATIONS),
        length: z.literal(32),
      })
      .strict(),
    keyCheck: payloadSchema.refine((value) => value.ciphertext.length <= 1024),
  })
  .strict();
export const kindSchema = z.enum(['secret', 'secret-version', 'seal', 'seal-version', 'seal-wrapper', 'auth', 'file']);
export const itemRefSchema = z.object({ kind: kindSchema, resourceId: z.string().min(1).max(128) });
export const workerSchema = z.object({
  operationId: z.uuid(),
  generation: z.number().int().nonnegative(),
  workerFence: z.number().int().positive(),
});
export type Worker = z.infer<typeof workerSchema>;
export type Actor = { userId: string; sid: string };
export const beginSchema = z
  .object({
    operationId: z.uuid(),
    sourceGeneration: z.number().int().nonnegative(),
    profileId: z.string().min(1).max(128),
    material: materialSchema,
    protocolVersion: z.literal(1),
    acknowledgements: z
      .object({ localDraftsResolved: z.literal(true), otherDeviceDraftLoss: z.literal(true) })
      .strict(),
  })
  .strict();
export type BeginInput = z.infer<typeof beginSchema>;

export class RotationError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'SESSION_PREREQUISITE'
      | 'CONFLICT'
      | 'EXPIRED'
      | 'INCOMPLETE'
      | 'SOURCE_CHANGED'
      | 'SOURCE_CORRUPT'
      | 'INVALID_INPUT'
      | 'LIMIT'
      | 'RECOVERY_REQUIRED',
  ) {
    super(code);
    this.name = 'RotationError';
  }
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Local-development bounds, deliberately below the measured 75 MB DB baseline.
 * Production qualification must establish these bounds before deployment.
 */
export const ROTATION_LIMITS = {
  maxItems: 500,
  maxSourceBytes: 32 * 1024 * 1024,
  maxStagedBytes: 48 * 1024 * 1024,
  maxFileBytes: 100 * 1024 * 1024,
  maxTemporaryFileBytes: 200 * 1024 * 1024,
  maxFileSize: 5 * 1024 * 1024,
  maxRequestBytes: 3_000_000,
  maxResponseBytes: 3_000_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  grantSeconds: 60,
};
export type RotationLimits = typeof ROTATION_LIMITS;
