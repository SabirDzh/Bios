import { LruCache } from './lru-cache';

describe('LruCache', () => {
  test('invalid max fails fast', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => new LruCache<boolean>(bad)).toThrow('Invalid LruCache max');
    }
  });

  test('get/set round-trip, miss is undefined', () => {
    const cache = new LruCache<boolean>(10);
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', true, 1000);
    expect(cache.get('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  test('evicts least-recently-used, not oldest-inserted', () => {
    const cache = new LruCache<string>(2);
    cache.set('a', 'a', 1);
    cache.set('b', 'b', 2);
    expect(cache.get('a')).toBe('a'); // refresh: теперь b — LRU
    cache.set('c', 'c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('a');
    expect(cache.get('c')).toBe('c');
  });

  test('set overwrites value and refreshes recency', () => {
    const cache = new LruCache<string>(2);
    cache.set('a', 'old', 1);
    cache.set('b', 'b', 2);
    cache.set('a', 'new', 3);
    cache.set('c', 'c', 4);
    expect(cache.get('a')).toBe('new');
    expect(cache.get('b')).toBeUndefined();
  });

  test('clear empties the cache', () => {
    const cache = new LruCache<boolean>(10);
    cache.set('a', true, 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});
