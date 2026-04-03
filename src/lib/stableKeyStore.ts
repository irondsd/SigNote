const map = new Map<string, string>(); // realId → stableKey

export function registerStableKey(realId: string, stableKey: string) {
  map.set(realId, stableKey);
}

export function getStableKey(id: string): string {
  return map.get(id) ?? id;
}
