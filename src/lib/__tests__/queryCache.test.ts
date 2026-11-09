import { QueryClient, InfiniteData } from '@tanstack/react-query';
import {
  insertAtTop,
  filterOut,
  patchInPlace,
  toggleArchive,
  restoreSnapshots,
  sortTierLists,
  type Snapshot,
  type WithId,
} from '@/lib/queryCache';

type TestNote = WithId & { title: string };

function makePages(items: TestNote[][]): InfiniteData<TestNote[]> {
  return { pages: items, pageParams: items.map((_, i) => i) };
}

function makeSnapshot(view: string, items: TestNote[][]): Snapshot<TestNote> {
  return [['notes', 'user1', view], makePages(items)];
}

describe('queryCache helpers', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
  });

  afterEach(() => {
    qc.clear();
  });

  describe('insertAtTop', () => {
    it('inserts item at top of first page in active view', () => {
      const existing: TestNote = { _id: '1', archived: false, title: 'old' };
      const newItem: TestNote = { _id: '2', archived: false, title: 'new' };
      const snapshots: Snapshot<TestNote>[] = [makeSnapshot('active', [[existing]])];

      qc.setQueryData(snapshots[0][0], snapshots[0][1]);
      insertAtTop(qc, snapshots, newItem);

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0][0]).toEqual(newItem);
      expect(data!.pages[0][1]).toEqual(existing);
    });

    it('skips archived views', () => {
      const newItem: TestNote = { _id: '2', archived: false, title: 'new' };
      const snapshots: Snapshot<TestNote>[] = [
        makeSnapshot('archived', [[{ _id: '1', archived: true, title: 'old' }]]),
      ];

      qc.setQueryData(snapshots[0][0], snapshots[0][1]);
      insertAtTop(qc, snapshots, newItem);

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0]).toHaveLength(1);
      expect(data!.pages[0][0]._id).toBe('1');
    });
  });

  describe('filterOut', () => {
    it('removes item by id across all pages', () => {
      const snapshots: Snapshot<TestNote>[] = [
        makeSnapshot('active', [
          [
            { _id: '1', archived: false, title: 'a' },
            { _id: '2', archived: false, title: 'b' },
          ],
          [{ _id: '3', archived: false, title: 'c' }],
        ]),
      ];

      qc.setQueryData(snapshots[0][0], snapshots[0][1]);
      filterOut(qc, snapshots, '2');

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0]).toHaveLength(1);
      expect(data!.pages[0][0]._id).toBe('1');
      expect(data!.pages[1]).toHaveLength(1);
    });

    it('does nothing when id not found', () => {
      const snapshots: Snapshot<TestNote>[] = [makeSnapshot('active', [[{ _id: '1', archived: false, title: 'a' }]])];

      qc.setQueryData(snapshots[0][0], snapshots[0][1]);
      filterOut(qc, snapshots, 'nonexistent');

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0]).toHaveLength(1);
    });
  });

  describe('patchInPlace', () => {
    it('patches matching item', () => {
      const snapshots: Snapshot<TestNote>[] = [makeSnapshot('active', [[{ _id: '1', archived: false, title: 'old' }]])];

      qc.setQueryData(snapshots[0][0], snapshots[0][1]);
      patchInPlace(qc, snapshots, '1', { title: 'updated' });

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0][0].title).toBe('updated');
      expect(data!.pages[0][0]._id).toBe('1');
    });

    it('leaves non-matching items untouched', () => {
      const snapshots: Snapshot<TestNote>[] = [
        makeSnapshot('active', [
          [
            { _id: '1', archived: false, title: 'a' },
            { _id: '2', archived: false, title: 'b' },
          ],
        ]),
      ];

      qc.setQueryData(snapshots[0][0], snapshots[0][1]);
      patchInPlace(qc, snapshots, '1', { title: 'patched' });

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0][1].title).toBe('b');
    });
  });

  describe('toggleArchive', () => {
    it('moves note from active to archived view', () => {
      const note: TestNote = { _id: '1', archived: false, title: 'test' };
      const activeSnapshot: Snapshot<TestNote> = [['notes', 'user1', 'active'], makePages([[note]])];
      const archivedSnapshot: Snapshot<TestNote> = [['notes', 'user1', 'archived'], makePages([[]])];
      const snapshots = [activeSnapshot, archivedSnapshot];

      qc.setQueryData(activeSnapshot[0], activeSnapshot[1]);
      qc.setQueryData(archivedSnapshot[0], archivedSnapshot[1]);
      toggleArchive(qc, snapshots, '1', true, { title: 'test' });

      const activeData = qc.getQueryData<InfiniteData<TestNote[]>>(activeSnapshot[0]);
      const archivedData = qc.getQueryData<InfiniteData<TestNote[]>>(archivedSnapshot[0]);

      expect(activeData!.pages[0]).toHaveLength(0);
      expect(archivedData!.pages[0]).toHaveLength(1);
      expect(archivedData!.pages[0][0].archived).toBe(true);
    });

    it('does nothing when note not found', () => {
      const snapshots: Snapshot<TestNote>[] = [makeSnapshot('active', [[{ _id: '1', archived: false, title: 'a' }]])];

      qc.setQueryData(snapshots[0][0], snapshots[0][1]);
      toggleArchive(qc, snapshots, 'nonexistent', true, {});

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0]).toHaveLength(1);
    });
  });

  describe('snoozed notes', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    it('snoozing moves a note from the active view into the archive', () => {
      const note: TestNote = { _id: '1', archived: false, title: 'later' };
      const snapshots: Snapshot<TestNote>[] = [makeSnapshot('active', [[note]]), makeSnapshot('archived', [[]])];
      snapshots.forEach(([key, data]) => qc.setQueryData(key, data));

      toggleArchive(qc, snapshots, '1', true, { snoozedUntil: future });

      expect(qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0])!.pages[0]).toEqual([]);
      expect(qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[1][0])!.pages[0][0]).toMatchObject({
        _id: '1',
        archived: true,
        snoozedUntil: future,
      });
    });

    it('a note back from a snooze is placed in the active view despite being archived', () => {
      const back: TestNote = { _id: '1', archived: true, snoozedUntil: past, title: 'back' };
      const snapshots: Snapshot<TestNote>[] = [makeSnapshot('active', [[]]), makeSnapshot('archived', [[]])];
      snapshots.forEach(([key, data]) => qc.setQueryData(key, data));

      insertAtTop(qc, snapshots, back);

      expect(qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0])!.pages[0]).toEqual([back]);
      expect(qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[1][0])!.pages[0]).toEqual([]);
    });

    it('sorts a returned note below pinned notes and above the rest', () => {
      type Sortable = TestNote & { pinned?: boolean; position: number };
      const items: Sortable[] = [
        { _id: 'new', archived: false, title: 'new', position: 3000 },
        { _id: 'pin', archived: false, title: 'pin', position: 2000, pinned: true },
        { _id: 'back', archived: true, snoozedUntil: past, title: 'back', position: 1000 },
      ];
      const snapshots: Snapshot<TestNote>[] = [makeSnapshot('active', [items])];
      qc.setQueryData(snapshots[0][0], snapshots[0][1]);

      sortTierLists(qc, snapshots);

      const ids = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0])!.pages[0].map((n) => n._id);
      expect(ids).toEqual(['pin', 'back', 'new']);
    });
  });

  describe('restoreSnapshots', () => {
    it('restores all query data from snapshots', () => {
      const snapshots: Snapshot<TestNote>[] = [
        makeSnapshot('active', [[{ _id: '1', archived: false, title: 'restored' }]]),
      ];

      restoreSnapshots(qc, snapshots);

      const data = qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0]);
      expect(data!.pages[0][0].title).toBe('restored');
    });
  });
});

it('archiving keeps an item in the all-items view', () => {
  const qc = new QueryClient();
  const snapshots = [makeSnapshot('all', [[{ _id: 'one', archived: false, title: 'Note' }]])];
  qc.setQueryData(snapshots[0][0], snapshots[0][1]);
  toggleArchive(qc, snapshots, 'one', true, {});
  expect(qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0])!.pages[0]).toEqual([
    { _id: 'one', archived: true, title: 'Note' },
  ]);
  qc.clear();
});

it('undoing deletion of an archived note restores it to the archive', () => {
  const qc = new QueryClient();
  const snapshots = [makeSnapshot('archived', [[]]), makeSnapshot('active', [[]])];
  snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
  insertAtTop(qc, snapshots, { _id: 'one', archived: true, title: 'Archived' });
  expect(qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[0][0])!.pages[0]).toHaveLength(1);
  expect(qc.getQueryData<InfiniteData<TestNote[]>>(snapshots[1][0])!.pages[0]).toHaveLength(0);
  qc.clear();
});
