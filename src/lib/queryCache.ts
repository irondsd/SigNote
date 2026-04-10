import { QueryClient, InfiniteData, QueryKey } from '@tanstack/react-query';

export type WithId = { _id: string; archived: boolean };

export type Snapshot<T> = [QueryKey, InfiniteData<T[]> | undefined];

export async function cancelAndSnapshot<T>(qc: QueryClient, rootKey: string): Promise<Snapshot<T>[]> {
  await qc.cancelQueries({ queryKey: [rootKey] });
  return qc.getQueriesData<InfiniteData<T[]>>({ queryKey: [rootKey] });
}

export function restoreSnapshots<T>(qc: QueryClient, snapshots: Snapshot<T>[]): void {
  snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
}

export function insertAtTop<T extends WithId>(qc: QueryClient, snapshots: Snapshot<T>[], item: T): void {
  snapshots.forEach(([queryKey, data]) => {
    if (!data) return;
    if (queryKey[2] === 'archived') return;
    const firstPage = data.pages[0] ?? [];
    qc.setQueryData(queryKey, {
      ...data,
      pages: [[item, ...firstPage], ...data.pages.slice(1)],
    });
  });
}

export function filterOut<T extends WithId>(qc: QueryClient, snapshots: Snapshot<T>[], id: string): void {
  snapshots.forEach(([queryKey, data]) => {
    if (!data) return;
    qc.setQueryData(queryKey, {
      ...data,
      pages: data.pages.map((page) => page.filter((n) => n._id !== id)),
    });
  });
}

export function patchInPlace<T extends WithId>(
  qc: QueryClient,
  snapshots: Snapshot<T>[],
  id: string,
  patch: Partial<T>,
): void {
  snapshots.forEach(([queryKey, data]) => {
    if (!data) return;
    qc.setQueryData(queryKey, {
      ...data,
      pages: data.pages.map((page) => page.map((n) => (n._id === id ? { ...n, ...patch } : n))),
    });
  });
}

export function invalidateSnapshots<T>(qc: QueryClient, snapshots: Snapshot<T>[]): Promise<void[]> {
  return Promise.all(snapshots.map(([queryKey]) => qc.invalidateQueries({ queryKey, exact: true })));
}

export function toggleArchive<T extends WithId>(
  qc: QueryClient,
  snapshots: Snapshot<T>[],
  id: string,
  archived: boolean,
  patch: Partial<T>,
): void {
  let foundNote: T | undefined;
  outer: for (const [, data] of snapshots) {
    if (!data) continue;
    for (const page of data.pages) {
      const n = page.find((note) => note._id === id);
      if (n) {
        foundNote = n;
        break outer;
      }
    }
  }
  if (!foundNote) return;

  const updated = { ...foundNote, ...patch, archived } as T;

  snapshots.forEach(([queryKey, data]) => {
    if (!data) return;
    const isArchivedView = queryKey[2] === 'archived';
    const noteNowBelongsHere = (archived === true) === isArchivedView;

    if (noteNowBelongsHere) {
      const firstPage = data.pages[0] ?? [];
      qc.setQueryData(queryKey, {
        ...data,
        pages: [[updated, ...firstPage.filter((n) => n._id !== id)], ...data.pages.slice(1)],
      });
    } else {
      qc.setQueryData(queryKey, {
        ...data,
        pages: data.pages.map((page) => page.filter((n) => n._id !== id)),
      });
    }
  });
}
