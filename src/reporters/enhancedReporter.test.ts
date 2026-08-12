import { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';
import type { ProjectScores, ValidationResults } from '../types.js';
import { createEnhancedReportContext, EnhancedReporter } from './enhancedReporter.js';

const emptyResults: ValidationResults = {
  documents: [],
  summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
};

const issue = (message = 'Missing'): ValidationResults['documents'][number]['issues'][number] => ({
  reference: { type: 'file-path', value: 'src/api.ts', lineNumber: 1, raw: 'src/api.ts', sourceFile: 'api.md' },
  valid: false,
  severity: 'error',
  message,
  suggestion: 'Fix it',
});

const issueResults: ValidationResults = {
  documents: [{ path: 'docs/api.md', issues: [issue()] }],
  summary: { total: 1, valid: 0, errors: 1, warnings: 0, skipped: 0 },
};

const graphWithReference = (documentPath = 'docs/api.md') => {
  const graph = new CodeDocGraph();
  graph.addReference(documentPath, 'src/api.ts', issue().reference);
  return graph;
};

function observed<T extends object>(value: T, prefix: string, events: string[]): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      events.push(`${prefix}:${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });
}

describe('EnhancedReporter', () => {
  const reporter = new EnhancedReporter();

  it('freezes only internally owned model entries and arrays', () => {
    const graph = graphWithReference();
    const context = createEnhancedReportContext(issueResults, graph, null, null);
    const entry = context.model.documents[0];

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.model)).toBe(true);
    expect(Object.isFrozen(context.model.summary)).toBe(true);
    expect(Object.isFrozen(context.model.documents)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.codeFiles)).toBe(true);
    expect(Object.isFrozen(entry.codeFiles[0])).toBe(true);
    expect(Object.isFrozen(graph)).toBe(false);
    expect(Object.isFrozen(issueResults)).toBe(false);
  });

  it('checks recent changes even when no validation documents have issues', () => {
    const gitTracker = {
      isGitRepo: () => true,
      getChangedFilesSince: vi.fn().mockReturnValue(['src/api.ts']),
      getAffectedDocs: vi.fn().mockReturnValue(['docs/api.md']),
    } as unknown as GitChangeTracker;

    const report = reporter.generateScanReport(emptyResults, new CodeDocGraph(), gitTracker, null);

    expect(report).toContain('Recent Code Changes');
    expect(report).toContain('docs/api.md');
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

  it('propagates commit lookup errors outside the recent-change boundary', () => {
    const gitTracker = {
      getFileCommitInfo: () => {
        throw new Error('commit lookup failed');
      },
    } as unknown as GitChangeTracker;

    expect(() => reporter.generateScanReport(issueResults, graphWithReference(), gitTracker, null)).toThrow('commit lookup failed');
  });

  it('propagates repository detection errors outside the recent-change boundary', () => {
    const gitTracker = {
      isGitRepo: () => {
        throw new Error('repo detection failed');
      },
    } as unknown as GitChangeTracker;

    expect(() => reporter.generateScanReport(emptyResults, new CodeDocGraph(), gitTracker, null)).toThrow('repo detection failed');
  });

  it('prepares score, summary, document, git, issue, and recent data in fixed-main order', () => {
    const events: string[] = [];
    const originalToISOString = Date.prototype.toISOString;
    const iso = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(function (this: Date) {
      events.push('generatedAt');
      return originalToISOString.call(this);
    });
    const locale = vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(() => {
      events.push('locale');
      return '1/1/2025';
    });
    const reference = observed(issue().reference, 'reference', events);
    const resultIssue = observed({ ...issue(), reference }, 'issue', events);
    const document = observed({ path: 'docs/api.md', issues: [resultIssue] }, 'document', events);
    const summary = observed(issueResults.summary, 'results', events);
    const results = observed({ documents: [document], summary }, 'results', events) as ValidationResults;
    const scoreSummary = observed({ total: 1, gradeA: 1, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 }, 'score', events);
    const documentScore = observed(
      {
        document: 'docs/api.md',
        totalScore: 100,
        factors: { referenceValidity: 100, gitTimeDelta: 100, codeChangeFrequency: 100, symbolCoverage: 100 },
        grade: 'A' as const,
      },
      'docScore',
      events
    );
    const scores = observed(
      { projectScore: 100, projectGrade: 'A' as const, documents: [documentScore], summary: scoreSummary },
      'score',
      events
    );
    const graph = new CodeDocGraph();
    vi.spyOn(graph, 'getCodeReferencedByDoc').mockImplementation(() => {
      events.push('graph');
      return new Set(['src/api.ts']);
    });
    const gitTracker = {
      getFileCommitInfo: vi.fn(() => {
        events.push('commit');
        return { hash: 'abc', timestamp: 1735689600000, message: 'change' };
      }),
      isGitRepo: vi.fn(() => (events.push('isGitRepo'), true)),
      getChangedFilesSince: vi.fn(() => (events.push('changedFiles'), [])),
      getAffectedDocs: vi.fn(() => (events.push('affectedDocs'), [])),
    } as unknown as GitChangeTracker;

    try {
      reporter.generateScanReport(results, graph, gitTracker, scores);
      expect(events).toEqual([
        'generatedAt',
        'score:projectScore',
        'score:projectGrade',
        'score:summary',
        'score:gradeA',
        'score:summary',
        'score:gradeB',
        'score:summary',
        'score:gradeC',
        'score:summary',
        'score:gradeD',
        'score:summary',
        'score:gradeF',
        'results:summary',
        'results:total',
        'results:summary',
        'results:valid',
        'results:summary',
        'results:errors',
        'results:summary',
        'results:warnings',
        'results:documents',
        'results:documents',
        'score:documents',
        'docScore:document',
        'document:path',
        'docScore:totalScore',
        'docScore:grade',
        'document:path',
        'document:path',
        'graph',
        'commit',
        'locale',
        'document:issues',
        'issue:severity',
        'issue:suggestion',
        'issue:message',
        'issue:reference',
        'reference:lineNumber',
        'issue:reference',
        'reference:type',
        'isGitRepo',
        'changedFiles',
        'affectedDocs',
      ]);
    }
    finally {
      iso.mockRestore();
      locale.mockRestore();
    }
  });

  it('observes tracker mutations only in values prepared after the callback', () => {
    const firstIssue = issue('first before');
    const secondIssue = issue('second before');
    const results: ValidationResults = {
      documents: [
        { path: 'docs/first.md', issues: [firstIssue] },
        { path: 'docs/second.md', issues: [secondIssue] },
      ],
      summary: { total: 2, valid: 0, errors: 2, warnings: 0, skipped: 0 },
    };
    const firstScore = { document: 'docs/first.md', totalScore: 10, factors: {}, grade: 'F' as const };
    const secondScore = { document: 'docs/second.md', totalScore: 20, factors: {}, grade: 'F' as const };
    const scores: ProjectScores = {
      projectScore: 15,
      projectGrade: 'F',
      documents: [firstScore, secondScore] as ProjectScores['documents'],
      summary: { total: 2, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 2 },
    };
    const graph = new CodeDocGraph();
    for (const documentPath of ['docs/first.md', 'docs/second.md']) {
      graph.addReference(documentPath, 'src/api.ts', issue().reference);
    }
    const gitTracker = {
      getFileCommitInfo: () => {
        firstScore.totalScore = 99;
        secondScore.totalScore = 77;
        firstIssue.message = 'first after';
        secondIssue.message = 'second after';
        results.summary.total = 99;
        return null;
      },
      isGitRepo: () => false,
    } as unknown as GitChangeTracker;

    const report = reporter.generateScanReport(results, graph, gitTracker, scores);

    expect(report).toContain('Total References:** 2');
    expect(report).toContain('docs/first.md` (Score: 10, Grade: F)');
    expect(report).toContain('docs/second.md` (Score: 77, Grade: F)');
    expect(report).toContain('first after');
    expect(report).toContain('second after');
  });

  it('does not perform graph or git work before throwing score or summary getters', () => {
    const graph = graphWithReference();
    const graphLookup = vi.spyOn(graph, 'getCodeReferencedByDoc');
    const gitTracker = { getFileCommitInfo: vi.fn(), isGitRepo: vi.fn() } as unknown as GitChangeTracker;
    const scores: ProjectScores = {
      get projectScore(): number {
        throw new Error('score getter failed');
      },
      projectGrade: 'A',
      documents: [],
      summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };

    expect(() => reporter.generateScanReport(issueResults, graph, gitTracker, scores)).toThrow('score getter failed');
    const results: ValidationResults = {
      documents: issueResults.documents,
      summary: {
        get total(): number {
          throw new Error('summary getter failed');
        },
        valid: 0,
        errors: 0,
        warnings: 0,
        skipped: 0,
      },
    };
    expect(() => reporter.generateScanReport(results, graph, gitTracker, null)).toThrow('summary getter failed');
    expect(graphLookup).not.toHaveBeenCalled();
    expect(gitTracker.getFileCommitInfo).not.toHaveBeenCalled();
    expect(gitTracker.isGitRepo).not.toHaveBeenCalled();
  });
});
