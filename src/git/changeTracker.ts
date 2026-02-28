import { execSync } from 'child_process';
import type { ChangeSummaryItem, CommitInfo, DocFreshnessConfig } from '../types.js';
import type { CodeDocGraph } from '../graph/codeDocGraph.js';

/**
 * Tracks git changes for incremental documentation checking
 */
export class GitChangeTracker {
  private rootDir: string;
  private _isGitRepo: boolean | null;

  constructor(config: DocFreshnessConfig) {
    this.rootDir = config.rootDir || process.cwd();
    this._isGitRepo = null;
  }

  /**
   * Check if the project is a git repository
   */
  isGitRepo(): boolean {
    if (this._isGitRepo !== null) {
      return this._isGitRepo;
    }

    try {
      execSync('git rev-parse --git-dir', {
        cwd: this.rootDir,
        stdio: 'pipe',
      });
      this._isGitRepo = true;
    } catch {
      this._isGitRepo = false;
    }

    return this._isGitRepo;
  }

  /**
   * Get the current git commit hash
   */
  getCurrentCommit(): string | null {
    if (!this.isGitRepo()) return null;

    try {
      return execSync('git rev-parse HEAD', {
        cwd: this.rootDir,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return null;
    }
  }

  /**
   * Get files changed between two commits
   */
  getChangedFiles(fromCommit: string, toCommit: string = 'HEAD'): string[] {
    if (!this.isGitRepo()) return [];

    try {
      const output = execSync(`git diff --name-only ${fromCommit}..${toCommit}`, {
        cwd: this.rootDir,
        encoding: 'utf-8',
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get files changed since a timestamp
   */
  getChangedFilesSince(timestamp: number): string[] {
    if (!this.isGitRepo()) return [];

    try {
      const isoDate = new Date(timestamp).toISOString();
      const output = execSync(`git log --since="${isoDate}" --name-only --pretty=format:""`, {
        cwd: this.rootDir,
        encoding: 'utf-8',
      });
      const files = [...new Set(output.trim().split('\n').filter(Boolean))];
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Get the last modification time of a file from git
   */
  getFileLastModified(filePath: string): number | null {
    if (!this.isGitRepo()) return null;

    try {
      const output = execSync(`git log -1 --format="%ct" -- "${filePath}"`, {
        cwd: this.rootDir,
        encoding: 'utf-8',
      });
      const timestamp = parseInt(output.trim(), 10);
      return timestamp ? timestamp * 1000 : null;
    } catch {
      return null;
    }
  }

  /**
   * Get commit info for a file
   */
  getFileCommitInfo(filePath: string): CommitInfo | null {
    if (!this.isGitRepo()) return null;

    try {
      const output = execSync(`git log -1 --format="%H|%ct|%s" -- "${filePath}"`, {
        cwd: this.rootDir,
        encoding: 'utf-8',
      });

      if (!output.trim()) return null;

      const [hash, timestamp, message] = output.trim().split('|');
      return {
        hash,
        timestamp: parseInt(timestamp, 10) * 1000,
        message,
      };
    } catch {
      return null;
    }
  }

  /**
   * Determine which docs need re-checking based on code changes
   */
  getAffectedDocs(graph: CodeDocGraph, changedFiles: string[]): string[] {
    const affectedDocs = new Set<string>();

    for (const changedFile of changedFiles) {
      const docs = graph.getDocsReferencingCode(changedFile);
      for (const doc of docs) {
        affectedDocs.add(doc);
      }
    }

    return [...affectedDocs];
  }

  /**
   * Get change summary for reporting
   */
  getChangeSummary(graph: CodeDocGraph, changedFiles: string[]): ChangeSummaryItem[] {
    const summary: ChangeSummaryItem[] = [];

    for (const changedFile of changedFiles) {
      const docs = graph.getDocsReferencingCode(changedFile);
      if (docs.size > 0) {
        const commitInfo = this.getFileCommitInfo(changedFile);
        summary.push({
          codeFile: changedFile,
          affectedDocs: [...docs],
          lastCommit: commitInfo,
        });
      }
    }

    return summary;
  }
}
