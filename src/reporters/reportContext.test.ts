import type { ProjectScores, ValidationResults } from '../types.js';
import { createReportContext } from './reportContext.js';

const results: ValidationResults = {
  documents: [],
  summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
};

const scores: ProjectScores = {
  projectScore: 100,
  projectGrade: 'A',
  documents: [],
  summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
};

describe('ReportContext ownership', () => {
  it('exposes caller data as deeply readonly without freezing caller-owned objects', () => {
    const report = createReportContext(results, scores);
    const readonlyContract = (): void => {
      // @ts-expect-error Report contexts expose validation results as readonly views.
      report.results.summary.total = 1;
      // @ts-expect-error Report contexts expose nested arrays as readonly views.
      report.results.documents.push({ path: 'docs/new.md', issues: [] });
      // @ts-expect-error Report contexts expose scores as readonly views.
      report.freshnessScores!.documents.push({});
    };

    expectTypeOf(readonlyContract).toBeFunction();
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(results)).toBe(false);
    expect(Object.isFrozen(results.summary)).toBe(false);
    expect(Object.isFrozen(scores)).toBe(false);
  });
});
