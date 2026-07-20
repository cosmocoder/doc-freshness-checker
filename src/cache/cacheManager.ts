import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CodeDocGraph } from '../graph/codeDocGraph.js';
import { isWithinRoot, resolveProjectRoot } from '../utils/pathSecurity.js';
import type { CacheStats2, DocFreshnessConfig, SerializedGraph, UrlCacheEntry } from '../types.js';

export type CachePolicy = Readonly<{ enabled: boolean; dir: string }>;

/**
 * Resolves result-cache policy and manages persisted cache data
 */
export class CacheManager {
  private config: DocFreshnessConfig;
  private rootDir: string;
  private rawDir: string;
  readonly policy: CachePolicy;
  private cacheFile: string;
  private urlCacheFile: string;
  private embeddingCacheFile: string;
  private incrementalStateFile: string;

  constructor(config: DocFreshnessConfig) {
    this.config = config;
    this.rawDir = config.cache?.dir || config.graph?.cacheDir || '.doc-freshness-cache';
    this.rootDir = resolveProjectRoot(config.rootDir);

    const resolved = path.resolve(this.rootDir, this.rawDir);

    this.policy = Object.freeze({ enabled: config.cache?.enabled !== false, dir: resolved });
    this.cacheFile = path.join(this.policy.dir, 'graph-cache.json');
    this.urlCacheFile = path.join(this.policy.dir, 'url-cache.json');
    this.embeddingCacheFile = path.join(this.policy.dir, 'embedding-cache.json');
    this.incrementalStateFile = path.join(this.policy.dir, 'file-hashes.json');

    if (this.policy.enabled) {
      this.validateCacheDir();
    }
  }

  private validateCacheDir(): void {
    if (this.policy.dir === this.rootDir || !isWithinRoot(this.policy.dir, this.rootDir)) {
      throw new Error(`Cache directory "${this.rawDir}" must resolve to a strict descendant of project root`);
    }

    const realRoot = fs.realpathSync(this.rootDir);
    let ancestor = this.policy.dir;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        throw new Error(`Cache directory "${this.rawDir}" has no existing ancestor`);
      }
      ancestor = parent;
    }

    const realAncestor = fs.realpathSync(ancestor);
    const realCacheDir = path.resolve(realAncestor, path.relative(ancestor, this.policy.dir));
    if (realCacheDir === realRoot || !isWithinRoot(realCacheDir, realRoot)) {
      throw new Error(`Cache directory "${this.rawDir}" must resolve to a strict descendant of project root`);
    }
  }

  private async ensureCacheDir(): Promise<void> {
    this.validateCacheDir();
    await fs.promises.mkdir(this.policy.dir, { recursive: true });
  }

  private validateCacheFile(filePath: string): void {
    this.validateCacheDir();
    let fileStats: fs.Stats;
    try {
      fileStats = fs.lstatSync(filePath);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    if (fileStats.isSymbolicLink()) {
      throw new Error(`Cache file "${path.basename(filePath)}" must not be a symbolic link`);
    }
  }

  private async readCacheFile(filePath: string): Promise<string | null> {
    if (!this.policy.enabled) {
      return null;
    }
    this.validateCacheFile(filePath);
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    }
    catch {
      return null;
    }
  }

  private async writeCacheFile(filePath: string, content: string): Promise<void> {
    if (!this.policy.enabled) {
      return;
    }
    await this.ensureCacheDir();
    this.validateCacheFile(filePath);
    const tempFile = path.join(this.policy.dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(tempFile, content, { encoding: 'utf-8', flag: 'wx' });
      this.validateCacheFile(filePath);
      await fs.promises.rename(tempFile, filePath);
    }
    finally {
      await fs.promises.rm(tempFile, { force: true }).catch(() => {});
    }
  }

  private async statCacheFile(filePath: string): Promise<fs.Stats | null> {
    if (!this.policy.enabled) {
      return null;
    }
    this.validateCacheFile(filePath);
    try {
      return await fs.promises.stat(filePath);
    }
    catch {
      return null;
    }
  }

  /**
   * Save the code-to-doc graph
   */
  async saveGraph(graph: CodeDocGraph): Promise<void> {
    if (!this.policy.enabled) {
      return;
    }
    const data = graph.serialize();
    data.configHash = this.getConfigHash();
    await this.writeCacheFile(this.cacheFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load the cached graph
   */
  async loadGraph(): Promise<CodeDocGraph | null> {
    const content = await this.readCacheFile(this.cacheFile);
    if (content === null) {
      return null;
    }
    try {
      const data = JSON.parse(content) as SerializedGraph;
      return CodeDocGraph.deserialize(data);
    }
    catch {
      return null;
    }
  }

  /**
   * Check if cache is valid based on config hash and git state
   */
  isCacheValid(graph: CodeDocGraph | null, currentCommit: string | null): boolean {
    if (!this.policy.enabled || !graph) {
      return false;
    }
    if (!graph.buildTimestamp) {
      return false;
    }

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
    await this.writeCacheFile(this.urlCacheFile, JSON.stringify(urlResults, null, 2));
  }

  /**
   * Load URL validation cache
   */
  async loadUrlCache(): Promise<Record<string, UrlCacheEntry>> {
    const content = await this.readCacheFile(this.urlCacheFile);
    if (content === null) {
      return {};
    }
    try {
      return JSON.parse(content) as Record<string, UrlCacheEntry>;
    }
    catch {
      return {};
    }
  }

  async readEmbeddingCache(): Promise<string | null> {
    return this.readCacheFile(this.embeddingCacheFile);
  }

  async writeEmbeddingCache(content: string): Promise<void> {
    await this.writeCacheFile(this.embeddingCacheFile, content);
  }

  async clearEmbeddingCache(): Promise<void> {
    if (!this.policy.enabled) {
      return;
    }
    this.validateCacheFile(this.embeddingCacheFile);
    await fs.promises.rm(this.embeddingCacheFile, { force: true });
  }

  async readIncrementalState(): Promise<string | null> {
    return this.readCacheFile(this.incrementalStateFile);
  }

  async writeIncrementalState(content: string): Promise<void> {
    await this.writeCacheFile(this.incrementalStateFile, content);
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    this.validateCacheDir();
    await fs.promises.rm(this.policy.dir, { recursive: true, force: true });
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

    if (!this.policy.enabled) {
      return stats;
    }

    const [graphStat, urlStat, embeddingStat, incrementalStat] = await Promise.all(
      [this.cacheFile, this.urlCacheFile, this.embeddingCacheFile, this.incrementalStateFile].map((file) => this.statCacheFile(file))
    );
    const existingStats = [graphStat, urlStat, embeddingStat, incrementalStat].filter((stat): stat is fs.Stats => stat !== null);
    if (existingStats.length > 0) {
      stats.exists = true;
      stats.graphSize = graphStat?.size ?? 0;
      stats.urlCacheSize = urlStat?.size ?? 0;
      stats.lastUpdated = new Date(Math.max(...existingStats.map((stat) => stat.mtimeMs)));
    }

    return stats;
  }
}
