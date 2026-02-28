import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Document, IncrementalStats } from '../types.js';

/**
 * Incremental checker for skipping unchanged documentation files
 * Uses file hashes to detect changes between runs
 */
export class IncrementalChecker {
  private stateDir: string;
  private stateFile: string;
  private previousHashes: Map<string, string>;
  private currentHashes: Map<string, string>;

  constructor(stateDir: string = '.doc-freshness-cache') {
    this.stateDir = stateDir;
    this.stateFile = path.join(stateDir, 'file-hashes.json');
    this.previousHashes = new Map();
    this.currentHashes = new Map();
  }

  /**
   * Load previous state from cache
   */
  async loadState(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.stateFile, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, string>;
      this.previousHashes = new Map(Object.entries(parsed));
    } catch {
      // No previous state
    }
  }

  /**
   * Save current state to cache
   */
  async saveState(): Promise<void> {
    await fs.promises.mkdir(this.stateDir, { recursive: true });
    const data = Object.fromEntries(this.currentHashes);
    await fs.promises.writeFile(this.stateFile, JSON.stringify(data, null, 2));
  }

  /**
   * Get MD5 hash of a file
   */
  async getHash(filePath: string): Promise<string> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Check if a file has changed since last run
   */
  async shouldCheck(filePath: string): Promise<boolean> {
    try {
      const hash = await this.getHash(filePath);
      this.currentHashes.set(filePath, hash);

      const previousHash = this.previousHashes.get(filePath);
      return hash !== previousHash;
    } catch {
      // File read error - should check
      return true;
    }
  }

  /**
   * Filter documents to only include changed ones
   */
  async filterChanged(documents: Document[]): Promise<Document[]> {
    await this.loadState();

    const changed: Document[] = [];
    for (const doc of documents) {
      if (await this.shouldCheck(doc.absolutePath)) {
        changed.push(doc);
      }
    }

    return changed;
  }

  /**
   * Get statistics about the incremental check
   */
  getStats(totalDocs: number, changedDocs: number): IncrementalStats {
    return {
      total: totalDocs,
      changed: changedDocs,
      skipped: totalDocs - changedDocs,
      percentSkipped: totalDocs > 0 ? Math.round(((totalDocs - changedDocs) / totalDocs) * 100) : 0,
    };
  }
}
