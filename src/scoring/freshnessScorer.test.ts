import { FreshnessScorer } from './freshnessScorer.js';
import { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResults } from '../types.js';
import type { GitChangeTracker } from '../git/changeTracker.js';

function makeDoc(docPath: string, refs: Reference[] = []): Document {
  return { path: docPath, absolutePath: `/project/${docPath}`, content: '', format: 'markdown', lines: [], references: refs };
}

function makeRef(type: string, value: string): Reference {
  return { type, value, lineNumber: 1, raw: value, sourceFile: 'doc.md' };
}

const emptyResults: ValidationResults = {
  documents: [],
  summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
};

function makeMockGitTracker(overrides: Partial<GitChangeTracker> = {}): GitChangeTracker {
  return {
    isGitRepo: () => true,
    getCurrentCommit: () => 'abc123',
    getFileCommitInfo: () => null,
    getFileCommitCount: () => 0,
    getFileLastModified: () => null,
    getChangedFiles: () => [],
    getChangedFilesSince: () => [],
    getAffectedDocs: () => [],
    getChangeSummary: () => [],
    ...overrides,
  } as GitChangeTracker;
}

describe('FreshnessScorer', () => {
  describe('constructor', () => {
    it('uses provided weights and thresholds', () => {
      const config: DocFreshnessConfig = {
        freshnessScoring: {
          weights: { referenceValidity: 1, gitTimeDelta: 0, codeChangeFrequency: 0, symbolCoverage: 0 },
          thresholds: { gradeA: 95, gradeB: 85, gradeC: 75, gradeD: 65 },
        },
      };
      const scorer = new FreshnessScorer(config);
      const doc = makeDoc('test.md');
      const score = scorer.calculateDocScore(doc, emptyResults, null, null);
      // Only referenceValidity matters (weight=1), and it's 100 with no issues
      expect(score.totalScore).toBe(100);
      expect(score.grade).toBe('A');
    });

    it('falls back to defaults when config is empty', () => {
      const scorer = new FreshnessScorer({});
      const doc = makeDoc('test.md');
      const score = scorer.calculateDocScore(doc, emptyResults, null, null);
      expect(score.totalScore).toBe(89); // same as default weights calculation
    });

    it('falls back to defaults for partially specified weights', () => {
      const scorer = new FreshnessScorer({
        freshnessScoring: { weights: { referenceValidity: 0.5 } },
      });
      const doc = makeDoc('test.md');
      const score = scorer.calculateDocScore(doc, emptyResults, null, null);
      // referenceValidity=100*0.5 + gitTimeDelta=75*0.3 + changeFreq=75*0.15 + symbolCov=100*0.15
      // = 50 + 22.5 + 11.25 + 15 = 98.75 ≈ 99 (weights sum > 1 since only one was overridden)
      expect(score.totalScore).toBe(99);
    });
  });

  describe('calculateReferenceValidityScore (via calculateDocScore)', () => {
    const scorer = new FreshnessScorer({
      freshnessScoring: {
        weights: { referenceValidity: 1, gitTimeDelta: 0, codeChangeFrequency: 0, symbolCoverage: 0 },
      },
    });

    it('returns 100 when doc has no references', () => {
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, null, null);
      expect(score.factors.referenceValidity).toBe(100);
    });

    it('returns 100 when doc has references but no validation issues', () => {
      const doc = makeDoc('doc.md', [makeRef('file-path', 'a.ts')]);
      const score = scorer.calculateDocScore(doc, emptyResults, null, null);
      expect(score.factors.referenceValidity).toBe(100);
    });

    it('only counts error-severity issues as invalid (ignores warnings)', () => {
      const doc = makeDoc('doc.md', [makeRef('file-path', 'a'), makeRef('file-path', 'b')]);
      const results: ValidationResults = {
        documents: [
          {
            path: 'doc.md',
            issues: [{ reference: makeRef('file-path', 'b'), valid: false, severity: 'warning', message: 'stale' }],
          },
        ],
        summary: { total: 2, valid: 1, errors: 0, warnings: 1, skipped: 0 },
      };
      const score = scorer.calculateDocScore(doc, results, null, null);
      expect(score.factors.referenceValidity).toBe(100);
    });

    it('returns 0 when all references are errors', () => {
      const doc = makeDoc('doc.md', [makeRef('file-path', 'a'), makeRef('file-path', 'b')]);
      const results: ValidationResults = {
        documents: [
          {
            path: 'doc.md',
            issues: [
              { reference: makeRef('file-path', 'a'), valid: false, severity: 'error', message: 'missing' },
              { reference: makeRef('file-path', 'b'), valid: false, severity: 'error', message: 'missing' },
            ],
          },
        ],
        summary: { total: 2, valid: 0, errors: 2, warnings: 0, skipped: 0 },
      };
      const score = scorer.calculateDocScore(doc, results, null, null);
      expect(score.factors.referenceValidity).toBe(0);
      expect(score.totalScore).toBe(0);
    });

    it('handles mixed errors and warnings', () => {
      const doc = makeDoc('doc.md', [makeRef('file-path', 'a'), makeRef('file-path', 'b'), makeRef('file-path', 'c')]);
      const results: ValidationResults = {
        documents: [
          {
            path: 'doc.md',
            issues: [
              { reference: makeRef('file-path', 'a'), valid: false, severity: 'error', message: 'missing' },
              { reference: makeRef('file-path', 'b'), valid: false, severity: 'warning', message: 'stale' },
            ],
          },
        ],
        summary: { total: 3, valid: 1, errors: 1, warnings: 1, skipped: 0 },
      };
      const score = scorer.calculateDocScore(doc, results, null, null);
      // 1 error out of 3 refs → (3-1)/3 = 67%
      expect(score.factors.referenceValidity).toBe(67);
    });
  });

  describe('calculateGitTimeDeltaScore (via calculateDocScore)', () => {
    const scorer = new FreshnessScorer({
      freshnessScoring: {
        weights: { referenceValidity: 0, gitTimeDelta: 1, codeChangeFrequency: 0, symbolCoverage: 0 },
      },
    });

    it('returns 75 when gitTracker is null', () => {
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, null, null);
      expect(score.factors.gitTimeDelta).toBe(75);
    });

    it('returns 75 when not a git repo', () => {
      const tracker = makeMockGitTracker({ isGitRepo: () => false });
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, null);
      expect(score.factors.gitTimeDelta).toBe(75);
    });

    it('returns 50 when doc is not tracked by git', () => {
      const tracker = makeMockGitTracker({ getFileCommitInfo: () => null });
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, null);
      expect(score.factors.gitTimeDelta).toBe(50);
    });

    it('returns 100 when doc has no code references in graph', () => {
      const tracker = makeMockGitTracker({
        getFileCommitInfo: () => ({ hash: 'abc', timestamp: Date.now(), message: 'update' }),
      });
      const graph = new CodeDocGraph();
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      expect(score.factors.gitTimeDelta).toBe(100);
    });

    it('returns 75 when referenced code files are not in git', () => {
      const tracker = makeMockGitTracker({
        getFileCommitInfo: (filePath: string) => (filePath === 'doc.md' ? { hash: 'abc', timestamp: Date.now(), message: 'update' } : null),
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      expect(score.factors.gitTimeDelta).toBe(75);
    });

    it('returns 100 when doc was updated after all referenced code', () => {
      const now = Date.now();
      const tracker = makeMockGitTracker({
        getFileCommitInfo: (filePath: string) =>
          filePath === 'doc.md'
            ? { hash: 'doc', timestamp: now, message: 'doc update' }
            : { hash: 'code', timestamp: now - 10_000, message: 'code update' },
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      expect(score.factors.gitTimeDelta).toBe(100);
    });

    it('decays score when doc is older than code', () => {
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const tracker = makeMockGitTracker({
        getFileCommitInfo: (filePath: string) =>
          filePath === 'doc.md'
            ? { hash: 'doc', timestamp: now - thirtyDaysMs, message: 'old doc' }
            : { hash: 'code', timestamp: now, message: 'recent code' },
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      // ~30 days diff → 100 * exp(-0.02*30) ≈ 55
      expect(score.factors.gitTimeDelta).toBeGreaterThan(40);
      expect(score.factors.gitTimeDelta).toBeLessThan(70);
    });

    it('approaches 0 for very old docs', () => {
      const now = Date.now();
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      const tracker = makeMockGitTracker({
        getFileCommitInfo: (filePath: string) =>
          filePath === 'doc.md'
            ? { hash: 'doc', timestamp: now - yearMs, message: 'ancient' }
            : { hash: 'code', timestamp: now, message: 'fresh' },
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      expect(score.factors.gitTimeDelta).toBeLessThan(5);
    });

    it('uses the most recent code timestamp across multiple files', () => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      const tracker = makeMockGitTracker({
        getFileCommitInfo: (filePath: string) => {
          if (filePath === 'doc.md') return { hash: 'doc', timestamp: now - 5 * oneDay, message: 'doc' };
          if (filePath === 'src/old.ts') return { hash: 'old', timestamp: now - 30 * oneDay, message: 'old' };
          return { hash: 'new', timestamp: now, message: 'new' };
        },
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/old.ts', makeRef('file-path', 'old.ts'));
      graph.addReference('doc.md', 'src/new.ts', makeRef('file-path', 'new.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      // Delta is 5 days (doc is 5 days behind the newest code file)
      expect(score.factors.gitTimeDelta).toBeGreaterThan(85);
      expect(score.factors.gitTimeDelta).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateChangeFrequencyScore (via calculateDocScore)', () => {
    const scorer = new FreshnessScorer({
      freshnessScoring: {
        weights: { referenceValidity: 0, gitTimeDelta: 0, codeChangeFrequency: 1, symbolCoverage: 0 },
      },
    });

    const docTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
    const docCommit = { hash: 'doc1', timestamp: docTimestamp, message: 'update docs' };

    it('returns 75 when not a git repo', () => {
      const tracker = makeMockGitTracker({ isGitRepo: () => false });
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, null);
      expect(score.factors.codeChangeFrequency).toBe(75);
    });

    it('returns 100 when doc has no code references', () => {
      const tracker = makeMockGitTracker({ getFileCommitInfo: () => docCommit });
      const graph = new CodeDocGraph();
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      expect(score.factors.codeChangeFrequency).toBe(100);
    });

    it('returns 50 when doc is not tracked by git', () => {
      const tracker = makeMockGitTracker({ getFileCommitInfo: () => null });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      expect(score.factors.codeChangeFrequency).toBe(50);
    });

    it('returns 100 when no code commits happened after the doc was updated', () => {
      const tracker = makeMockGitTracker({
        getFileCommitInfo: () => docCommit,
        getFileCommitCount: () => 0,
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      expect(score.factors.codeChangeFrequency).toBe(100);
    });

    it('returns high score for few post-doc commits (gentle risk signal)', () => {
      const tracker = makeMockGitTracker({
        getFileCommitInfo: () => docCommit,
        getFileCommitCount: () => 5,
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      // 40 + 60 * exp(-0.03 * 5) ≈ 92
      expect(score.factors.codeChangeFrequency).toBeGreaterThan(88);
      expect(score.factors.codeChangeFrequency).toBeLessThan(96);
    });

    it('returns moderate score for medium post-doc churn', () => {
      const tracker = makeMockGitTracker({
        getFileCommitInfo: () => docCommit,
        getFileCommitCount: () => 20,
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      // 40 + 60 * exp(-0.03 * 20) ≈ 73
      expect(score.factors.codeChangeFrequency).toBeGreaterThan(68);
      expect(score.factors.codeChangeFrequency).toBeLessThan(78);
    });

    it('never drops below the floor (40) even for extreme churn', () => {
      const tracker = makeMockGitTracker({
        getFileCommitInfo: () => docCommit,
        getFileCommitCount: () => 200,
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      // 40 + 60 * exp(-0.03 * 200) ≈ 40 + 0.15 ≈ 40
      expect(score.factors.codeChangeFrequency).toBeGreaterThanOrEqual(40);
      expect(score.factors.codeChangeFrequency).toBeLessThan(45);
    });

    it('uses the max post-doc commit count across multiple referenced files', () => {
      const tracker = makeMockGitTracker({
        getFileCommitInfo: () => docCommit,
        getFileCommitCount: (filePath: string) => (filePath === 'src/hot.ts' ? 20 : 1),
      });
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/stable.ts', makeRef('file-path', 'stable.ts'));
      graph.addReference('doc.md', 'src/hot.ts', makeRef('file-path', 'hot.ts'));
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, tracker, graph);
      // Max is 20 → 40 + 60 * exp(-0.03 * 20) ≈ 73
      expect(score.factors.codeChangeFrequency).toBeGreaterThan(68);
      expect(score.factors.codeChangeFrequency).toBeLessThan(78);
    });
  });

  describe('calculateSymbolCoverageScore (via calculateDocScore)', () => {
    const scorer = new FreshnessScorer({
      freshnessScoring: {
        weights: { referenceValidity: 0, gitTimeDelta: 0, codeChangeFrequency: 0, symbolCoverage: 1 },
      },
    });

    it('returns 100 when no graph provided', () => {
      const doc = makeDoc('doc.md', [makeRef('code-pattern', 'X')]);
      const score = scorer.calculateDocScore(doc, emptyResults, null, null);
      expect(score.factors.symbolCoverage).toBe(100);
    });

    it('returns 100 when doc has no code references in graph', () => {
      const graph = new CodeDocGraph();
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, null, graph);
      expect(score.factors.symbolCoverage).toBe(100);
    });

    it('returns 100 when referenced files have no tracked symbols', () => {
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      // No codeSymbols set for src/a.ts → totalSymbols=0
      const score = scorer.calculateDocScore(makeDoc('doc.md'), emptyResults, null, graph);
      expect(score.factors.symbolCoverage).toBe(100);
    });

    it('returns 100% when all symbols are documented', () => {
      const doc = makeDoc('doc.md', [makeRef('code-pattern', 'A'), makeRef('code-pattern', 'B')]);
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/a.ts', makeRef('code-pattern', 'A'));
      graph.codeSymbols.set('src/a.ts', new Set(['A', 'B']));
      const score = scorer.calculateDocScore(doc, emptyResults, null, graph);
      expect(score.factors.symbolCoverage).toBe(100);
    });

    it('returns 50% when half the symbols are documented', () => {
      const doc = makeDoc('doc.md', [makeRef('code-pattern', 'MyClass')]);
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/x.ts', makeRef('code-pattern', 'MyClass'));
      graph.codeSymbols.set('src/x.ts', new Set(['MyClass', 'OtherClass']));
      const score = scorer.calculateDocScore(doc, emptyResults, null, graph);
      expect(score.factors.symbolCoverage).toBe(50);
    });

    it('returns 0% when no symbols are documented', () => {
      const doc = makeDoc('doc.md', [makeRef('file-path', 'something')]);
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/x.ts', makeRef('file-path', 'x.ts'));
      graph.codeSymbols.set('src/x.ts', new Set(['A', 'B', 'C']));
      const score = scorer.calculateDocScore(doc, emptyResults, null, graph);
      expect(score.factors.symbolCoverage).toBe(0);
    });

    it('aggregates symbols across multiple referenced files', () => {
      const doc = makeDoc('doc.md', [makeRef('code-pattern', 'A'), makeRef('code-pattern', 'C')]);
      const graph = new CodeDocGraph();
      graph.addReference('doc.md', 'src/x.ts', makeRef('code-pattern', 'A'));
      graph.addReference('doc.md', 'src/y.ts', makeRef('code-pattern', 'C'));
      graph.codeSymbols.set('src/x.ts', new Set(['A', 'B']));
      graph.codeSymbols.set('src/y.ts', new Set(['C', 'D']));
      // 2 documented out of 4 total → 50%
      const score = scorer.calculateDocScore(doc, emptyResults, null, graph);
      expect(score.factors.symbolCoverage).toBe(50);
    });
  });

  describe('scoreToGrade (via calculateDocScore with weight=1 on referenceValidity)', () => {
    const scorer = new FreshnessScorer({
      freshnessScoring: {
        weights: { referenceValidity: 1, gitTimeDelta: 0, codeChangeFrequency: 0, symbolCoverage: 0 },
        thresholds: { gradeA: 90, gradeB: 80, gradeC: 70, gradeD: 60 },
      },
    });

    function gradeFor(validRefs: number, totalRefs: number): string {
      const refs = Array.from({ length: totalRefs }, (_, i) => makeRef('file-path', `f${i}`));
      const doc = makeDoc('doc.md', refs);
      const errorIssues = refs.slice(validRefs).map((r) => ({
        reference: r,
        valid: false as const,
        severity: 'error' as const,
        message: 'missing',
      }));
      const results: ValidationResults = {
        documents: errorIssues.length > 0 ? [{ path: 'doc.md', issues: errorIssues }] : [],
        summary: { total: totalRefs, valid: validRefs, errors: totalRefs - validRefs, warnings: 0, skipped: 0 },
      };
      return scorer.calculateDocScore(doc, results, null, null).grade;
    }

    it.each([
      [10, 10, 'A'], // 100%
      [9, 10, 'A'], // 90%
      [8, 10, 'B'], // 80%
      [7, 10, 'C'], // 70%
      [6, 10, 'D'], // 60%
      [5, 10, 'F'], // 50%
      [0, 10, 'F'], // 0%
    ])('%d/%d valid → grade %s', (valid, total, expectedGrade) => {
      expect(gradeFor(valid, total)).toBe(expectedGrade);
    });
  });

  describe('calculateProjectScores', () => {
    const scorer = new FreshnessScorer({
      freshnessScoring: {
        weights: { referenceValidity: 1, gitTimeDelta: 0, codeChangeFrequency: 0, symbolCoverage: 0 },
        thresholds: { gradeA: 90, gradeB: 80, gradeC: 70, gradeD: 60 },
      },
    });

    it('returns perfect score for empty project', () => {
      const scores = scorer.calculateProjectScores([], emptyResults, null, null);
      expect(scores.projectScore).toBe(100);
      expect(scores.projectGrade).toBe('A');
      expect(scores.summary).toEqual({ total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 });
    });

    it('averages scores across documents', () => {
      const goodDoc = makeDoc('good.md', [makeRef('file-path', 'a')]);
      const badDoc = makeDoc('bad.md', [makeRef('file-path', 'a')]);
      const results: ValidationResults = {
        documents: [
          {
            path: 'bad.md',
            issues: [{ reference: makeRef('file-path', 'a'), valid: false, severity: 'error', message: 'missing' }],
          },
        ],
        summary: { total: 2, valid: 1, errors: 1, warnings: 0, skipped: 0 },
      };
      const scores = scorer.calculateProjectScores([goodDoc, badDoc], results, null, null);
      // good=100, bad=0 → avg=50
      expect(scores.projectScore).toBe(50);
      expect(scores.projectGrade).toBe('F');
    });

    it('correctly tallies grade summary counts', () => {
      // All docs with no issues → all grade A
      const docs = [makeDoc('a.md'), makeDoc('b.md'), makeDoc('c.md')];
      const scores = scorer.calculateProjectScores(docs, emptyResults, null, null);
      expect(scores.summary.total).toBe(3);
      expect(scores.summary.gradeA).toBe(3);
      expect(scores.summary.gradeB + scores.summary.gradeC + scores.summary.gradeD + scores.summary.gradeF).toBe(0);
    });

    it('produces correct document-level detail', () => {
      const doc = makeDoc('x.md', [makeRef('file-path', 'f1'), makeRef('file-path', 'f2')]);
      const results: ValidationResults = {
        documents: [
          {
            path: 'x.md',
            issues: [{ reference: makeRef('file-path', 'f1'), valid: false, severity: 'error', message: 'missing' }],
          },
        ],
        summary: { total: 2, valid: 1, errors: 1, warnings: 0, skipped: 0 },
      };
      const scores = scorer.calculateProjectScores([doc], results, null, null);
      expect(scores.documents).toHaveLength(1);
      expect(scores.documents[0].document).toBe('x.md');
      expect(scores.documents[0].factors.referenceValidity).toBe(50);
    });
  });
});
