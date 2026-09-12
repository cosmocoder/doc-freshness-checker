import { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';
import type { ProjectScores, ValidationResults } from '../types.js';
import { createEnhancedReportContext, EnhancedReporter } from './enhancedReporter.js';

const emptyResults: ValidationResults = {
  documents: [],
  summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
};

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
        {
          reference: { type: 'dependency', value: 'missing-pkg', lineNumber: 20, raw: 'missing-pkg', sourceFile: 'api.md' },
          valid: false,
          severity: 'info',
          message: 'Package not found',
        },
      ],
    },
  ],
  summary: { total: 4, valid: 1, errors: 1, warnings: 1, info: 1, skipped: 0 },
};

const graphWithReference = () => {
  const graph = new CodeDocGraph();
  graph.addReference('docs/api.md', 'src/server.ts', results.documents[0].issues[0].reference);
  return graph;
};

describe('EnhancedReporter', () => {
  const reporter = new EnhancedReporter();

  it('generates summary, score, graph, and distinct severity details', () => {
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
    const gitTracker = {
      getFileCommitInfo: vi.fn().mockReturnValue({ hash: 'abc', timestamp: Date.now(), message: 'fix' }),
      isGitRepo: () => false,
    } as unknown as GitChangeTracker;

    const report = reporter.generateScanReport(results, graphWithReference(), gitTracker, scores);
    expect(report).toContain('Total References:** 4');
    expect(report).toContain('Warnings:** 1');
    expect(report).toContain('Info:** 1');
    expect(report).toContain('Score: 80');
    expect(report).toContain('Grade: B');
    expect(report).toContain('src/server.ts');
    expect(report).toContain('last modified');
    expect(report).toContain('❌ file-path');
    expect(report).toContain('⚠️ external-url');
    expect(report).toContain('ℹ️ dependency');
  });

  it('omits affected documents and normalizes legacy info when no documents have issues', () => {
    const report = reporter.generateScanReport(emptyResults, null, null, null);
    expect(report).not.toContain('Affected Documents');
    expect(report).toContain('Info:** 0');
  });

  it('renders semantic analysis once before recent impacts', () => {
    const vectorResults: ValidationResults = {
      ...emptyResults,
      vectorMismatches: [
        {
          docPath: 'docs/api.md',
          docSection: 'API',
          docText: 'API docs',
          bestMatchScore: 0,
          bestMatch: null,
          suggestion: 'Review this section',
        },
      ],
    };
    const gitTracker = {
      isGitRepo: () => true,
      getChangedFilesSince: vi.fn().mockReturnValue(['src/api.ts']),
      getAffectedDocs: vi.fn().mockReturnValue(['docs/api.md']),
    } as unknown as GitChangeTracker;

    const report = reporter.generateScanReport(vectorResults, new CodeDocGraph(), gitTracker, null);
    expect(report.indexOf('Semantic Analysis')).toBeLessThan(report.indexOf('Recent Code Changes'));
    expect(report.match(/Semantic Analysis/g)).toHaveLength(1);
    expect(report).toContain('| - |');
  });

  it('freezes only internally owned model entries and arrays', () => {
    const graph = graphWithReference();
    const context = createEnhancedReportContext(results, graph, null, null);
    const entry = context.model.documents[0];

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.model)).toBe(true);
    expect(Object.isFrozen(context.model.summary)).toBe(true);
    expect(Object.isFrozen(context.model.documents)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.codeFiles)).toBe(true);
    expect(Object.isFrozen(entry.codeFiles[0])).toBe(true);
    expect(Object.isFrozen(graph)).toBe(false);
    expect(Object.isFrozen(results)).toBe(false);
  });

  it.each(['changes', 'affected'] as const)('swallows %s lookup errors inside the recent-change boundary', (failure) => {
    const gitTracker = {
      isGitRepo: () => true,
      getChangedFilesSince: vi.fn(() => {
        if (failure === 'changes') {
          throw new Error('git error');
        }
        return ['src/api.ts'];
      }),
      getAffectedDocs: vi.fn(() => {
        if (failure === 'affected') {
          throw new Error('graph error');
        }
        return ['docs/api.md'];
      }),
    } as unknown as GitChangeTracker;

    expect(reporter.generateScanReport(emptyResults, new CodeDocGraph(), gitTracker, null)).not.toContain('Recent Code Changes');
  });

  it('propagates collaborator errors outside the recent-change boundary', () => {
    const commitFailure = {
      getFileCommitInfo: () => {
        throw new Error('commit lookup failed');
      },
    } as unknown as GitChangeTracker;
    expect(() => reporter.generateScanReport(results, graphWithReference(), commitFailure, null)).toThrow('commit lookup failed');

    const repoFailure = {
      isGitRepo: () => {
        throw new Error('repo detection failed');
      },
    } as unknown as GitChangeTracker;
    expect(() => reporter.generateScanReport(emptyResults, new CodeDocGraph(), repoFailure, null)).toThrow('repo detection failed');
  });
});
