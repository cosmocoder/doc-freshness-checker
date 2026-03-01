import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CodeDocGraph } from '../graph/codeDocGraph.js';
import { isWithinRoot, resolveProjectRoot } from '../utils/pathSecurity.js';
import type { CacheStats2, DocFreshnessConfig, SerializedGraph, UrlCacheEntry } from '../types.js';

/**
 * Manages caching of graph and URL validation results
 */
export class CacheManager {
  private config: DocFreshnessConfig;
  private cacheDir: string;
  private cacheFile: string;
  private urlCacheFile: string;

  constructor(config: DocFreshnessConfig) {
    this.config = config;
    const rawDir = config.cache?.dir || config.graph?.cacheDir || '.doc-freshness-cache';
    const rootDir = resolveProjectRoot(config.rootDir);

    // Path traversal protection: resolve and verify cache dir stays within project root
    const resolved = path.resolve(rootDir, rawDir);
    if (!isWithinRoot(resolved, rootDir)) {
      throw new Error(`Cache directory "${rawDir}" resolves outside project root`);
    }

    this.cacheDir = resolved;
    this.cacheFile = path.join(this.cacheDir, 'graph-cache.json');
    this.urlCacheFile = path.join(this.cacheDir, 'url-cache.json');
  }

  private async ensureCacheDir(): Promise<void> {
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * Save the code-to-doc graph
   */
  async saveGraph(graph: CodeDocGraph): Promise<void> {
    await this.ensureCacheDir();
    const data = graph.serialize();
    data.configHash = this.getConfigHash();
    await fs.promises.writeFile(this.cacheFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load the cached graph
   */
  async loadGraph(): Promise<CodeDocGraph | null> {
    try {
      const content = await fs.promises.readFile(this.cacheFile, 'utf-8');
      const data = JSON.parse(content) as SerializedGraph;
      return CodeDocGraph.deserialize(data);
    } catch {
      return null;
    }
  }

  /**
   * Check if cache is valid based on config hash and git state
   */
  isCacheValid(graph: CodeDocGraph | null, currentCommit: string | null): boolean {
    if (!graph) return false;
    if (!graph.buildTimestamp) return false;

    const configHash = this.getConfigHash();
    if (graph.configHash && graph.configHash !== configHash) {
      return false;
    }

    if (currentCommit && graph.gitCommit) {
      return currentCommit === graph.gitCommit;
    }

    const maxAge = this.config.cache?.maxAge || this.config.graph?.cacheMaxAge || 24 * 60 * 60 * 1000;
    return Date.now() - graph.buildTimestamp < maxAge;
  }

  private getConfigHash(): string {
    const relevantConfig = {
      include: this.config.include,
      exclude: this.config.exclude,
      sourcePatterns: this.config.sourcePatterns,
      manifestFiles: this.config.manifestFiles,
    };
    return crypto.createHash('md5').update(JSON.stringify(relevantConfig)).digest('hex');
  }

  /**
   * Save URL validation cache
   */
  async saveUrlCache(urlResults: Record<string, UrlCacheEntry>): Promise<void> {
    await this.ensureCacheDir();
    await fs.promises.writeFile(this.urlCacheFile, JSON.stringify(urlResults, null, 2));
  }

  /**
   * Load URL validation cache
   */
  async loadUrlCache(): Promise<Record<string, UrlCacheEntry>> {
    try {
      const content = await fs.promises.readFile(this.urlCacheFile, 'utf-8');
      return JSON.parse(content) as Record<string, UrlCacheEntry>;
    } catch {
      return {};
    }
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    try {
      await fs.promises.rm(this.cacheDir, { recursive: true });
    } catch {
      // Directory doesn't exist
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<CacheStats2> {
    const stats: CacheStats2 = {
      exists: false,
      graphSize: 0,
      urlCacheSize: 0,
      lastUpdated: null,
    };

    try {
      const graphStat = await fs.promises.stat(this.cacheFile);
      stats.exists = true;
      stats.graphSize = graphStat.size;
      stats.lastUpdated = graphStat.mtime;
    } catch {
      // File doesn't exist
    }

    try {
      const urlStat = await fs.promises.stat(this.urlCacheFile);
      stats.urlCacheSize = urlStat.size;
    } catch {
      // File doesn't exist
    }

    return stats;
  }
}
