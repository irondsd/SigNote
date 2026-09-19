// Preserve click order at the server (especially delete → Undo and repeated
// saves), while TanStack applies each optimistic change immediately.
import { accountScopeIsCurrent, activeAccountScope } from '@/lib/accountScope';

const writes = new Map<string, Promise<unknown>>();

export class AccountChangedDuringWriteError extends Error {
  constructor() {
    super('ACCOUNT_CHANGED_DURING_WRITE');
    this.name = 'AccountChangedDuringWriteError';
  }
}

export function queueTierWrite<T>(tier: string, id: string, write: () => Promise<T>): Promise<T> {
  const scope = activeAccountScope();
  const key = `${scope.userId ?? 'unscoped'}:${scope.revision}:${tier}:${id}`;
  const previous = writes.get(key);
  const guardedWrite = () => {
    if (!accountScopeIsCurrent(scope)) throw new AccountChangedDuringWriteError();
    return write();
  };
  const result = previous ? previous.catch(() => undefined).then(guardedWrite) : Promise.resolve().then(guardedWrite);
  writes.set(key, result);
  void result
    .finally(() => {
      if (writes.get(key) === result) writes.delete(key);
    })
    .catch(() => undefined);
  return result;
}
