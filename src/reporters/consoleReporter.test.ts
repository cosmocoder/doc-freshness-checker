import { captureConsoleLog } from '../test-utils/console.js';
import type { ProjectScores, ValidationResults } from '../types.js';
import { ConsoleReporter } from './consoleReporter.js';

const cleanResults: ValidationResults = {
  documents: [],
  summary: { total: 5, valid: 5, errors: 0, warnings: 0, skipped: 0 },
};

const score = (document: string, totalScore: number, grade: ProjectScores['projectGrade']) => ({
  document,
  totalScore,
  factors: { referenceValidity: totalScore, gitTimeDelta: totalScore, codeChangeFrequency: totalScore, symbolCoverage: totalScore },
  grade,
});

describe('ConsoleReporter', () => {
  it('shows every document-grade icon', () => {
    const log = captureConsoleLog();
    const scores: ProjectScores = {
      projectScore: 70,
      projectGrade: 'C',
      documents: [score('a.md', 95, 'A'), score('b.md', 85, 'B'), score('c.md', 75, 'C'), score('d.md', 50, 'F')],
      summary: { total: 4, gradeA: 1, gradeB: 1, gradeC: 1, gradeD: 0, gradeF: 1 },
    };

    new ConsoleReporter().generateWithScores(cleanResults, scores);

    expect(log.mock.calls.flat().join('\n')).toMatch(/🟢.*🟡.*🟠.*🔴/s);
  });

  it('shows vector-search best-match details when available', () => {
    const log = captureConsoleLog();
    const results: ValidationResults = {
      ...cleanResults,
      vectorMismatches: [
        {
          docPath: 'docs/api.md',
          docSection: 'Auth API',
          docText: 'This function handles auth',
          bestMatchScore: 0.2,
          bestMatch: { type: 'code', path: 'src/db.ts', symbol: 'dbConnect', text: 'DB connect' },
          suggestion: 'Documentation may describe functionality not found in code',
        },
      ],
    };

    new ConsoleReporter().generateWithScores(results, null);

    expect(log.mock.calls.flat().join('\n')).toContain('Best match: src/db.ts (dbConnect)');
  });

  it('dispatches generateWithScores through an overridden generate method', () => {
    class CustomConsoleReporter extends ConsoleReporter {
      calls: ValidationResults[] = [];

      override generate(results: ValidationResults): void {
        this.calls.push(results);
        console.log('custom console output');
      }
    }
    const reporter = new CustomConsoleReporter();
    const log = captureConsoleLog();
    const scores: ProjectScores = {
      projectScore: 100,
      projectGrade: 'A',
      documents: [],
      summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };

    reporter.generateWithScores(cleanResults, scores);

    expect(reporter.calls).toEqual([cleanResults]);
    expect(log.mock.calls[0]).toEqual(['custom console output']);
  });

  it('emits completed chunks before a later rendering error', () => {
    const summary = {
      get total(): number {
        throw new Error('summary failed');
      },
      valid: 0,
      errors: 0,
      warnings: 0,
      skipped: 0,
    };
    const log = captureConsoleLog();

    expect(() => new ConsoleReporter().generate({ documents: [], summary })).toThrow('summary failed');
    expect(log.mock.calls).toEqual([['\n📚 Documentation Freshness Report\n'], ['━'.repeat(50)], ['\n📊 Summary:']]);
  });
});
