/// <reference lib="webworker" />

import sodium from 'libsodium-wrappers-sumo';

import type { VaultExportCategory } from '@/lib/vaultBackup/exportTypes';
import {
  parseVaultImportArchive,
  visitVaultImportAttachments,
  VaultImportArchiveError,
  type ParsedVaultImport,
} from '@/lib/vaultBackup/importArchive';
import {
  buildImportPlan,
  compareArchive,
  type ImportComparison,
  type ImportComparisonState,
  type ImportDecision,
  type ImportPlanResult,
} from '@/lib/vaultBackup/importMerge';
import type {
  VaultImportAnalysis,
  VaultImportLookupAttachment,
  VaultImportLookupCategory,
  VaultImportLookupRecord,
  VaultImportPlan,
  VaultImportProgress,
  VaultImportTagPolicy,
} from '@/lib/vaultBackup/importTypes';

type AnalyzeMessage = { type: 'analyze'; file: File; password: string };
type CompareMessage = { type: 'compare'; operationId: string; generation: number };
type PlanMessage = { type: 'plan'; decisions: Array<[string, ImportDecision]>; tagPolicy: VaultImportTagPolicy };
type StageMessage = { type: 'stage'; operationId: string; generation: number };
type CancelMessage = { type: 'cancel' };
type Input = AnalyzeMessage | CompareMessage | PlanMessage | StageMessage | CancelMessage;
type Output =
  | { type: 'analysis'; analysis: VaultImportAnalysis }
  | { type: 'comparison'; comparison: ImportComparison }
  | { type: 'plan'; plan: VaultImportPlan }
  | { type: 'progress'; progress: VaultImportProgress }
  | { type: 'staged' }
  | { type: 'error'; code: string };

const CATEGORIES: VaultExportCategory[] = ['notes', 'secrets', 'seals', 'authenticators'];
const LOOKUP_BATCH = 200;
const RECORD_BATCH = 50;

const scope = self as DedicatedWorkerGlobalScope;
let parsed: ParsedVaultImport | null = null;
let source: { file: File; password: string } | null = null;
let compared: ImportComparisonState | null = null;
let planned: ImportPlanResult | null = null;
let abort: AbortController | null = null;

function post(message: Output) {
  scope.postMessage(message);
}

function code(error: unknown) {
  if (error instanceof VaultImportArchiveError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'CANCELLED';
  const server = error instanceof Error ? /^IMPORT_HTTP_\d+:([A-Z_]+)$/.exec(error.message) : null;
  if (server && server[1] !== 'UNKNOWN') return server[1];
  if (error instanceof Error && error.message === 'IMPORT_DECISION_NOT_ALLOWED') return error.message;
  return 'IMPORT_FAILED';
}

async function analyze(file: File, password: string) {
  if (abort) throw new Error('IMPORT_ALREADY_ACTIVE');
  abort = new AbortController();
  const result = await parseVaultImportArchive(file.stream(), password);
  parsed = result;
  source = { file, password };
  compared = null;
  planned = null;
  abort = null;
  post({ type: 'analysis', analysis: result.analysis });
}

async function checkedFetch(url: string, init: RequestInit, generation: number) {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: abort?.signal,
    headers: {
      'X-Signote-Encryption-Generation': String(generation),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    // The server's code says *why* (destination changed, key mismatch…), which
    // the page turns into the right message.
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`IMPORT_HTTP_${response.status}:${body?.error ?? 'UNKNOWN'}`);
  }
  return response;
}

async function lookup<T>(operationId: string, generation: number, category: VaultImportLookupCategory, ids: string[]) {
  const found: T[] = [];
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH) {
    const response = await checkedFetch(
      `/api/vault-import/${operationId}/lookup`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, ids: ids.slice(offset, offset + LOOKUP_BATCH) }),
      },
      generation,
    );
    found.push(...((await response.json()) as T[]));
  }
  return found;
}

/** Asks the destination for what it holds under every archived id, then
 * compares digests locally. Only ids go up; only digests come back. */
