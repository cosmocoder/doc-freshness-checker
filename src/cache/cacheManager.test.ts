import fs from 'fs';
import os from 'os';
import path from 'path';
import { CacheManager } from './cacheManager.js';
import type { DocFreshnessConfig } from '../types.js';

describe('CacheManager', () => {
  const cacheDir = path.join(process.cwd(), '.doc-freshness-cache', 'test-cache');
  const config: DocFreshnessConfig = {
    rootDir: process.cwd(),
    cache: { dir: '.doc-freshness-cache/test-cache' },
  };

  afterAll(async () => {
    await fs.promises.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects cache directories outside the project root', async () => {
    const badConfig: DocFreshnessConfig = {
      rootDir: '/project',
      cache: { dir: '../../etc/evil' },
    };
    expect(() => new CacheManager(badConfig)).toThrow('strict descendant of project root');
    const disabledManager = new CacheManager({ ...badConfig, cache: { ...badConfig.cache, enabled: false } });
    await expect(disabledManager.clearCache()).rejects.toThrow('strict descendant of project root');
  });

  it('rejects the project root itself without deleting it', async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-cache-root-'));
    const sentinel = path.join(rootDir, 'sentinel');
    await fs.promises.writeFile(sentinel, 'keep');

    expect(() => new CacheManager({ rootDir, cache: { enabled: true, dir: '.' } })).toThrow('strict descendant of project root');
    expect(() => new CacheManager({ rootDir, cache: { enabled: true, dir: rootDir } })).toThrow('strict descendant of project root');
    const disabledManager = new CacheManager({ rootDir, cache: { enabled: false, dir: rootDir } });
    await expect(disabledManager.clearCache()).rejects.toThrow('strict descendant of project root');
    expect(await fs.promises.readFile(sentinel, 'utf-8')).toBe('keep');

    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  it('rejects cache symlinks that escape the project root', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-cache-link-'));
    const rootDir = path.join(tempDir, 'root');
    const outsideDir = path.join(tempDir, 'outside');
    const cacheLink = path.join(rootDir, 'cache');
    const sentinel = path.join(outsideDir, 'sentinel');
    await fs.promises.mkdir(rootDir);
    await fs.promises.mkdir(outsideDir);
    await fs.promises.writeFile(sentinel, 'keep');
    await fs.promises.symlink(outsideDir, cacheLink);

    expect(() => new CacheManager({ rootDir, cache: { enabled: true, dir: 'cache/nested' } })).toThrow('strict descendant of project root');
    const disabledManager = new CacheManager({ rootDir, cache: { enabled: false, dir: 'cache/nested' } });
    await disabledManager.saveUrlCache({ test: { result: { valid: true }, timestamp: Date.now() } });
    await expect(disabledManager.clearCache()).rejects.toThrow('strict descendant of project root');
    expect(await fs.promises.readdir(outsideDir)).toEqual(['sentinel']);
    expect(await fs.promises.readFile(sentinel, 'utf-8')).toBe('keep');

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('revalidates containment after a safe cache ancestor is replaced by a symlink', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-cache-swap-'));
    const rootDir = path.join(tempDir, 'root');
    const outsideDir = path.join(tempDir, 'outside');
    const cacheAncestor = path.join(rootDir, 'results');
    await fs.promises.mkdir(path.join(cacheAncestor, 'cache'), { recursive: true });
    await fs.promises.mkdir(outsideDir);
    await fs.promises.writeFile(path.join(outsideDir, 'sentinel'), 'keep');
    const manager = new CacheManager({ rootDir, cache: { enabled: true, dir: 'results/cache' } });

    await fs.promises.rm(cacheAncestor, { recursive: true, force: true });
    await fs.promises.symlink(outsideDir, cacheAncestor);

    await expect(manager.saveUrlCache({ test: { result: { valid: true }, timestamp: Date.now() } })).rejects.toThrow(
      'strict descendant of project root'
    );
    await expect(manager.writeEmbeddingCache('{}')).rejects.toThrow('strict descendant of project root');
    expect(await fs.promises.readdir(outsideDir)).toEqual(['sentinel']);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects symbolic links at final cache file paths', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-cache-file-link-'));
    const rootDir = path.join(tempDir, 'root');
    const cachePath = path.join(rootDir, 'cache');
    const sentinel = path.join(tempDir, 'sentinel');
    await fs.promises.mkdir(cachePath, { recursive: true });
    await fs.promises.writeFile(sentinel, 'keep');
    await fs.promises.symlink(sentinel, path.join(cachePath, 'url-cache.json'));
    const manager = new CacheManager({ rootDir, cache: { enabled: true, dir: 'cache' } });

    await expect(manager.loadUrlCache()).rejects.toThrow('must not be a symbolic link');
    await expect(manager.saveUrlCache({ test: { result: { valid: true }, timestamp: Date.now() } })).rejects.toThrow(
      'must not be a symbolic link'
    );
    expect(await fs.promises.readFile(sentinel, 'utf-8')).toBe('keep');

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('atomically replaces a hard-linked cache file without changing its other link', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-cache-hard-link-'));
    const rootDir = path.join(tempDir, 'root');
    const cachePath = path.join(rootDir, 'cache');
    const cacheFile = path.join(cachePath, 'url-cache.json');
    const sentinel = path.join(tempDir, 'sentinel');
    const urlData = { 'https://example.com': { result: { valid: true }, timestamp: Date.now() } };
    await fs.promises.mkdir(cachePath, { recursive: true });
    await fs.promises.writeFile(sentinel, 'keep');
    await fs.promises.link(sentinel, cacheFile);
    const manager = new CacheManager({ rootDir, cache: { enabled: true, dir: 'cache' } });

    await manager.saveUrlCache(urlData);

    expect(await fs.promises.readFile(sentinel, 'utf-8')).toBe('keep');
    expect(await manager.loadUrlCache()).toEqual(urlData);
    expect(await fs.promises.readdir(cachePath)).toEqual(['url-cache.json']);

    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('URL cache operations', () => {
    it('saves and loads URL cache', async () => {
      const manager = new CacheManager(config);
      const urlData = { 'https://example.com': { result: { valid: true }, timestamp: Date.now() } };
      await manager.saveUrlCache(urlData);
      const loaded = await manager.loadUrlCache();
      expect(loaded['https://example.com'].result.valid).toBe(true);
    });

    it('returns empty object when URL cache missing', async () => {
      const freshConfig: DocFreshnessConfig = { rootDir: process.cwd(), cache: { dir: '.doc-freshness-cache/no-url-cache' } };
      const manager = new CacheManager(freshConfig);
      expect(await manager.loadUrlCache()).toEqual({});
    });

    it('does not load or save URL results when caching is disabled', async () => {
      const disabledDir = path.join(cacheDir, 'disabled');
      const cacheFile = path.join(disabledDir, 'url-cache.json');
      await fs.promises.mkdir(disabledDir, { recursive: true });
      await fs.promises.writeFile(cacheFile, '{"sentinel":true}');
      const manager = new CacheManager({
        rootDir: process.cwd(),
        cache: { enabled: false, dir: path.relative(process.cwd(), disabledDir) },
      });

      expect(await manager.loadUrlCache()).toEqual({});
      await manager.saveUrlCache({ test: { result: { valid: true }, timestamp: Date.now() } });
      expect(await fs.promises.readFile(cacheFile, 'utf-8')).toBe('{"sentinel":true}');
    });

    it('treats ordinary read failures as cache misses', async () => {
      const manager = new CacheManager(config);
      const readSpy = vi.spyOn(fs.promises, 'readFile').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

      expect(await manager.loadUrlCache()).toEqual({});
      expect(await manager.readEmbeddingCache()).toBeNull();
      readSpy.mockRestore();
    });

    it('propagates final-file safety check failures other than absence', async () => {
      const manager = new CacheManager(config);
      const error = Object.assign(new Error('denied'), { code: 'EACCES' });
      const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
        throw error;
      });

      await expect(manager.loadUrlCache()).rejects.toBe(error);
      lstatSpy.mockRestore();
    });
  });

  describe('clearCache', () => {
    it('removes the cache directory', async () => {
      const manager = new CacheManager(config);
      await manager.saveUrlCache({ test: { result: { valid: true }, timestamp: Date.now() } });
      await manager.clearCache();
      expect(await manager.loadUrlCache()).toEqual({});
    });

    it('handles non-existent cache directory', async () => {
      const freshConfig: DocFreshnessConfig = { rootDir: process.cwd(), cache: { dir: '.doc-freshness-cache/ghost' } };
      const manager = new CacheManager(freshConfig);
      await expect(manager.clearCache()).resolves.not.toThrow();
    });

    it('propagates removal failures', async () => {
      const manager = new CacheManager(config);
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const rmSpy = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(error);

      await expect(manager.clearCache()).rejects.toBe(error);
      expect(rmSpy).toHaveBeenCalledWith(cacheDir, { recursive: true, force: true });
      rmSpy.mockRestore();
    });
  });
});
