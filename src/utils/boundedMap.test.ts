import { pruneOldestEntries, setWithMaxEntries } from './boundedMap.js';

describe('pruneOldestEntries', () => {
  it('does nothing when map size is within limit or limit is negative', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    pruneOldestEntries(map, 5);
    expect(map.size).toBe(2);

    pruneOldestEntries(map, -1);
    expect(map.size).toBe(2);
  });

  it('removes oldest entries to enforce maxEntries', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
    pruneOldestEntries(map, 2);
    expect(map.size).toBe(2);
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(false);
    expect(map.has('c')).toBe(true);
    expect(map.has('d')).toBe(true);
  });

  it('handles maxEntries of 0 by clearing the map', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    pruneOldestEntries(map, 0);
    expect(map.size).toBe(0);
  });
});

describe('setWithMaxEntries', () => {
  it('adds entry and prunes if over limit', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    setWithMaxEntries(map, 'c', 3, 2);
    expect(map.size).toBe(2);
    expect(map.has('a')).toBe(false);
    expect(map.get('c')).toBe(3);
  });

  it('updates existing entry without pruning unnecessarily', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    setWithMaxEntries(map, 'a', 10, 2);
    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(10);
  });
});
