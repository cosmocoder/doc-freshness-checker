import { EnhancedReporter } from './enhancedReporter.js';
import { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';
import type { ProjectScores, ValidationResults } from '../types.js';

describe('EnhancedReporter', () => {
  const reporter = new EnhancedReporter();

  const results: ValidationResults = {
    documents: [
      {
        path: 'docs/api.md',
        issues: [
          {
            reference: { type: 'file-path', value: 'missing.ts', lineNumber: 5, raw: 'missing.ts', sourceFile: 'api.md' },
            valid: false,
            severity: 'error',
            message: 'File not found',
            suggestion: 'Did you mean missing.tsx?',
          },
          {
            reference: { type: 'external-url', value: 'https://old.com', lineNumber: 12, raw: 'https://old.com', sourceFile: 'api.md' },
            valid: false,
            severity: 'warning',
            message: 'URL returned 404',
          },
        ],
      },
    ],
    summary: { total: 3, valid: 1, errors: 1, warnings: 1, skipped: 0 },
  };

  const emptyResults: ValidationResults = {
    documents: [],
    summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
  };

  it('generates scan report with validation summary', () => {
    const report = reporter.generateScanReport(results, null, null, null);
    expect(report).toContain('Documentation Freshness Scan Report');
    expect(report).toContain('Total References:** 3');
    expect(report).toContain('Errors:** 1');
    expect(report).toContain('Warnings:** 1');
  });

  it('includes freshness scores with grade table', () => {
    const scores: ProjectScores = {
      projectScore: 80,
      projectGrade: 'B',
      documents: [
        {
          document: 'docs/api.md',
          totalScore: 80,
          factors: { referenceValidity: 80, gitTimeDelta: 80, codeChangeFrequency: 80, symbolCoverage: 80 },
          grade: 'B',
        },
      ],
      summary: { total: 1, gradeA: 0, gradeB: 1, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    const report = reporter.generateScanReport(results, null, null, scores);
    expect(report).toContain('80/100');
    expect(report).toContain('Grade: B');
    expect(report).toContain('A (90-100)');
  });

  it('shows referenced code files from graph', () => {
    const graph = new CodeDocGraph();
    graph.addReference('docs/api.md', 'src/server.ts', {
      type: 'file-path',
      value: 'src/server.ts',
      lineNumber: 1,
      raw: 'src/server.ts',
      sourceFile: 'api.md',
    });
    const report = reporter.generateScanReport(results, graph, null, null);
    expect(report).toContain('src/server.ts');
    expect(report).toContain('Referenced Code Files');
  });

  it('shows commit info for referenced code files', () => {
    const graph = new CodeDocGraph();
    graph.addReference('docs/api.md', 'src/server.ts', {
      type: 'file-path',
      value: 'src/server.ts',
      lineNumber: 1,
      raw: 'src/server.ts',
      sourceFile: 'api.md',
    });
    const gitTracker = {
      isGitRepo: () => true,
      getFileCommitInfo: vi.fn().mockReturnValue({ hash: 'abc', timestamp: Date.now(), message: 'fix' }),
      getChangedFilesSince: vi.fn().mockReturnValue([]),
      getAffectedDocs: vi.fn().mockReturnValue([]),
    } as unknown as GitChangeTracker;

    const report = reporter.generateScanReport(results, graph, gitTracker, null);
    expect(report).toContain('last modified');
  });

  it('shows document score inline when scores are provided', () => {
    const scores: ProjectScores = {
      projectScore: 80,
      projectGrade: 'B',
      documents: [
        {
          document: 'docs/api.md',
          totalScore: 80,
          factors: { referenceValidity: 80, gitTimeDelta: 80, codeChangeFrequency: 80, symbolCoverage: 80 },
          grade: 'B',
        },
      ],
      summary: { total: 1, gradeA: 0, gradeB: 1, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    const report = reporter.generateScanReport(results, null, null, scores);
    expect(report).toContain('Score: 80');
    expect(report).toContain('Grade: B');
  });

  it('shows issues table with both error and warning severity, plus suggestions', () => {
    const report = reporter.generateScanReport(results, null, null, null);
    expect(report).toContain('❌');
    expect(report).toContain('⚠️');
    expect(report).toContain('File not found');
    expect(report).toContain('missing.tsx');
    expect(report).toContain('URL returned 404');
  });

  it('omits affected documents section when no documents have issues', () => {
    const report = reporter.generateScanReport(emptyResults, null, null, null);
    expect(report).not.toContain('Affected Documents');
  });

  it('shows recent code changes impacting docs when git is available', () => {
    const graph = new CodeDocGraph();
    graph.addReference('docs/api.md', 'src/server.ts', {
      type: 'file-path',
      value: 'src/server.ts',
      lineNumber: 1,
      raw: 'src/server.ts',
      sourceFile: 'api.md',
    });
    const gitTracker = {
      isGitRepo: () => true,
      getFileCommitInfo: vi.fn().mockReturnValue(null),
      getChangedFilesSince: vi.fn().mockReturnValue(['src/server.ts']),
      getAffectedDocs: vi.fn().mockReturnValue(['docs/api.md']),
    } as unknown as GitChangeTracker;

    const report = reporter.generateScanReport(emptyResults, graph, gitTracker, null);
    expect(report).toContain('Recent Code Changes');
    expect(report).toContain('docs/api.md');
  });

  it('handles git operation errors gracefully', () => {
    const graph = new CodeDocGraph();
    const gitTracker = {
      isGitRepo: () => true,
      getFileCommitInfo: vi.fn(),
      getChangedFilesSince: vi.fn().mockImplementation(() => {
        throw new Error('git error');
      }),
      getAffectedDocs: vi.fn(),
    } as unknown as GitChangeTracker;

    const report = reporter.generateScanReport(emptyResults, graph, gitTracker, null);
    expect(report).not.toContain('Recent Code Changes');
  });
});
