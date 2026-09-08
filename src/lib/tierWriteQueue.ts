// Preserve click order at the server (especially delete → Undo and repeated
// saves), while TanStack applies each optimistic change immediately.
const writes = new Map<string, Promise<unknown>>();

export function queueTierWrite<T>(tier: string, id: string, write: () => Promise<T>): Promise<T> {
  const key = `${tier}:${id}`;
  const previous = writes.get(key);
  const result = previous ? previous.catch(() => undefined).then(write) : Promise.resolve().then(write);
  writes.set(key, result);
  void result
    .finally(() => {
      if (writes.get(key) === result) writes.delete(key);
    })
    .catch(() => undefined);
  return result;
}
