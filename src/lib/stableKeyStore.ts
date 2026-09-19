import { activeAccountScope } from '@/lib/accountScope';

const map = new Map<string, string>(); // realId → stableKey

const scoped = (realId: string) => {
  const account = activeAccountScope();
  return `${account.userId ?? 'unscoped'}:${account.revision}:${realId}`;
};

export function registerStableKey(realId: string, stableKey: string) {
  map.set(scoped(realId), stableKey);
}

export function getStableKey(id: string): string {
  return map.get(scoped(id)) ?? id;
}

export function clearStableKeys(): void {
  map.clear();
}
