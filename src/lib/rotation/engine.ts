/**
 * The client-side rotation worker.
 *
 * It walks the frozen inventory, produces a replacement for every encrypted
 * item under the new keys, stages it, reads the staged ciphertext *back* and
 * proves it decrypts to the same plaintext, and only then acknowledges the
 * item. Nothing here is counted as done because a local encryption succeeded:
 * durable acceptance by the server is the only completion signal, which is what
 * makes the whole thing resumable after the browser is lost.
 *
 * Three properties shape the code more than anything else:
 *
 * **Memory is bounded per item, not per vault.** The inventory is paged and
 * each page is processed and released; no decrypted snapshot of the vault is
 * ever held. The one thing retained across pages is the Seal wrapper table,
 * which is two ~60-byte payloads per Seal.
 *
 * **Seal wrappers sort last.** The server orders inventory by `(kind,
 * resourceId)`, so `seal-wrapper` arrives after `seal` and `seal-version` — but
 * a body cannot be re-encrypted until its wrapper exists, because the wrapper
 * *is* the new note key. So the walk is two passes: the first handles
 * everything whose key is already in hand and records each Seal's source and
 * replacement wrappers; the second re-reads only the Seal body range.
 *
 * **A staged item is never re-encrypted.** Resuming with a fresh IV would
 * produce a different digest for the same plaintext, which the server correctly
 * refuses as a conflicting payload under the same idempotency key. An item that
 * already carries a `replacementDigest` is verified against its accepted value
 * instead — and for a half-processed Seal that is exactly what keeps the
 * remaining versions on the same NEK as the ones already staged.
 */

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/routers/_app';
import type { RotationCipherValue, RotationKind } from '@/db/schema';
import type { EncryptedPayload } from '@/types/crypto';
import { getSealKeyString } from '@/config/constants';
import { decryptBytesAesGcm, deriveSealWrapKey, toBase64 } from '@/lib/crypto';
import {
  createRotationSealWrapper,
  rotateBody,
  rotateFile,
  verifyRotatedBody,
  verifyRotatedFile,
  type RotationBody,
} from './crypto';
import { rotationDigest } from './digest';
import { asRotationError, RotationTransportError, withRotationRetry, type RetryOptions } from './client';

type Outputs = inferRouterOutputs<AppRouter>;
export type RotationItem = Outputs['rotation']['inventory']['items'][number];
export type RotationStatus = NonNullable<Outputs['rotation']['status']['operation']>;

/** Just the procedures the engine calls, so tests can drive it without HTTP. */
export type RotationApi = {
  inventory(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    after?: { kind: RotationKind; resourceId: string };
  }): Promise<{ items: RotationItem[]; next: { kind: RotationKind; resourceId: string } | null }>;
  stage(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    item: { kind: RotationKind; resourceId: string };
    replacement: RotationCipherValue;
    stageKey: string;
  }): Promise<RotationItem>;
  verify(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    item: { kind: RotationKind; resourceId: string };
    replacementDigest: string;
  }): Promise<RotationStatus>;
  sourceFile(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    resourceId: string;
  }): Promise<{ url: string; bytes: number; iv: string }>;
  reserveFile(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    resourceId: string;
    file: { bytes: number; iv: string; checksum: string };
  }): Promise<{
    object: { key: string; bytes: number; checksum: string; iv: string };
    grant: { url: string; headers: Record<string, string> };
    expiresAt: Date | string;
  }>;
  finalizeFile(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    resourceId: string;
    objectKey: string;
    stageKey: string;
  }): Promise<RotationItem>;
  stagedFile(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    resourceId: string;
  }): Promise<{ url: string; iv: string; bytes: number; replacementDigest: string }>;
  confirmRecovery(input: {
    operationId: string;
    generation: number;
    workerFence: number;
    recovery: { profileId: string; generation: number; inventoryDigest: string; acknowledged: true };
  }): Promise<RotationStatus>;
  commit(input: { operationId: string; generation: number; workerFence: number }): Promise<RotationStatus>;
};

export type RotationWorkerToken = { operationId: string; generation: number; workerFence: number };

export type RotationPhaseName = 'inventory' | 'records' | 'files' | 'commit';

export type RotationProgress = {
  phase: RotationPhaseName;
  /** Durably accepted items, never locally encrypted ones. */
  processed: number;
  total: number;
  /** File bytes transferred and verified so far, and the frozen total. */
  bytesProcessed: number;
  bytesTotal: number;
  kind: RotationKind | null;
};

