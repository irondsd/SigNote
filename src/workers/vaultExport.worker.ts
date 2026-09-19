/// <reference lib="webworker" />

import sodium from 'libsodium-wrappers-sumo';

import { createEncryptedVaultBackupArchive, type VaultBackupArchiveEntry } from '@/lib/vaultBackup/archive';
import type {
  VaultExportBeginResult,
  VaultExportEntryPlan,
  VaultExportProgress,
  VaultExportWorkerResult,
} from '@/lib/vaultBackup/exportTypes';
import {
  plannedVaultExportManifestSize,
  vaultExportManifestBytes,
  vaultExportManifestWithoutDigest,
  type VaultExportManifestEntry,
} from '@/lib/vaultBackup/manifest';

type StartMessage = { type: 'start'; plan: VaultExportBeginResult; password: string };
type CancelMessage = { type: 'cancel' };
type WorkerInput = StartMessage | CancelMessage;
type WorkerOutput =
  | { type: 'stream'; stream: ReadableStream<Uint8Array> }
  | { type: 'progress'; progress: VaultExportProgress }
  | { type: 'complete'; result: VaultExportWorkerResult }
  | { type: 'error'; code: string };

const scope = self as DedicatedWorkerGlobalScope;
let activeAbort: AbortController | null = null;

function post(message: WorkerOutput, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

function errorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'CANCELLED';
  // A body cut off mid-stream is either; the server can't say which once it has begun.
  if (error instanceof Error && error.message === 'VAULT_CHANGED_OR_STREAM_INTERRUPTED') return error.message;
  if (error instanceof Error && /Vault changed|VAULT_CHANGED|409/.test(error.message)) return 'VAULT_CHANGED';
  return 'EXPORT_STREAM_FAILED';
}

function sha256Hex(message: Uint8Array): string {
  return sodium.to_hex(sodium.crypto_hash_sha256(message));
}

async function start(plan: VaultExportBeginResult, password: string) {
  if (activeAbort) throw new Error('EXPORT_ALREADY_ACTIVE');
  const abort = new AbortController();
  activeAbort = abort;
  await sodium.ready;

  const sourceTotalBytes = plan.entries.reduce((total, entry) => total + entry.size, 0);
  let sourceBytes = 0;
  const checksumPromises: Promise<VaultExportManifestEntry>[] = [];

  const sourceEntry = (entry: VaultExportEntryPlan): VaultBackupArchiveEntry => {
    let resolveChecksum!: (value: VaultExportManifestEntry) => void;
    let rejectChecksum!: (reason: unknown) => void;
    const checksum = new Promise<VaultExportManifestEntry>((resolve, reject) => {
      resolveChecksum = resolve;
      rejectChecksum = reject;
    });
    // A downstream cancellation may stop TAR before it reaches manifest.json.
    // Mark a failed source promise as observed even in that case.
    void checksum.catch(() => undefined);
    checksumPromises.push(checksum);

    return {
      path: entry.path,
      size: entry.size,
      source: (async function* () {
        const state = sodium.crypto_hash_sha256_init();
        let received = 0;
        try {
          const response = await fetch(entry.url, {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: abort.signal,
            headers: { 'X-Signote-Encryption-Generation': String(plan.generation) },
          }).catch((error: unknown) => {
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            // No response at all: the network failed, or the server gave up
            // on a record that changed after the snapshot.
            throw new Error('VAULT_CHANGED_OR_STREAM_INTERRUPTED');
          });
          if (!response.ok || !response.body) {
            const failure = new Error(response.status === 409 ? 'VAULT_CHANGED' : `EXPORT_SOURCE_${response.status}`);
            throw failure;
          }
          const declared = response.headers.get('Content-Length');
          if (declared !== null && Number(declared) !== entry.size) throw new Error('VAULT_CHANGED');

          const reader = response.body.getReader();
          let completed = false;
          try {
            while (true) {
              let next: ReadableStreamReadResult<Uint8Array>;
              try {
                next = await reader.read();
              } catch {
                throw new Error('VAULT_CHANGED_OR_STREAM_INTERRUPTED');
              }
              const { done, value } = next;
              if (done) {
                completed = true;
                break;
              }
              received += value.byteLength;
              if (received > entry.size) throw new Error('VAULT_CHANGED');
              sodium.crypto_hash_sha256_update(state, value);
              sourceBytes += value.byteLength;
              post({
                type: 'progress',
                progress: {
                  category: entry.category,
                  itemsProcessed: received === entry.size ? entry.itemCount : 0,
                  itemCount: entry.itemCount,
                  sourceBytes,
                  sourceTotalBytes,
                },
              });
              yield value;
            }
          } finally {
            if (!completed) await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
          if (received !== entry.size) throw new Error('VAULT_CHANGED');
          resolveChecksum({
            path: entry.path,
            bytes: received,
            sha256: sodium.to_hex(sodium.crypto_hash_sha256_final(state)),
          });
        } catch (error) {
          rejectChecksum(error);
          // The page already holds the stream and sees only that it broke.
          // Say why, or a changed vault reads as a generic failure.
          post({ type: 'error', code: errorCode(error) });
          throw error;
        }
      })(),
    };
  };

  const entries = plan.entries.map(sourceEntry);
  const manifestSize = plannedVaultExportManifestSize(plan.manifest, plan.entries);
  let manifestDigest = '';
  entries.push({
    path: 'manifest.json',
    size: manifestSize,
    source: (async function* () {
      const checksums = await Promise.all(checksumPromises);
      const withoutDigest = vaultExportManifestWithoutDigest(plan.manifest, checksums);
      manifestDigest = sha256Hex(new TextEncoder().encode(JSON.stringify(withoutDigest)));
      const body = vaultExportManifestBytes({ ...withoutDigest, digest: manifestDigest });
      if (body.byteLength !== manifestSize) throw new Error('MANIFEST_SIZE_MISMATCH');
      yield body;
    })(),
  });

  const archive = await createEncryptedVaultBackupArchive(entries, password);
  const encrypted = archive.readable.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      async flush() {
        await archive.completed;
        post({
          type: 'complete',
          result: { manifestDigest, plaintextBytes: sourceTotalBytes + manifestSize },
        });
        activeAbort = null;
      },
    }),
  );
  post({ type: 'stream', stream: encrypted }, [encrypted as unknown as Transferable]);
}

scope.addEventListener('message', (event: MessageEvent<WorkerInput>) => {
  if (event.data.type === 'cancel') {
    activeAbort?.abort();
    activeAbort = null;
    return;
  }
  void start(event.data.plan, event.data.password).catch((error) => {
    activeAbort?.abort();
    activeAbort = null;
    post({ type: 'error', code: errorCode(error) });
  });
});
