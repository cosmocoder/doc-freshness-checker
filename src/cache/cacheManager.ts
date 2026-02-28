import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CodeDocGraph } from '../graph/codeDocGraph.js';
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
    this.cacheDir = config.cache?.dir || config.graph?.cacheDir || '.doc-freshness-cache';
    this.cacheFile = path.join(this.cacheDir, 'graph-cache.json');
    this.urlCacheFile = path.join(this.cacheDir, 'url-cache.json');
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Save the code-to-doc graph
   */
  saveGraph(graph: CodeDocGraph): void {
    this.ensureCacheDir();
    const data = graph.serialize();
    data.configHash = this.getConfigHash();
    fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load the cached graph
   */
  loadGraph(): CodeDocGraph | null {
    if (!fs.existsSync(this.cacheFile)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8')) as SerializedGraph;
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

    // Check if config has changed
    const configHash = this.getConfigHash();
    if (graph.configHash && graph.configHash !== configHash) {
      return false;
    }

    // For git repos, cache is valid if we have the commit info
    if (currentCommit && graph.gitCommit) {
      return true; // Will do incremental check
    }

    // For non-git repos, check cache age
    const maxAge = this.config.cache?.maxAge || this.config.graph?.cacheMaxAge || 24 * 60 * 60 * 1000;
    return Date.now() - graph.buildTimestamp < maxAge;
  }

  /**
   * Generate hash of current config for cache invalidation
   */
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
  saveUrlCache(urlResults: Record<string, UrlCacheEntry>): void {
    this.ensureCacheDir();
    fs.writeFileSync(this.urlCacheFile, JSON.stringify(urlResults, null, 2));
  }

  /**
   * Load URL validation cache
   */
  loadUrlCache(): Record<string, UrlCacheEntry> {
    if (!fs.existsSync(this.urlCacheFile)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(this.urlCacheFile, 'utf-8')) as Record<string, UrlCacheEntry>;
    } catch {
      return {};
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    if (fs.existsSync(this.cacheDir)) {
      fs.rmSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats2 {
    const stats: CacheStats2 = {
      exists: fs.existsSync(this.cacheFile),
      graphSize: 0,
      urlCacheSize: 0,
      lastUpdated: null,
    };

    if (stats.exists) {
      try {
        const graphStat = fs.statSync(this.cacheFile);
        stats.graphSize = graphStat.size;
        stats.lastUpdated = graphStat.mtime;
      } catch {
        // Ignore errors
      }
    }

    if (fs.existsSync(this.urlCacheFile)) {
      try {
        const urlStat = fs.statSync(this.urlCacheFile);
        stats.urlCacheSize = urlStat.size;
      } catch {
        // Ignore errors
      }
    }

    return stats;
  }
}
