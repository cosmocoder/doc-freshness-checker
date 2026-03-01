import { execFileSync } from 'child_process';
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

  private git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  /**
   * Check if the project is a git repository
   */
  isGitRepo(): boolean {
    if (this._isGitRepo !== null) {
      return this._isGitRepo;
    }

    try {
      this.git(['rev-parse', '--git-dir']);
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
      return this.git(['rev-parse', 'HEAD']);
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
      const output = this.git(['diff', '--name-only', `${fromCommit}..${toCommit}`]);
      return output.split('\n').filter(Boolean);
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
      const output = this.git(['log', `--since=${isoDate}`, '--name-only', '--pretty=format:']);
      const files = [...new Set(output.split('\n').filter(Boolean))];
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
      const output = this.git(['log', '-1', '--format=%ct', '--', filePath]);
      const timestamp = parseInt(output, 10);
      return timestamp ? timestamp * 1000 : null;
    } catch {
      return null;
    }
  }

  /**
   * Get commit info for a file.
   * Uses NUL byte as separator to safely handle commit messages containing |
   */
  getFileCommitInfo(filePath: string): CommitInfo | null {
    if (!this.isGitRepo()) return null;

    try {
      const output = this.git(['log', '-1', '--format=%H%x00%ct%x00%s', '--', filePath]);

      if (!output) return null;

      const parts = output.split('\0');
      if (parts.length < 3) return null;

      return {
        hash: parts[0],
        timestamp: parseInt(parts[1], 10) * 1000,
        message: parts.slice(2).join('\0'),
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
