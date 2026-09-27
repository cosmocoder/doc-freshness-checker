import fs from 'fs';
import os from 'os';
import path from 'path';
import { isWithinRoot, locateRealPath, resolveProjectRoot, resolveDocumentDir } from './pathSecurity.js';

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

describe('locateRealPath', () => {
  it('reports missing paths and rethrows other filesystem errors', async () => {
    const realpath = fs.promises.realpath;
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-path-security-'));
    try {
      const file = path.join(rootDir, 'file.txt');
      await fs.promises.writeFile(file, '');
      await expect(locateRealPath(path.join(rootDir, 'absent'), rootDir)).resolves.toBe('missing');
      await expect(locateRealPath(path.join(file, 'child'), rootDir)).resolves.toBe('missing');
      await fs.promises.symlink('loop-b', path.join(rootDir, 'loop-a'));
      await fs.promises.symlink('loop-a', path.join(rootDir, 'loop-b'));
      await expect(locateRealPath(path.join(rootDir, 'loop-a'), rootDir)).resolves.toBe('missing');
      await expect(locateRealPath(path.join(rootDir, 'a'.repeat(300)), rootDir)).resolves.toBe('missing');
      await expect(locateRealPath(path.join(rootDir, 'a\0b'), rootDir)).resolves.toBe('missing');

      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      vi.spyOn(fs.promises, 'realpath').mockRejectedValueOnce(permissionError);
      await expect(locateRealPath(file, rootDir)).rejects.toBe(permissionError);

      vi.spyOn(fs.promises, 'realpath').mockImplementation(async (candidate, options) =>
        candidate === rootDir ? Promise.reject(permissionError) : realpath(candidate, options)
      );
      await expect(locateRealPath(file, rootDir)).rejects.toBe(permissionError);
    }
    finally {
      vi.restoreAllMocks();
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
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
