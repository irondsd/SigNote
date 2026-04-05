import { createStore, get, set, del } from 'idb-keyval';

// Phase 3: migrate to openDB from 'idb' at schema version 2 to add an
// 'encryption-material' store in the same 'signote-offline' database.

// Lazy — createStore calls indexedDB.open() immediately.
// This file is only loaded on the client (via QueryPersister with ssr:false).
let _queryCacheStore: ReturnType<typeof createStore> | null = null;
function getQueryCacheStore() {
  if (!_queryCacheStore) _queryCacheStore = createStore('signote-offline', 'query-cache');
  return _queryCacheStore;
}

export const queryCacheStorage = {
  getItem: (key: string): Promise<string | null> =>
    get<string>(key, getQueryCacheStore()).then((v) => v ?? null),
  setItem: (key: string, value: string): Promise<void> =>
    set(key, value, getQueryCacheStore()),
  removeItem: (key: string): Promise<void> =>
    del(key, getQueryCacheStore()),
};
