import path from 'path';
import { isWithinRoot, resolveProjectRoot, resolveDocumentDir } from './pathSecurity.js';

describe('isWithinRoot', () => {
  const root = '/project';

  it.each([
    ['/project/src/file.ts', true],
    ['/project', true],
    ['/project/deep/nested/file.ts', true],
    ['/other/place', false],
    ['/projectExtra/file.ts', false],
  ])('isWithinRoot(%s, /project) => %s', (candidate, expected) => {
    expect(isWithinRoot(candidate, root)).toBe(expected);
  });

  it('resolves relative paths before comparing', () => {
    expect(isWithinRoot('/project/src/../src/file.ts', root)).toBe(true);
    expect(isWithinRoot('/project/../other', root)).toBe(false);
  });
});

describe('resolveProjectRoot', () => {
  it('returns resolved configRootDir when provided', () => {
    expect(resolveProjectRoot('/my/project')).toBe(path.resolve('/my/project'));
  });

  it('falls back to process.cwd() when no arg', () => {
    expect(resolveProjectRoot()).toBe(path.resolve(process.cwd()));
    expect(resolveProjectRoot(undefined)).toBe(path.resolve(process.cwd()));
  });
});

describe('resolveDocumentDir', () => {
  it('returns the directory of the document relative to rootDir', () => {
    const result = resolveDocumentDir('/project', 'docs/guide/README.md');
    expect(result).toBe(path.resolve('/project', 'docs/guide'));
  });
});
