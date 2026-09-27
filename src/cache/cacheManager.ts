import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isWithinRoot, resolveProjectRoot } from '../utils/pathSecurity.js';
import type { DocFreshnessConfig, UrlCacheEntry } from '../types.js';

export type CachePolicy = Readonly<{ enabled: boolean; dir: string }>;

/**
 * Resolves result-cache policy and manages persisted cache data
 */
export class CacheManager {
  private rootDir: string;
  private rawDir: string;
  readonly policy: CachePolicy;
  private urlCacheFile: string;
  private embeddingCacheFile: string;
  private incrementalStateFile: string;

  constructor(config: DocFreshnessConfig) {
    this.rawDir = config.cache?.dir || config.graph?.cacheDir || '.doc-freshness-cache';
    this.rootDir = resolveProjectRoot(config.rootDir);

    const resolved = path.resolve(this.rootDir, this.rawDir);

    this.policy = Object.freeze({ enabled: config.cache?.enabled !== false, dir: resolved });
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
}
