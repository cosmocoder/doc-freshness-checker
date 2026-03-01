import {
  isIllustrativePath,
  isIllustrativeSymbol,
  compilePatterns,
  ILLUSTRATIVE_PATH_PATTERNS,
  ILLUSTRATIVE_SYMBOL_PATTERNS,
} from './illustrativePatterns.js';

describe('compilePatterns', () => {
  it('converts string patterns to case-insensitive RegExp', () => {
    const patterns = compilePatterns(['^test', 'example$']);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].test('TestFile')).toBe(true);
    expect(patterns[1].test('myExample')).toBe(true);
  });
});

describe('isIllustrativePath', () => {
  it.each([
    'YourProject/file.ts',
    'my-project/src/index.ts',
    'Example.tsx',
    'sample-app/main.py',
    'foo',
    'src/<component>/file.ts',
    'src/{name}/file.ts',
    'first.ts',
  ])('detects illustrative path: %s', (p) => {
    expect(isIllustrativePath(p)).toBe(true);
  });

  it.each(['src/utils/helper.ts', 'package.json', 'tsconfig.json'])('does not flag real path: %s', (p) => {
    expect(isIllustrativePath(p)).toBe(false);
  });

  it('supports custom patterns', () => {
    const custom = [/^custom-placeholder/i];
    expect(isIllustrativePath('custom-placeholder.ts', custom)).toBe(true);
    expect(isIllustrativePath('real-file.ts', custom)).toBe(false);
  });
});

describe('isIllustrativeSymbol', () => {
  it.each(['YourComponent', 'ExampleService', 'FooBar', 'MockAdapter', 'POST', 'a', 'Chat', 'Dashboard'])(
    'detects illustrative symbol: %s',
    (s) => {
      expect(isIllustrativeSymbol(s)).toBe(true);
    }
  );

  it.each(['DocumentParser', 'ValidationEngine', 'runParallel'])('does not flag real symbol: %s', (s) => {
    expect(isIllustrativeSymbol(s)).toBe(false);
  });
});

describe('pattern arrays are non-empty', () => {
  it('ILLUSTRATIVE_PATH_PATTERNS has entries', () => {
    expect(ILLUSTRATIVE_PATH_PATTERNS.length).toBeGreaterThan(0);
  });

  it('ILLUSTRATIVE_SYMBOL_PATTERNS has entries', () => {
    expect(ILLUSTRATIVE_SYMBOL_PATTERNS.length).toBeGreaterThan(0);
  });
});
