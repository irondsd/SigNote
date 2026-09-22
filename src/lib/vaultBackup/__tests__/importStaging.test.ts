import { planStagingRequests, StagingRecordTooLargeError, type StagingRequest } from '../importStaging';
import type { PortableTierRecord, VaultImportStagedRecord } from '../importTypes';

const NOW = '2026-09-18T12:00:00.000Z';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const note = (id: string, contentBytes: number, versions = 0): VaultImportStagedRecord => ({
  action: 'insert',
  expected: null,
  record: {
    id,
    title: id,
    content: 'x'.repeat(contentBytes),
    position: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    archived: false,
    color: null,
    pattern: null,
    pinned: false,
    expiresAt: null,
    burnAfterReading: false,
    history: Array.from({ length: versions }, (_, index) => ({
      title: `v${index}`,
      content: String(index).repeat(contentBytes),
      createdAt: NOW,
    })),
    tagRefs: [],
    attachmentRefs: [],
  } as PortableTierRecord,
});

const body = (request: StagingRequest) =>
  request.kind === 'records' ? request.records : { id: request.id, versions: request.versions };

describe('planStagingRequests', () => {
  it('keeps small records in count-limited batches', () => {
    const items = Array.from({ length: 120 }, (_, index) => note(`n${index}`, 10));
    const requests = planStagingRequests(items, 3_000_000, 50);
    expect(requests.map((request) => request.kind === 'records' && request.records.length)).toEqual([50, 50, 20]);
  });

  it('cuts batches by size, never sending a body over the budget', () => {
    const items = Array.from({ length: 10 }, (_, index) => note(`n${index}`, 400));
    const budget = 2_000;
    const requests = planStagingRequests(items, budget, 50);
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) expect(bytes(body(request))).toBeLessThanOrEqual(budget);
    expect(requests.flatMap((request) => (request.kind === 'records' ? request.records : []))).toEqual(items);
  });

  it('splits a record larger than a request into its head and appended history', () => {
    const big = note('big', 900, 10);
    const budget = 3_000;
    const requests = planStagingRequests([note('small', 10), big], budget, 50);

    for (const request of requests) expect(bytes(body(request))).toBeLessThanOrEqual(budget);
    const head = requests.find(
      (request) => request.kind === 'records' && request.records.some((item) => item.record.id === 'big'),
    );
    expect(head?.kind === 'records' && head.records).toEqual([
      expect.objectContaining({ historyTotal: 10, record: expect.objectContaining({ id: 'big' }) }),
    ]);
    // Head history plus every appended version, in order, is the original.
    const headHistory = head?.kind === 'records' ? (head.records[0].record as PortableTierRecord).history : [];
    const appended = requests.flatMap((request) => (request.kind === 'history' ? request.versions : []));
    expect([...headHistory, ...appended]).toEqual((big.record as PortableTierRecord).history);
  });

  it('refuses a record whose head alone cannot fit', () => {
    expect(() => planStagingRequests([note('huge', 5_000)], 3_000, 50)).toThrow(StagingRecordTooLargeError);
  });
});
