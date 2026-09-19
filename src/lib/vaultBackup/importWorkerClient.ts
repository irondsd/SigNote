import type { ImportComparison, ImportDecision } from './importMerge';
import type { VaultImportAnalysis, VaultImportPlan, VaultImportProgress, VaultImportTagPolicy } from './importTypes';

type WorkerOutput =
  | { type: 'analysis'; analysis: VaultImportAnalysis }
  | { type: 'comparison'; comparison: ImportComparison }
  | { type: 'plan'; plan: VaultImportPlan }
  | { type: 'progress'; progress: VaultImportProgress }
  | { type: 'staged' }
  | { type: 'error'; code: string };

type Pending = { expect: WorkerOutput['type']; resolve: (value: unknown) => void; reject: (reason: Error) => void };

/** One request at a time: the Worker holds the parsed archive, the comparison
 * and the plan between steps, and each step replies exactly once. */
export class VaultImportWorkerClient {
  private readonly worker = new Worker(new URL('../../workers/vaultImport.worker.ts', import.meta.url), {
    type: 'module',
  });
  private pending: Pending | null = null;
  onProgress?: (progress: VaultImportProgress) => void;

  constructor() {
    this.worker.addEventListener('message', (event: MessageEvent<WorkerOutput>) => {
      const message = event.data;
      if (message.type === 'progress') {
        this.onProgress?.(message.progress);
        return;
      }
      const pending = this.pending;
      this.pending = null;
      if (!pending) return;
      if (message.type === 'error') pending.reject(new Error(message.code));
      else if (message.type !== pending.expect) pending.reject(new Error('IMPORT_FAILED'));
      else if (message.type === 'analysis') pending.resolve(message.analysis);
      else if (message.type === 'comparison') pending.resolve(message.comparison);
      else if (message.type === 'plan') pending.resolve(message.plan);
      else pending.resolve(undefined);
    });
    this.worker.addEventListener('error', () => {
      const pending = this.pending;
      this.pending = null;
      pending?.reject(new Error('IMPORT_FAILED'));
    });
  }

  private request<T>(expect: WorkerOutput['type'], message: unknown): Promise<T> {
    if (this.pending) return Promise.reject(new Error('IMPORT_BUSY'));
    return new Promise<T>((resolve, reject) => {
      this.pending = { expect, resolve: resolve as (value: unknown) => void, reject };
      this.worker.postMessage(message);
    });
  }

  analyze(file: File, password: string) {
    return this.request<VaultImportAnalysis>('analysis', { type: 'analyze', file, password });
  }

  compare(operationId: string, generation: number) {
    return this.request<ImportComparison>('comparison', { type: 'compare', operationId, generation });
  }

  plan(decisions: Map<string, ImportDecision>, tagPolicy: VaultImportTagPolicy) {
    return this.request<VaultImportPlan>('plan', { type: 'plan', decisions: [...decisions], tagPolicy });
  }

  stage(operationId: string, generation: number) {
    return this.request<void>('staged', { type: 'stage', operationId, generation });
  }

  cancel() {
    this.worker.postMessage({ type: 'cancel' });
    const pending = this.pending;
    this.pending = null;
    pending?.reject(new Error('CANCELLED'));
  }

  dispose() {
    this.worker.terminate();
  }
}
