import { JsonReporter } from './jsonReporter.js';
import type { ValidationResults } from '../types.js';

describe('JsonReporter', () => {
  const reporter = new JsonReporter();
  const results: ValidationResults = {
    documents: [
      {
        path: 'README.md',
        issues: [
          {
            reference: { type: 'dependency', value: 'missing-pkg', lineNumber: 1, raw: 'missing-pkg', sourceFile: 'README.md' },
            valid: false,
            severity: 'info',
            message: 'Package not found',
          },
        ],
      },
    ],
    summary: { total: 3, valid: 2, errors: 0, warnings: 0, info: 1, skipped: 0 },
  };

  it('generate() returns valid JSON string', () => {
    const output = reporter.generate(results);
    const parsed = JSON.parse(output);
    expect(parsed.summary.total).toBe(3);
    expect(parsed.summary.info).toBe(1);
    expect(parsed.documents[0].issues[0].severity).toBe('info');
  });

  it('generateWithScores() includes scores and timestamp', () => {
    const output = reporter.generateWithScores(results, null);
    const parsed = JSON.parse(output);
    expect(parsed.freshnessScores).toBeNull();
    expect(parsed.generatedAt).toBeDefined();
  });

  it('generateWithScores() includes scores object when provided', () => {
    const scores = {
      projectScore: 90,
      projectGrade: 'A' as const,
      documents: [],
      summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    const output = reporter.generateWithScores(results, scores);
    const parsed = JSON.parse(output);
    expect(parsed.freshnessScores.projectScore).toBe(90);
  });

  it.each([
    ['generate', (legacyResults: ValidationResults) => reporter.generate(legacyResults)],
    ['generateWithScores', (legacyResults: ValidationResults) => reporter.generateWithScores(legacyResults, null)],
  ])('%s normalizes legacy results without mutating them', (_name, generate) => {
    const legacyResults: ValidationResults = {
      ...results,
      summary: {
        total: results.summary.total,
        valid: results.summary.valid,
        errors: results.summary.errors,
        warnings: results.summary.warnings,
        skipped: results.summary.skipped,
      },
    };
    const output = generate(legacyResults);

    expect(JSON.parse(output).summary.info).toBe(0);
    expect(legacyResults.summary.info).toBeUndefined();
  });
});
