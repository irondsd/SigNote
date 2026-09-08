import { QueryClient, InfiniteData, QueryKey } from '@tanstack/react-query';

export type WithId = { _id: string; archived: boolean };

const VIEW_INDEX = 2;

function isArchivedView(queryKey: QueryKey): boolean {
  return queryKey[VIEW_INDEX] === 'archived';
}

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
    if (queryKey[VIEW_INDEX] !== 'all' && isArchivedView(queryKey) !== item.archived) return;
    if (queryKey[3] || queryKey[4]) return; // Filtered searches are reconciled by the server.
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
    const isArchiveQuery = isArchivedView(queryKey);
    const noteNowBelongsHere = queryKey[VIEW_INDEX] === 'all' || archived === isArchiveQuery;

    if (noteNowBelongsHere) {
      if ((queryKey[3] || queryKey[4]) && !data.pages.some((page) => page.some((n) => n._id === id))) return;
      const firstPage = data.pages[0] ?? [];
      qc.setQueryData(queryKey, {
        ...data,
        pages: [
          [updated, ...firstPage.filter((n) => n._id !== id)],
          ...data.pages.slice(1).map((page) => page.filter((n) => n._id !== id)),
        ],
      });
    } else {
      qc.setQueryData(queryKey, {
        ...data,
        pages: data.pages.map((page) => page.filter((n) => n._id !== id)),
      });
    }
  });
}

/** Roll back only this item. Other optimistic mutations may already be in the cache. */
export function rollbackItem<T extends WithId>(
  qc: QueryClient,
  snapshots: Snapshot<T>[],
  id: string,
  optimistic?: Partial<T>,
  restorePosition = false,
): void {
  for (const [key, before] of snapshots) {
    if (!before) continue;
    const previous = before.pages.flat().find((item) => item._id === id);
    qc.setQueryData<InfiniteData<T[]>>(key, (current) => {
      if (!current) return current;
      const present = current.pages.flat().find((item) => item._id === id);
      if (!previous) return { ...current, pages: current.pages.map((page) => page.filter((item) => item._id !== id)) };
      if (!present) {
        if (optimistic && !('archived' in optimistic)) return current;
        const pageIndex = before.pages.findIndex((page) => page.some((item) => item._id === id));
        const index = before.pages[pageIndex].findIndex((item) => item._id === id);
        return {
          ...current,
          pages: current.pages.map((page, i) => {
            if (i !== pageIndex) return page;
            const restored = [...page];
            restored.splice(index, 0, previous);
            return restored;
          }),
        };
      }
      const restored = { ...present };
      for (const field of Object.keys(optimistic ?? previous) as (keyof T)[]) {
        if (!optimistic || JSON.stringify(present[field]) === JSON.stringify(optimistic[field])) {
          restored[field] = previous[field];
        }
      }
      if (restorePosition) {
        const ordered = current.pages.flat().filter((item) => item._id !== id);
        ordered.splice(
          before.pages.flat().findIndex((item) => item._id === id),
          0,
          restored,
        );
        let offset = 0;
        return {
          ...current,
          pages: current.pages.map((page) => {
            const result = ordered.slice(offset, offset + page.length);
            offset += page.length;
            return result;
          }),
        };
      }
      return {
        ...current,
        pages: current.pages.map((page) => page.map((item) => (item._id === id ? restored : item))),
      };
    });
  }
}

/** Keep pin order immediate in ordinary lists, preserving the server's search ranking. */
export function sortTierLists<T extends WithId>(qc: QueryClient, snapshots: Snapshot<T>[]): void {
  for (const [key] of snapshots) {
    if (key[3]) continue;
    qc.setQueryData<InfiniteData<T[]>>(key, (data) => {
      if (!data) return data;
      type Sortable = T & { pinned?: boolean; position?: number };
      const ordered = [...data.pages.flat()].sort(
        (a: Sortable, b: Sortable) => Number(!!b.pinned) - Number(!!a.pinned) || (b.position ?? 0) - (a.position ?? 0),
      );
      let offset = 0;
      return {
        ...data,
        pages: data.pages.map((page) => {
          const result = ordered.slice(offset, offset + page.length);
          offset += page.length;
          return result;
        }),
      };
    });
  }
}
