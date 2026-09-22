import { VAULT_IMPORT_LIMITS } from './importSchemas';
import type { PortableHistory, PortableTierRecord, VaultImportStagedRecord } from './importTypes';

/**
 * How the Worker packs staged records into requests. The server refuses a
 * body over VAULT_IMPORT_LIMITS.requestBytes, so batches are cut by size as
 * well as count, and a record too large on its own is split: its head with as
 * much history as fits, then the remaining versions appended in order.
 */

export type StagingRequest =
  | { kind: 'records'; records: VaultImportStagedRecord[] }
  | { kind: 'history'; id: string; versions: PortableHistory[] };

export class StagingRecordTooLargeError extends Error {
  constructor(readonly id: string) {
    super('LIMIT');
    this.name = 'StagingRecordTooLargeError';
  }
}

const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

/** Size of a JSON array from its members' sizes: brackets plus commas. */
const arraySize = (memberBytes: number, members: number) => 2 + memberBytes + Math.max(members - 1, 0);

export function planStagingRequests(
  items: VaultImportStagedRecord[],
  budget: number = VAULT_IMPORT_LIMITS.requestBytes,
  maxRecords: number = VAULT_IMPORT_LIMITS.requestRecords,
): StagingRequest[] {
  const requests: StagingRequest[] = [];
  let batch: VaultImportStagedRecord[] = [];
  let batchBytes = 0;
  const flush = () => {
    if (batch.length) requests.push({ kind: 'records', records: batch });
    batch = [];
    batchBytes = 0;
  };

  for (const item of items) {
    const bytes = size(item);
    if (batch.length < maxRecords && arraySize(batchBytes + bytes, batch.length + 1) <= budget) {
      batch.push(item);
      batchBytes += bytes;
      continue;
    }
    flush();
    if (arraySize(bytes, 1) <= budget) {
      batch = [item];
      batchBytes = bytes;
      continue;
    }
    requests.push(...splitRecord(item, budget));
  }
  flush();
  return requests;
}

function splitRecord(item: VaultImportStagedRecord, budget: number): StagingRequest[] {
  const record = item.record as PortableTierRecord;
  const history = record.history ?? [];
  const headWith = (count: number): VaultImportStagedRecord => ({
    ...item,
    record: { ...record, history: history.slice(0, count) },
    historyTotal: history.length,
  });
  let sent = 0;
  if (arraySize(size(headWith(0)), 1) > budget) throw new StagingRecordTooLargeError(record.id);
  while (sent < history.length && arraySize(size(headWith(sent + 1)), 1) <= budget) sent++;
  const requests: StagingRequest[] = [{ kind: 'records', records: [headWith(sent)] }];

  while (sent < history.length) {
    const versions: PortableHistory[] = [];
    while (sent < history.length && size({ id: record.id, versions: [...versions, history[sent]] }) <= budget)
      versions.push(history[sent++]);
    if (!versions.length) throw new StagingRecordTooLargeError(record.id);
    requests.push({ kind: 'history', id: record.id, versions });
  }
  return requests;
}
