/**
 * Минимальный LRU-кэш на Map (порядок вставки = порядок использования).
 *
 * Пакетный `lru-cache` не берём сознательно: он ESM-only, а бэкенд — CJS
 * (те же грабли, что с uuid/schedule). Для наших объёмов (тысячи записей,
 * TTL наружу) этого достаточно: O(1) get/set/evict.
 */
export class LruCache<V> {
  private readonly store = new Map<string, { value: V; at: number }>();

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`Invalid LruCache max="${max}": expected integer >= 1`);
    }
  }

  get size(): number {
    return this.store.size;
  }

  get(key: string): V | undefined {
    return this.getEntry(key)?.value;
  }

  /** Сырая запись без value-обёртки — для TTL-проверок снаружи. */
  getEntry(key: string): { value: V; at: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    // Refresh: удаление + вставка двигает ключ в конец (most-recently-used).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  set(key: string, value: V, at: number): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, at });
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
