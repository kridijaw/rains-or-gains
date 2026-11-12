export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Accessing web storage throws in some privacy modes, so callers get null and skip caching.
export function webStorage(kind: "localStorage" | "sessionStorage"): Store | null {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}

export function readCache<T>(store: Store | null, key: string, maxAgeMs: number, now = Date.now()): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const entry = JSON.parse(raw) as { t: number; v: T };
    if (now - entry.t <= maxAgeMs) return entry.v;
    store.removeItem(key);
  } catch {
    store.removeItem(key);
  }
  return null;
}

export function writeCache(store: Store | null, key: string, value: unknown, now = Date.now()): void {
  try {
    store?.setItem(key, JSON.stringify({ t: now, v: value }));
  } catch {
    // Quota exceeded: the data is still returned, just not cached.
  }
}

export async function cached<T>(
  store: Store | null,
  key: string,
  maxAgeMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = readCache<T>(store, key, maxAgeMs);
  if (hit !== null) return hit;
  const value = await load();
  writeCache(store, key, value);
  return value;
}