export type RotationEngineOptions = {
  api: RotationApi;
  token: RotationWorkerToken;
  sourceMek: CryptoKey;
  targetMek: CryptoKey;
  itemCount: number;
  fileBytes: number;
  onProgress?: (progress: RotationProgress) => void;
  signal?: AbortSignal;
  retry?: RetryOptions;
  /** Injected so tests can drive signed transfers without a network. */
  transfer?: RotationTransfer;
};

/** The signed object-store transfer, isolated so it can be faked in tests. */
export type RotationTransfer = {
  download(url: string): Promise<ArrayBuffer>;
  upload(url: string, headers: Record<string, string>, body: ArrayBuffer): Promise<void>;
};

export class RotationItemError extends Error {
  constructor(
    readonly kind: RotationKind,
    readonly resourceId: string,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`${kind} ${resourceId}: ${reason}`, options);
    this.name = 'RotationItemError';
  }
}

/** Ordering the server sorts by; the Seal body range sits between these. */
const BODY_KINDS: RotationKind[] = ['auth', 'file', 'secret', 'secret-version'];
const SEAL_BODY_KINDS: RotationKind[] = ['seal', 'seal-version'];

const isPayload = (value: RotationCipherValue): value is EncryptedPayload =>
  value !== null && 'ciphertext' in value && 'iv' in value;

export const defaultTransfer: RotationTransfer = {
  async download(url) {
    // The read-back must come from the private origin object, uncached, or it
    // proves nothing about what was actually stored.
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new RotationTransportError('TRANSIENT', `STORAGE_READ_${response.status}`);
    return response.arrayBuffer();
  },
  async upload(url, headers, body) {
    const response = await fetch(url, { method: 'PUT', headers, body });
    if (!response.ok) {
      // A conditional-create refusal means the object already exists, which a
      // blind retry cannot fix; the caller resolves it through finalize.
      const transient = response.status >= 500 || response.status === 429 || response.status === 403;
      throw new RotationTransportError(transient ? 'TRANSIENT' : 'CONFLICT', `STORAGE_WRITE_${response.status}`);
    }
  },
};

