import fs from 'fs';
import path from 'path';
import { CacheManager } from './cacheManager.js';
import { CodeDocGraph } from '../graph/codeDocGraph.js';
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

  it('throws if cache dir resolves outside project root', () => {
    const badConfig: DocFreshnessConfig = {
      rootDir: '/project',
      cache: { dir: '../../etc/evil' },
    };
    expect(() => new CacheManager(badConfig)).toThrow('outside project root');
  });

  describe('graph operations', () => {
    it('saves and loads a graph', async () => {
      const manager = new CacheManager(config);
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', { type: 'file-path', value: 'a.ts', lineNumber: 1, raw: 'a.ts', sourceFile: 'doc.md' });
      graph.buildTimestamp = Date.now();

      await manager.saveGraph(graph);
      const loaded = await manager.loadGraph();

      expect(loaded).not.toBeNull();
      expect(loaded!.getCodeReferencedByDoc('doc.md').has('src/a.ts')).toBe(true);
    });

    it('loadGraph returns null when no cache exists', async () => {
      const freshConfig: DocFreshnessConfig = {
        rootDir: process.cwd(),
        cache: { dir: '.doc-freshness-cache/nonexistent-test' },
      };
      const manager = new CacheManager(freshConfig);
      expect(await manager.loadGraph()).toBeNull();
    });
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
  });

  describe('isCacheValid', () => {
    it('returns false for null graph', () => {
      const manager = new CacheManager(config);
      expect(manager.isCacheValid(null, null)).toBe(false);
    });

    it('returns false when graph has no buildTimestamp', () => {
      const manager = new CacheManager(config);
      const graph = new CodeDocGraph();
      expect(manager.isCacheValid(graph, null)).toBe(false);
    });

    it('returns true when git commit matches', () => {
      const manager = new CacheManager(config);
      const graph = new CodeDocGraph();
      graph.buildTimestamp = Date.now();
      graph.gitCommit = 'abc123';
      expect(manager.isCacheValid(graph, 'abc123')).toBe(true);
    });

    it('returns false when git commit differs', () => {
      const manager = new CacheManager(config);
      const graph = new CodeDocGraph();
      graph.buildTimestamp = Date.now();
      graph.gitCommit = 'abc123';
      expect(manager.isCacheValid(graph, 'def456')).toBe(false);
    });

    it('uses time-based expiry when no git info', () => {
      const manager = new CacheManager({ ...config, cache: { ...config.cache, maxAge: 1000 } });
      const graph = new CodeDocGraph();
      graph.buildTimestamp = Date.now();
      expect(manager.isCacheValid(graph, null)).toBe(true);

      graph.buildTimestamp = Date.now() - 2000;
      expect(manager.isCacheValid(graph, null)).toBe(false);
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
  });

  describe('isCacheValid - configHash', () => {
    it('returns false when configHash differs', () => {
      const manager = new CacheManager(config);
      const graph = new CodeDocGraph();
      graph.buildTimestamp = Date.now();
      graph.configHash = 'stale-hash';
      expect(manager.isCacheValid(graph, null)).toBe(false);
    });

    it('ignores configHash check when graph has no configHash', () => {
      const manager = new CacheManager(config);
      const graph = new CodeDocGraph();
      graph.buildTimestamp = Date.now();
      graph.configHash = null;
      expect(manager.isCacheValid(graph, null)).toBe(true);
    });
  });

  describe('getCacheStats', () => {
    it('returns stats for existing cache', async () => {
      const manager = new CacheManager(config);
      const graph = new CodeDocGraph();
      graph.buildTimestamp = Date.now();
      await manager.saveGraph(graph);

      const stats = await manager.getCacheStats();
      expect(stats.exists).toBe(true);
      expect(stats.graphSize).toBeGreaterThan(0);
    });

    it('returns empty stats when no cache', async () => {
      const freshConfig: DocFreshnessConfig = { rootDir: process.cwd(), cache: { dir: '.doc-freshness-cache/no-stats' } };
      const manager = new CacheManager(freshConfig);
      const stats = await manager.getCacheStats();
      expect(stats.exists).toBe(false);
      expect(stats.lastUpdated).toBeNull();
    });

    it('returns URL cache size when URL cache exists', async () => {
      const manager = new CacheManager(config);
      await manager.saveUrlCache({ 'https://x.com': { result: { valid: true }, timestamp: Date.now() } });
      const stats = await manager.getCacheStats();
      expect(stats.urlCacheSize).toBeGreaterThan(0);
    });
  });
});
