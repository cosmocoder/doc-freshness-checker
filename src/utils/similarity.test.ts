import { levenshteinDistance, findSimilar, similarityRatio } from './similarity.js';

describe('levenshteinDistance', () => {
  it.each([
    ['', '', 0],
    ['abc', '', 3],
    ['', 'xyz', 3],
    ['kitten', 'sitting', 3],
    ['same', 'same', 0],
    ['abc', 'abd', 1],
  ])('levenshteinDistance(%s, %s) => %d', (a, b, expected) => {
    expect(levenshteinDistance(a, b)).toBe(expected);
  });
});

describe('similarityRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(similarityRatio('hello', 'hello')).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(similarityRatio('', '')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(similarityRatio('Hello', 'hello')).toBe(1);
  });

  it('returns a value between 0 and 1 for different strings', () => {
    const ratio = similarityRatio('kitten', 'sitting');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});

describe('findSimilar', () => {
  it('returns null for empty candidates', () => {
    expect(findSimilar('test', [])).toBeNull();
    expect(findSimilar('test', null as unknown as string[])).toBeNull();
  });

  it('returns exact case-insensitive match preferentially', () => {
    expect(findSimilar('README', ['readme', 'other'])).toBe('readme');
  });

  it('returns closest match within maxDistance', () => {
    expect(findSimilar('fle', ['file', 'folder', 'xyz'])).toBe('file');
  });

  it('returns null when no match within default maxDistance', () => {
    expect(findSimilar('abc', ['xyzxyz', 'mnopqr'])).toBeNull();
  });

  it('respects custom maxDistance', () => {
    expect(findSimilar('abc', ['abd'], 1)).toBe('abd');
    expect(findSimilar('abc', ['xyz'], 1)).toBeNull();
  });
});
