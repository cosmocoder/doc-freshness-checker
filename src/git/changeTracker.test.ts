import { execFileSync } from 'child_process';
import { GitChangeTracker } from './changeTracker.js';
import { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { DocFreshnessConfig, Reference } from '../types.js';

vi.mock('child_process');

const mockExecFileSync = vi.mocked(execFileSync);

function makeRef(value: string): Reference {
  return { type: 'file-path', value, lineNumber: 1, raw: value, sourceFile: 'doc.md' };
}

describe('GitChangeTracker', () => {
  const config: DocFreshnessConfig = { rootDir: '/project' };

  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  describe('isGitRepo', () => {
    it('returns true when git rev-parse succeeds', () => {
      mockExecFileSync.mockReturnValue('.git\n');
      expect(new GitChangeTracker(config).isGitRepo()).toBe(true);
    });

    it('returns false when git rev-parse fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });
      expect(new GitChangeTracker(config).isGitRepo()).toBe(false);
    });

    it('caches the result', () => {
      mockExecFileSync.mockReturnValue('.git\n');
      const tracker = new GitChangeTracker(config);
      tracker.isGitRepo();
      tracker.isGitRepo();
      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    });

    it('uses process.cwd() when rootDir not specified', () => {
      mockExecFileSync.mockReturnValue('.git\n');
      new GitChangeTracker({}).isGitRepo();
      expect(mockExecFileSync).toHaveBeenCalledWith('git', ['rev-parse', '--git-dir'], expect.objectContaining({ cwd: process.cwd() }));
    });
  });

  describe('getCurrentCommit', () => {
    it('returns commit hash', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce('abc123\n');
      expect(new GitChangeTracker(config).getCurrentCommit()).toBe('abc123');
    });

    it('returns null for non-git repos', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error();
      });
      expect(new GitChangeTracker(config).getCurrentCommit()).toBeNull();
    });

    it('returns null when rev-parse HEAD fails', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockImplementationOnce(() => {
        throw new Error('no commits');
      });
      expect(new GitChangeTracker(config).getCurrentCommit()).toBeNull();
    });
  });

  describe('getChangedFiles', () => {
    it('returns changed file list', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce('file1.ts\nfile2.ts\n');
      expect(new GitChangeTracker(config).getChangedFiles('abc', 'def')).toEqual(['file1.ts', 'file2.ts']);
    });

    it('returns empty for non-git repos', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error();
      });
      expect(new GitChangeTracker(config).getChangedFiles('a', 'b')).toEqual([]);
    });

    it('returns empty when git diff fails', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockImplementationOnce(() => {
        throw new Error('diff failed');
      });
      expect(new GitChangeTracker(config).getChangedFiles('a', 'b')).toEqual([]);
    });
  });

  describe('getChangedFilesSince', () => {
    it('returns unique changed files since timestamp', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce('file1.ts\nfile1.ts\nfile2.ts\n');
      const files = new GitChangeTracker(config).getChangedFilesSince(Date.now() - 7 * 24 * 60 * 60 * 1000);
      expect(files).toEqual(['file1.ts', 'file2.ts']);
    });

    it('returns empty for non-git repos', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error();
      });
      expect(new GitChangeTracker(config).getChangedFilesSince(Date.now())).toEqual([]);
    });

    it('returns empty when git log fails', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockImplementationOnce(() => {
        throw new Error('log failed');
      });
      expect(new GitChangeTracker(config).getChangedFilesSince(Date.now())).toEqual([]);
    });
  });

  describe('getFileLastModified', () => {
    it('returns timestamp in milliseconds', () => {
      const ts = Math.floor(Date.now() / 1000);
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce(`${ts}\n`);
      expect(new GitChangeTracker(config).getFileLastModified('file.ts')).toBe(ts * 1000);
    });

    it('returns null for non-git repos', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error();
      });
      expect(new GitChangeTracker(config).getFileLastModified('file.ts')).toBeNull();
    });

    it('returns null when file has no commits', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce('\n');
      expect(new GitChangeTracker(config).getFileLastModified('new-file.ts')).toBeNull();
    });

    it('returns null when git log fails', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockImplementationOnce(() => {
        throw new Error('log failed');
      });
      expect(new GitChangeTracker(config).getFileLastModified('file.ts')).toBeNull();
    });
  });

  describe('getFileCommitInfo', () => {
    it('parses NUL-separated commit info', () => {
      const ts = Math.floor(Date.now() / 1000);
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce(`abc123\0${ts}\0Fix bug\n`);
      const info = new GitChangeTracker(config).getFileCommitInfo('file.ts');
      expect(info).toEqual({ hash: 'abc123', timestamp: ts * 1000, message: 'Fix bug' });
    });

    it('returns null when no output', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce('\n');
      expect(new GitChangeTracker(config).getFileCommitInfo('file.ts')).toBeNull();
    });

    it('returns null when insufficient parts in output', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce('abc123\n');
      expect(new GitChangeTracker(config).getFileCommitInfo('file.ts')).toBeNull();
    });

    it('returns null for non-git repos', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error();
      });
      expect(new GitChangeTracker(config).getFileCommitInfo('file.ts')).toBeNull();
    });

    it('returns null when git log fails', () => {
      mockExecFileSync.mockReturnValueOnce('.git\n').mockImplementationOnce(() => {
        throw new Error();
      });
      expect(new GitChangeTracker(config).getFileCommitInfo('file.ts')).toBeNull();
    });
  });

  describe('getAffectedDocs', () => {
    it('returns docs that reference changed code files', () => {
      mockExecFileSync.mockReturnValue('.git\n');
      const graph = new CodeDocGraph();
      graph.addReference('docs/api.md', 'src/server.ts', makeRef('src/server.ts'));
      expect(new GitChangeTracker(config).getAffectedDocs(graph, ['src/server.ts'])).toEqual(['docs/api.md']);
    });

    it('deduplicates affected docs', () => {
      mockExecFileSync.mockReturnValue('.git\n');
      const graph = new CodeDocGraph();
      graph.addReference('docs/api.md', 'src/a.ts', makeRef('a.ts'));
      graph.addReference('docs/api.md', 'src/b.ts', makeRef('b.ts'));
      expect(new GitChangeTracker(config).getAffectedDocs(graph, ['src/a.ts', 'src/b.ts'])).toEqual(['docs/api.md']);
    });

    it('returns empty when no changed files match graph', () => {
      mockExecFileSync.mockReturnValue('.git\n');
      const graph = new CodeDocGraph();
      expect(new GitChangeTracker(config).getAffectedDocs(graph, ['unrelated.ts'])).toEqual([]);
    });
  });

  describe('getChangeSummary', () => {
    it('returns summary with affected docs and commit info', () => {
      const ts = Math.floor(Date.now() / 1000);
      mockExecFileSync.mockReturnValueOnce('.git\n').mockReturnValueOnce(`hash1\0${ts}\0Update\n`);
      const graph = new CodeDocGraph();
      graph.addReference('docs/api.md', 'src/server.ts', makeRef('src/server.ts'));
      const summary = new GitChangeTracker(config).getChangeSummary(graph, ['src/server.ts']);
      expect(summary).toHaveLength(1);
      expect(summary[0].codeFile).toBe('src/server.ts');
      expect(summary[0].affectedDocs).toEqual(['docs/api.md']);
    });

    it('skips files with no affected docs', () => {
      mockExecFileSync.mockReturnValue('.git\n');
      const graph = new CodeDocGraph();
      graph.addReference('docs/api.md', 'src/server.ts', makeRef('src/server.ts'));
      const summary = new GitChangeTracker(config).getChangeSummary(graph, ['unrelated.ts']);
      expect(summary).toHaveLength(0);
    });
  });
});
