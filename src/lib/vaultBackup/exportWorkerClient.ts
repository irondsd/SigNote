import type { VaultExportBeginResult, VaultExportProgress, VaultExportWorkerResult } from './exportTypes';

type WorkerEvent =
  | { type: 'stream'; stream: ReadableStream<Uint8Array> }
  | { type: 'progress'; progress: VaultExportProgress }
  | { type: 'complete'; result: VaultExportWorkerResult }
  | { type: 'error'; code: string };

export type VaultExportWorker = {
  stream: Promise<ReadableStream<Uint8Array>>;
  completed: Promise<VaultExportWorkerResult>;
  cancel(): void;
};

export function createVaultExportWorker(
  plan: VaultExportBeginResult,
  password: string,
  onProgress: (progress: VaultExportProgress) => void,
): VaultExportWorker {
  const worker = new Worker(new URL('../../workers/vaultExport.worker.ts', import.meta.url), { type: 'module' });
  let resolveStream!: (stream: ReadableStream<Uint8Array>) => void;
  let rejectStream!: (error: Error) => void;
  let resolveCompleted!: (result: VaultExportWorkerResult) => void;
  let rejectCompleted!: (error: Error) => void;
  let settled = false;
  const stream = new Promise<ReadableStream<Uint8Array>>((resolve, reject) => {
    resolveStream = resolve;
    rejectStream = reject;
  });
  const completed = new Promise<VaultExportWorkerResult>((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });
  // A failure before the stream is handed over rejects both promises, but the
  // caller only awaits `stream` in that case.
  void completed.catch(() => undefined);
  const fail = (code: string) => {
    if (settled) return;
    settled = true;
    const error = new Error(code);
    rejectStream(error);
    rejectCompleted(error);
    worker.terminate();
  };
  worker.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
    if (event.data.type === 'stream') resolveStream(event.data.stream);
    else if (event.data.type === 'progress') onProgress(event.data.progress);
    else if (event.data.type === 'complete') {
      settled = true;
      resolveCompleted(event.data.result);
      worker.terminate();
    } else fail(event.data.code);
  });
  worker.addEventListener('error', () => fail('EXPORT_WORKER_FAILED'));
  worker.postMessage({ type: 'start', plan, password });
  return {
    stream,
    completed,
    cancel() {
      worker.postMessage({ type: 'cancel' });
      fail('CANCELLED');
    },
  };
}