async function compare(operationId: string, generation: number) {
  if (!parsed || abort) throw new Error('IMPORT_NOT_ANALYZED');
  abort = new AbortController();
  await sodium.ready;
  const existing = {} as Record<VaultExportCategory, Map<string, VaultImportLookupRecord>>;
  for (const category of CATEGORIES) {
    const ids = parsed.records[category].map((record) => record.id);
    const rows = ids.length ? await lookup<VaultImportLookupRecord>(operationId, generation, category, ids) : [];
    existing[category] = new Map(rows.map((row) => [row.id, row]));
  }
  const fileIds = parsed.analysis.attachments.map((attachment) => attachment.id);
  const files = fileIds.length
    ? await lookup<VaultImportLookupAttachment>(operationId, generation, 'attachments', fileIds)
    : [];
  const hash = (text: string) => sodium.to_hex(sodium.crypto_hash_sha256(sodium.from_string(text)));
  compared = compareArchive(
    parsed.analysis,
    parsed.records,
    existing,
    new Map(files.map((file) => [file.id, file])),
    hash,
  );
  planned = null;
  abort = null;
  post({ type: 'comparison', comparison: compared.comparison });
}

function plan(decisions: Array<[string, ImportDecision]>, tagPolicy: VaultImportTagPolicy) {
  if (!parsed || !compared) throw new Error('IMPORT_NOT_COMPARED');
  planned = buildImportPlan(parsed.analysis, parsed.records, compared, new Map(decisions), tagPolicy);
  post({ type: 'plan', plan: planned.plan });
}

async function stage(operationId: string, generation: number) {
  if (!parsed || !source || !planned || abort) throw new Error('IMPORT_NOT_PLANNED');
  abort = new AbortController();
  const { staged, uploads, plan: expected } = planned;
  const totalRecords = CATEGORIES.reduce((total, category) => total + staged[category].length, 0);
  const totalItems = totalRecords + uploads.size;
  let itemsProcessed = 0;
  let bytesProcessed = 0;
  const encoder = new TextEncoder();
  const recordBytes = CATEGORIES.reduce(
    (total, category) => total + encoder.encode(JSON.stringify(staged[category])).byteLength,
    0,
  );
  const byteCount = recordBytes + expected.expectedAttachmentBytes;
  for (const category of CATEGORIES) {
    const items = staged[category];
    for (let offset = 0; offset < items.length; offset += RECORD_BATCH) {
      const body = JSON.stringify(items.slice(offset, offset + RECORD_BATCH));
      await checkedFetch(
        `/api/vault-import/${operationId}/records/${category}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
        generation,
      );
      itemsProcessed += Math.min(RECORD_BATCH, items.length - offset);
      bytesProcessed += encoder.encode(body).byteLength;
      post({
        type: 'progress',
        progress: { stage: 'records', itemsProcessed, itemCount: totalItems, bytesProcessed, byteCount },
      });
    }
  }

  if (uploads.size)
    await visitVaultImportAttachments(source.file.stream(), source.password, async (attachmentId, body) => {
      // Files the plan does not need — identical records, kept records, files
      // a replace reuses — never leave the device.
      if (!uploads.has(attachmentId)) return;
      const grantResponse = await checkedFetch(
        `/api/vault-import/${operationId}/attachment/${encodeURIComponent(attachmentId)}/grant`,
        { method: 'POST' },
        generation,
      );
      const grant = (await grantResponse.json()) as { url: string; headers: Record<string, string> };
      const upload = await fetch(grant.url, {
        method: 'PUT',
        headers: grant.headers,
        body: new Blob([Uint8Array.from(body)]),
      });
      if (!upload.ok) throw new Error(`IMPORT_UPLOAD_${upload.status}`);
      await checkedFetch(
        `/api/vault-import/${operationId}/attachment/${encodeURIComponent(attachmentId)}/verify`,
        { method: 'POST' },
        generation,
      );
      itemsProcessed++;
      bytesProcessed += body.byteLength;
      post({
        type: 'progress',
        progress: { stage: 'attachments', itemsProcessed, itemCount: totalItems, bytesProcessed, byteCount },
      });
    });
  abort = null;
  post({ type: 'staged' });
}

scope.addEventListener('message', (event: MessageEvent<Input>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    abort?.abort();
    abort = null;
    parsed = null;
    source = null;
    compared = null;
    planned = null;
    return;
  }
  const work = (async () => {
    if (message.type === 'analyze') await analyze(message.file, message.password);
    else if (message.type === 'compare') await compare(message.operationId, message.generation);
    else if (message.type === 'plan') plan(message.decisions, message.tagPolicy);
    else await stage(message.operationId, message.generation);
  })();
  void work.catch((error) => {
    abort?.abort();
    abort = null;
    post({ type: 'error', code: code(error) });
  });
});