export function createRotationEngine(options: RotationEngineOptions) {
  const { api, token, sourceMek, targetMek, signal } = options;
  const transfer = options.transfer ?? defaultTransfer;
  const sealWrappers = new Map<string, { source: EncryptedPayload; replacement: EncryptedPayload }>();

  let processed = 0;
  let bytesProcessed = 0;
  let phase: RotationPhaseName = 'inventory';

  const report = (kind: RotationKind | null) =>
    options.onProgress?.({
      phase,
      processed,
      total: options.itemCount,
      bytesProcessed,
      bytesTotal: options.fileBytes,
      kind,
    });

  const call = <T>(run: () => Promise<T>): Promise<T> =>
    withRotationRetry(run, { ...options.retry, signal: signal ?? options.retry?.signal });

  const stageKeyFor = (item: { kind: RotationKind; resourceId: string }) => `${item.kind}:${item.resourceId}`;
  const ref = (item: { kind: RotationKind; resourceId: string }) => ({
    kind: item.kind,
    resourceId: item.resourceId,
  });

  /** Stage a replacement, or return the value already accepted for this item. */
  async function stageOnce(item: RotationItem, produce: () => Promise<RotationCipherValue>): Promise<RotationItem> {
    if (item.replacementDigest !== null) return item;
    const replacement = await produce();
    return call(() =>
      api.stage({ ...token, item: ref(item), replacement, stageKey: stageKeyFor(item) }).catch((error) => {
        throw asRotationError(error);
      }),
    );
  }

  async function acknowledge(item: { kind: RotationKind; resourceId: string }, digest: string): Promise<void> {
    await call(() => api.verify({ ...token, item: ref(item), replacementDigest: digest }));
    processed++;
    report(item.kind);
  }

  /** The body descriptor a tier's ciphertext is keyed and bound by. */
  function bodyDescriptor(item: RotationItem, wrapper: EncryptedPayload | null): RotationBody {
    if (item.kind === 'secret' || item.kind === 'secret-version') return { kind: 'secret' };
    if (item.kind === 'auth') return { kind: 'auth', recordId: item.resourceId };
    const sealId = item.parentId ?? item.resourceId;
    if (!wrapper) throw new RotationItemError(item.kind, item.resourceId, 'MISSING_SEAL_WRAPPER');
    return { kind: 'seal', recordId: sealId, wrappedNoteKey: wrapper };
  }

  /**
   * A Seal wrapper is not a re-encryption of anything — it is a brand new note
   * key. So "verified" here means the staged wrapper really does unwrap to a
   * 32-byte key under the target MEK and this Seal's binding, which is the
   * property every body staged against it depends on.
   */
  async function checkWrapper(sealId: string, wrapper: EncryptedPayload): Promise<void> {
    const raw = await decryptBytesAesGcm(await deriveSealWrapKey(targetMek, sealId), wrapper, getSealKeyString(sealId));
    try {
      if (raw.length !== 32) throw new RotationItemError('seal-wrapper', sealId, 'INVALID_REPLACEMENT_KEY');
    } finally {
      raw.fill(0);
    }
  }

  async function processWrapper(item: RotationItem): Promise<void> {
    const sealId = item.resourceId;
    const source = item.source;
    if (source !== null && !isPayload(source)) {
      throw new RotationItemError(item.kind, sealId, 'SOURCE_CORRUPT');
    }
    // A never-written Seal has no NEK. Preserve that null state, including
    // its empty body, rather than manufacturing a wrapper the server rejects.
    if (source === null) {
      await processBody(item);
      return;
    }
    const staged = await stageOnce(item, () => createRotationSealWrapper(targetMek, sealId));
    const replacement = staged.replacement;
    if (!isPayload(replacement) || staged.replacementDigest === null) {
      throw new RotationItemError(item.kind, sealId, 'STAGING_INCOMPLETE');
    }
    await checkWrapper(sealId, replacement);
    // Retained for the second pass. A resumed run reads the same accepted
    // wrapper here, so the remaining versions land on the NEK already in use.
    if (source !== null) sealWrappers.set(sealId, { source, replacement });
    if (staged.verifiedDigest !== staged.replacementDigest) {
      await acknowledge(item, staged.replacementDigest);
    } else {
      processed++;
      report(item.kind);
    }
  }

  async function processBody(item: RotationItem): Promise<void> {
    const source = item.source;
    if (source !== null && !isPayload(source)) {
      throw new RotationItemError(item.kind, item.resourceId, 'SOURCE_CORRUPT');
    }
    const sealId = item.parentId ?? item.resourceId;
    const wrappers = SEAL_BODY_KINDS.includes(item.kind) ? (sealWrappers.get(sealId) ?? null) : null;

    if (source === null) {
      // An Auth tombstone, or an empty Seal. It stays null: rotation must never
      // resurrect a deleted record, and there is nothing to re-encrypt.
      const staged = await stageOnce(item, async () => null);
      if (staged.replacementDigest === null) {
        throw new RotationItemError(item.kind, item.resourceId, 'STAGING_INCOMPLETE');
      }
      if (staged.verifiedDigest !== staged.replacementDigest) await acknowledge(item, staged.replacementDigest);
      else {
        processed++;
        report(item.kind);
      }
      return;
    }

    if (SEAL_BODY_KINDS.includes(item.kind) && !wrappers) {
      throw new RotationItemError(item.kind, item.resourceId, 'MISSING_SEAL_WRAPPER');
    }
    const sourceBody = bodyDescriptor(item, wrappers?.source ?? null);
    const targetBody = bodyDescriptor(item, wrappers?.replacement ?? null);

    const staged = await stageOnce(item, () => rotateBody(sourceMek, targetMek, sourceBody, targetBody, source));
    const replacement = staged.replacement;
    if (!isPayload(replacement) || staged.replacementDigest === null) {
      throw new RotationItemError(item.kind, item.resourceId, 'STAGING_INCOMPLETE');
    }
    // Read back what the server actually holds, not the local encrypt result.
    await verifyRotatedBody(sourceMek, targetMek, sourceBody, targetBody, source, replacement);
    const digest = await rotationDigest(replacement);
    if (digest !== staged.replacementDigest) {
      throw new RotationItemError(item.kind, item.resourceId, 'DIGEST_MISMATCH');
    }
    if (staged.verifiedDigest !== digest) await acknowledge(item, digest);
    else {
      processed++;
      report(item.kind);
    }
  }

  async function processFile(item: RotationItem): Promise<void> {
    const resourceId = item.resourceId;
    const { sourceInfo, sourceBytes } = await call(async () => {
      const sourceInfo = await api.sourceFile({ ...token, resourceId });
      return { sourceInfo, sourceBytes: await transfer.download(sourceInfo.url) };
    });
    // Storage transfers get the same bounded backoff as the RPCs. A provider
    // hiccup on a multi-megabyte body is the most likely transient fault in the
    // whole run, and the least useful one to hand back to the user.
    if (sourceBytes.byteLength !== sourceInfo.bytes) {
      throw new RotationItemError('file', resourceId, 'SOURCE_CORRUPT');
    }

    let staged = item;
    if (item.replacementDigest === null) {
      const replacement = await rotateFile(sourceMek, targetMek, {
        iv: sourceInfo.iv,
        cipherBytes: sourceBytes,
      });
      const checksum = toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', replacement.cipherBytes)));
      const reservation = await call(async () => {
        // Renew the signed URL on retry. Reusing the exact bytes/IV/checksum
        // keeps the reservation idempotent and does not charge quota twice.
        const reservation = await api.reserveFile({
          ...token,
          resourceId,
          file: { bytes: replacement.cipherBytes.byteLength, iv: replacement.iv, checksum },
        });
        try {
          await transfer.upload(reservation.grant.url, reservation.grant.headers, replacement.cipherBytes);
        } catch (error) {
          // An accepted conditional PUT can lose its response. Finalize checks
          // origin bytes before accepting an already-existing object.
          if (asRotationError(error).code !== 'CONFLICT') throw error;
        }
        return reservation;
      });
      staged = await call(() =>
        api.finalizeFile({ ...token, resourceId, objectKey: reservation.object.key, stageKey: stageKeyFor(item) }),
      );
    }
    if (staged.replacementDigest === null) throw new RotationItemError('file', resourceId, 'STAGING_INCOMPLETE');

    const { stagedInfo, stagedBytes } = await call(async () => {
      const stagedInfo = await api.stagedFile({ ...token, resourceId });
      return { stagedInfo, stagedBytes: await transfer.download(stagedInfo.url) };
    });
    await verifyRotatedFile(
      sourceMek,
      targetMek,
      { iv: sourceInfo.iv, cipherBytes: sourceBytes },
      { iv: stagedInfo.iv, cipherBytes: stagedBytes },
    );
    if (stagedInfo.replacementDigest !== staged.replacementDigest) {
      throw new RotationItemError('file', resourceId, 'DIGEST_MISMATCH');
    }

    bytesProcessed += sourceInfo.bytes;
    if (staged.verifiedDigest !== staged.replacementDigest) {
      await acknowledge(item, staged.replacementDigest);
    } else {
      processed++;
      report('file');
    }
  }

  type Cursor = { kind: RotationKind; resourceId: string };

  /**
   * One page-by-page walk, handling only the kinds this pass owns.
   *
   * `stopAfterKind` exists so the Seal pass does not drag every Secret and its
   * versions across the network a second time: the server's ordering is
   * lexicographic by kind, so once an item sorts past `seal-version` there is
   * nothing left for that pass to do.
   */
  async function walk(
    kinds: RotationKind[],
    options: { from?: Cursor; stopAfterKind?: RotationKind } = {},
  ): Promise<Cursor | undefined> {
    let after = options.from;
    /** The cursor immediately before the Seal body range, for the second pass. */
    let sealCursor: Cursor | undefined;
    let sealCursorFound = false;
    for (;;) {
      signal?.throwIfAborted();
      const page = await call(() => api.inventory({ ...token, ...(after ? { after } : {}) }));
      for (const item of page.items) {
        signal?.throwIfAborted();
        if (!sealCursorFound && SEAL_BODY_KINDS.includes(item.kind)) {
          sealCursor = after;
          sealCursorFound = true;
        }
        if (options.stopAfterKind && item.kind > options.stopAfterKind) return sealCursor;
        if (!kinds.includes(item.kind)) continue;
        try {
          if (item.kind === 'seal-wrapper') await processWrapper(item);
          else if (item.kind === 'file') await processFile(item);
          else await processBody(item);
        } catch (error) {
          if (error instanceof RotationItemError) throw error;
          throw new RotationItemError(item.kind, item.resourceId, asRotationError(error).code, { cause: error });
        }
        after = ref(item);
      }
      if (!page.next) return sealCursor;
      // A page whose items were all skipped still has to advance the cursor.
      after = page.next;
    }
  }

  return {
    /**
     * Stage and verify every item. Safe to call again after a fault: items that
     * were durably accepted are re-verified rather than re-encrypted.
     */
    async process(): Promise<void> {
      processed = 0;
      bytesProcessed = 0;
      phase = 'inventory';
      report(null);

      phase = 'records';
      const sealCursor = await walk([...BODY_KINDS, 'seal-wrapper']);
      // Seal bodies could not be touched on the first pass: their wrappers sort
      // after them, and a body cannot be re-encrypted before its new note key
      // exists. Only the Seal range is re-read.
      {
        phase = 'records';
        await walk(SEAL_BODY_KINDS, { from: sealCursor, stopAfterKind: 'seal-version' });
      }
      report(null);
    },

    async confirmRecovery(input: { profileId: string; generation: number; inventoryDigest: string }) {
      return call(() => api.confirmRecovery({ ...token, recovery: { ...input, acknowledged: true } }));
    },

    async commit(): Promise<RotationStatus> {
      phase = 'commit';
      report(null);
      return call(() => api.commit({ ...token }));
    },

    /** Exposed for the wizard's resume path and for tests. */
    get sealCount() {
      return sealWrappers.size;
    },
  };
}
