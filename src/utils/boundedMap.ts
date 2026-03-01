/**
 * Keep only the newest maxEntries items by removing oldest insertions.
 */
export function pruneOldestEntries<K, V>(map: Map<K, V>, maxEntries: number): void {
  if (maxEntries < 0) return;
  if (map.size <= maxEntries) return;

  const overflow = map.size - maxEntries;
  const keys = Array.from(map.keys());
  for (let i = 0; i < overflow; i++) {
    map.delete(keys[i]);
  }
}

/**
 * Set an entry and enforce a maximum map size.
 */
export function setWithMaxEntries<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
  map.set(key, value);
  pruneOldestEntries(map, maxEntries);
}
